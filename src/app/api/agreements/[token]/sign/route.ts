import { NextRequest, NextResponse } from "next/server";

import { brand } from "@/config/brand";
import { sendMail, escapeHtml } from "@/lib/mail";
import { applyOrganizerFieldValues, extractOrganizerFields } from "@/lib/agreementTemplates";
import { logger } from "@/lib/logger";
import { renderTypedSignatureSvg } from "@/lib/signatureSvg";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { serializeRoles } from "@/lib/roles";
import { addRole } from "@/lib/roles.server";
import {
  resolvePostSignPaymentUrl,
  withPrefilledEmail,
} from "@/lib/venueAgreementPayment";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type AgreementRecord = {
  id: string;
  contentMd: string;
  status: string; // AgreementStatus union, stored as a plain String column by SQLite
  aisaSignedAt: Date | null;
  aisaSignerName: string | null;
  aisaSignerTitle: string | null;
  venueEvent: {
    title: string;
    date: Date;
    contactEmail: string;
    dealType: string;
    rentalPaymentUrl: string | null;
    rentalPaymentStatus: string | null;
  };
};

type SignAgreementRequest = {
  signerName?: unknown;
  signerEmail?: unknown;
  signerTitle?: unknown;
  signatureText?: unknown;
  organizerFieldValues?: unknown;
  agreed?: unknown;
};

type RateLimitOutcome = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const email = value.trim().toLowerCase().slice(0, 320);
  return EMAIL_PATTERN.test(email) ? email : null;
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return "unknown";
  }

  const [firstIp] = forwardedFor.split(",");
  const trimmedIp = firstIp?.trim();

  return trimmedIp && trimmedIp.length > 0 ? trimmedIp : "unknown";
}

function getRequestString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function getOrganizerFieldValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      result[key] = raw.trim();
    }
  }
  return result;
}

function parseRateLimitResult(result: unknown): RateLimitOutcome {
  if (typeof result === "boolean") {
    return {
      allowed: result,
      retryAfterSeconds: 3600,
    };
  }

  if (!result || typeof result !== "object") {
    return {
      allowed: true,
      retryAfterSeconds: 3600,
    };
  }

  const record = result as Record<string, unknown>;
  const allowedCandidate = record.allowed ?? record.ok ?? record.success;
  const retryAfterCandidate = record.retryAfter ?? record.retryAfterSeconds;

  if (typeof allowedCandidate === "boolean") {
    return {
      allowed: allowedCandidate,
      retryAfterSeconds:
        typeof retryAfterCandidate === "number" && Number.isFinite(retryAfterCandidate)
          ? Math.max(1, Math.ceil(retryAfterCandidate))
          : 3600,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 3600,
  };
}

async function enforceRateLimit(ip: string): Promise<RateLimitOutcome> {
  const rateLimitFn = checkRateLimit as unknown as (...args: unknown[]) => Promise<unknown>;
  const attempts: unknown[][] = [
    [{ key: `agreement-sign:${ip}`, limit: 10, windowMs: 60 * 60 * 1000 }],
    [`agreement-sign:${ip}`, 10, 60 * 60 * 1000],
    [`agreement-sign:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 }],
  ];

  for (const args of attempts) {
    try {
      const result = await rateLimitFn(...args);
      return parseRateLimitResult(result);
    } catch (err) {
      logger.error({ err }, "agreement sign rate limit check failed");
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 3600,
  };
}

async function sendSignedAgreementEmail(input: {
  signerEmail: string;
  signerName: string;
  signerTitle: string | null;
  signatureText: string;
  signedAt: Date;
  agreementContentMd: string;
  eventTitle: string;
  eventDate: Date;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
  aisaSignerName: string;
  aisaSignerTitle: string;
  aisaSignedAt: Date;
}): Promise<void> {
  const recipients = [
    input.signerEmail,
    process.env.INTERNAL_NOTIFICATION_EMAIL || brand.email.contact,
  ];
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(input.eventDate);
  const formattedSignedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(input.signedAt);
  const escapedTitle = escapeHtml(input.eventTitle);
  const escapedName = escapeHtml(input.signerName);
  const escapedEmail = escapeHtml(input.signerEmail);
  const escapedSignerTitle = input.signerTitle ? escapeHtml(input.signerTitle) : "";
  const escapedAgreement = escapeHtml(input.agreementContentMd);
  const titleLine = input.signerTitle ? `<p><strong>Title:</strong> ${escapedSignerTitle}</p>` : "";
  const trimmedRentalPaymentUrl = input.rentalPaymentUrl?.trim() ?? "";
  const shouldIncludeRentalPaymentSection =
    trimmedRentalPaymentUrl.length > 0 && input.rentalPaymentStatus !== "paid";
  const paymentSectionHtml = shouldIncludeRentalPaymentSection
    ? `
        <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 20px 0 0;">
          <tr>
            <td style="padding: 16px; border: 1px solid #cbd5e1; background: #f8fafc;">
              <p style="margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #0f172a;">Complete your venue rental payment</p>
              <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.6; color: #334155;">Use the payment link below to complete your venue rental payment.</p>
              <p style="margin: 0; font-size: 14px; line-height: 1.6;">
                <a href="${escapeHtml(trimmedRentalPaymentUrl)}" style="color: #0f766e; word-break: break-all;">${escapeHtml(trimmedRentalPaymentUrl)}</a>
              </p>
            </td>
          </tr>
        </table>`
    : "";
  const paymentSectionText = shouldIncludeRentalPaymentSection
    ? [
        "",
        "Complete your venue rental payment",
        `Payment link: ${trimmedRentalPaymentUrl}`,
      ]
    : [];

  // Signatures are represented as styled text, never as inlined images: mail
  // clients (Gmail in particular) strip `data:` URIs, which would render the
  // executed copy with broken signature images. The cursive font-family stack
  // degrades to italic serif wherever the client has no script face.
  const formattedAisaSignedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(input.aisaSignedAt);
  const escapedSignatureText = escapeHtml(input.signatureText);
  const escapedAisaSignerName = escapeHtml(input.aisaSignerName);
  const escapedAisaSignerTitle = escapeHtml(input.aisaSignerTitle);
  const scriptFontStack =
    "'Snell Roundhand', 'Savoye LET', 'Brush Script MT', cursive, serif";
  const signatureBlockHtml = `
        <table role="presentation" style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <tr>
            <td style="width: 50%; vertical-align: top; padding: 12px; border: 1px solid #cbd5e1;">
              <p style="margin: 0 0 8px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #64748b;">Organizer</p>
              <p style="margin: 0 0 8px; font-family: ${scriptFontStack}; font-size: 28px; font-style: italic; color: #111111;">${escapedSignatureText}</p>
              <p style="margin: 0; font-size: 13px; color: #0f172a;">${escapedName}${
                escapedSignerTitle ? `, ${escapedSignerTitle}` : ""
              }</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #475569;">Signed electronically by ${escapedName} on ${escapeHtml(formattedSignedAt)}</p>
            </td>
            <td style="width: 50%; vertical-align: top; padding: 12px; border: 1px solid #cbd5e1;">
              <p style="margin: 0 0 8px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #64748b;">${brand.name}</p>
              <p style="margin: 0 0 8px; font-family: ${scriptFontStack}; font-size: 28px; font-style: italic; color: #111111;">${escapedAisaSignerName}</p>
              <p style="margin: 0; font-size: 13px; color: #0f172a;">${escapedAisaSignerName}, ${escapedAisaSignerTitle}</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #475569;">Signed electronically by ${escapedAisaSignerName} on ${escapeHtml(formattedAisaSignedAt)}</p>
            </td>
          </tr>
        </table>`;

  const sendMailFn = sendMail as unknown as (message: {
    to: string[];
    subject: string;
    html: string;
    text: string;
  }) => Promise<unknown>;

  await sendMailFn({
    to: recipients,
    subject: `Signed venue agreement: ${input.eventTitle}`,
    html: `
      <div>
        <p>A venue agreement has been signed.</p>
        <p><strong>Event:</strong> ${escapedTitle}</p>
        <p><strong>Event date:</strong> ${escapeHtml(formattedDate)}</p>
        <p><strong>Signer:</strong> ${escapedName}</p>
        <p><strong>Email:</strong> ${escapedEmail}</p>
        ${titleLine}
        <p><strong>Signed at:</strong> ${escapeHtml(formattedSignedAt)}</p>
        ${paymentSectionHtml}
        <hr />
        <pre style="white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${escapedAgreement}</pre>
        ${signatureBlockHtml}
      </div>
    `,
    text: [
      "A venue agreement has been signed.",
      `Event: ${input.eventTitle}`,
      `Event date: ${formattedDate}`,
      `Signer: ${input.signerName}`,
      `Email: ${input.signerEmail}`,
      input.signerTitle ? `Title: ${input.signerTitle}` : "",
      `Signed at: ${formattedSignedAt}`,
      ...paymentSectionText,
      "",
      input.agreementContentMd,
      "",
      `Signed electronically by ${input.signerName} on ${formattedSignedAt}`,
      `Signed electronically by ${input.aisaSignerName}, ${input.aisaSignerTitle} on ${formattedAisaSignedAt}`,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ip = getClientIp(request);
  const rateLimit = await enforceRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many signing attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let payload: SignAgreementRequest;

  try {
    payload = (await request.json()) as SignAgreementRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (payload.agreed !== true) {
    return NextResponse.json(
      { error: "You must confirm that you agree to the agreement before signing." },
      { status: 400 },
    );
  }

  const signerName = getRequestString(payload.signerName);
  if (!signerName) {
    return NextResponse.json({ error: "Signer name is required." }, { status: 400 });
  }

  const signerEmail = getRequestString(payload.signerEmail);
  if (!signerEmail || !EMAIL_PATTERN.test(signerEmail)) {
    return NextResponse.json({ error: "A valid signer email is required." }, { status: 400 });
  }

  const signerTitleValue = getRequestString(payload.signerTitle);
  const signerTitle = signerTitleValue && signerTitleValue.length > 0 ? signerTitleValue : null;

  // Non-empty is the whole bar. Signers legitimately use a variant of their
  // legal name (middle initial, nickname), so this is deliberately not
  // compared against signerName.
  const signatureText = getRequestString(payload.signatureText);
  if (!signatureText) {
    return NextResponse.json({ error: "A typed signature is required." }, { status: 400 });
  }

  let signatureSvg: string;
  try {
    signatureSvg = renderTypedSignatureSvg(signatureText);
  } catch (err) {
    logger.error({ err }, "failed to render typed signature svg");
    return NextResponse.json(
      { error: "That typed signature could not be used. Please shorten it and try again." },
      { status: 400 },
    );
  }

  const submittedOrganizerFields = getOrganizerFieldValues(payload.organizerFieldValues);

  try {
    const { token } = await params;
    const agreement: AgreementRecord | null = await prisma.venueAgreement.findUnique({
      where: { token },
      select: {
        id: true,
        contentMd: true,
        status: true,
        aisaSignedAt: true,
        aisaSignerName: true,
        aisaSignerTitle: true,
        venueEvent: {
          select: {
            title: true,
            date: true,
            contactEmail: true,
            dealType: true,
            rentalPaymentUrl: true,
            rentalPaymentStatus: true,
          },
        },
      },
    });

    if (!agreement || agreement.status === "VOID") {
      return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    }

    if (agreement.status === "SIGNED") {
      return NextResponse.json({ error: "This agreement has already been signed." }, { status: 409 });
    }

    // Re-derive the required fields from the stored contentMd rather than
    // trusting whatever keys the client sent — the markers are the source of
    // truth for what's actually still missing from this agreement.
    const requiredOrganizerFields = extractOrganizerFields(agreement.contentMd);
    const missingFields = requiredOrganizerFields.filter(
      (field) => !(submittedOrganizerFields[field.key] ?? "").trim(),
    );

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: `Please fill in: ${missingFields.map((field) => field.label).join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const finalizedContentMd =
      requiredOrganizerFields.length > 0
        ? applyOrganizerFieldValues(agreement.contentMd, submittedOrganizerFields)
        : agreement.contentMd;

    const signedAt = new Date();
    const updateResult = await prisma.venueAgreement.updateMany({
      where: {
        token,
        status: {
          in: ["DRAFT", "SENT"],
        },
      },
      data: {
        status: "SIGNED",
        contentMd: finalizedContentMd,
        signerName,
        signerEmail,
        signerTitle,
        signatureText,
        signatureSvg,
        signedAt,
        signerIp: ip,
        userAgent: request.headers.get("user-agent"),
      },
    });

    if (updateResult.count === 0) {
      return NextResponse.json({ error: "This agreement has already been signed." }, { status: 409 });
    }

    try {
      const grantEmail =
        normalizeEmail(signerEmail) ?? normalizeEmail(agreement.venueEvent.contactEmail);

      if (!grantEmail) {
        throw new Error(`Agreement ${agreement.id} has no valid organizer email for role grant`);
      }

      const user = await prisma.user.upsert({
        where: { email: grantEmail },
        update: { email: grantEmail },
        create: {
          email: grantEmail,
          name: signerName,
          role: "STUDENT",
          roles: serializeRoles(["STUDENT", "EVENT_ORGANIZER"]),
        },
        select: {
          id: true,
        },
      });

      await addRole(user.id, "EVENT_ORGANIZER");
    } catch (err) {
      // Signing already succeeded above, so account sync failures are logged
      // and swallowed instead of rolling back the executed agreement.
      logger.error({ err }, "failed to grant EVENT_ORGANIZER role after agreement signing");
    }

    try {
      const { aisaSignedAt, aisaSignerName, aisaSignerTitle } = agreement;

      if (!aisaSignedAt || !aisaSignerName || !aisaSignerTitle) {
        // Countersign details are stamped at creation, so their absence means
        // the record was not created through a supported path.
        throw new Error(
          `Agreement ${agreement.id} is missing ${brand.shortName} countersignature details`
        );
      }

      await sendSignedAgreementEmail({
        signerEmail,
        signerName,
        signerTitle,
        signatureText,
        signedAt,
        agreementContentMd: finalizedContentMd,
        eventTitle: agreement.venueEvent.title,
        eventDate: agreement.venueEvent.date,
        rentalPaymentUrl: agreement.venueEvent.rentalPaymentUrl,
        rentalPaymentStatus: agreement.venueEvent.rentalPaymentStatus,
        aisaSignerName,
        aisaSignerTitle,
        aisaSignedAt,
      });
    } catch (err) {
      // Signing already succeeded above, so notification delivery is best-effort.
      logger.error({ err }, "failed to send signed agreement email");
    }

    const resolvedPaymentUrl = resolvePostSignPaymentUrl(agreement.venueEvent);
    const paymentUrl = resolvedPaymentUrl
      ? withPrefilledEmail(resolvedPaymentUrl, signerEmail)
      : null;

    return NextResponse.json({
      ok: true,
      signedAt: signedAt.toISOString(),
      paymentUrl,
    });
  } catch (err) {
    logger.error({ err }, "failed to sign agreement");
    return NextResponse.json({ error: "Unable to sign the agreement right now." }, { status: 500 });
  }
}
