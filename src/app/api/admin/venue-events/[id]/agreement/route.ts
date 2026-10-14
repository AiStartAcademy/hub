import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import {
  AGREEMENT_TEMPLATE_KEYS,
  AISA_SIGNER_DEFAULTS,
  renderTemplate,
  templateKeyForDealType,
  type AgreementTemplateKey,
} from "@/lib/agreementTemplates";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { escapeHtml, sendMail } from "@/lib/mail";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { AGREEMENT_PUBLIC_BASE_URL } from "@/lib/venueAgreementPayment";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AgreementRequestBody = {
  templateKey?: string;
  variables?: Record<string, string | number>;
  send?: boolean;
  signerEmail?: string;
};

type VariableMap = Record<string, string | number>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

function isPlainObject(
  value: unknown,
): value is Record<string, string | number> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgreementTemplateKey(value: string): value is AgreementTemplateKey {
  return (AGREEMENT_TEMPLATE_KEYS as readonly string[]).includes(value);
}

function isVariableMap(value: unknown): value is VariableMap {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => typeof entry === "string" || typeof entry === "number",
  );
}

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const session = await auth();

    if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let body: AgreementRequestBody;

    try {
      const parsedBody = (await request.json()) as unknown;

      if (!isPlainObject(parsedBody)) {
        return NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        );
      }

      if (
        parsedBody.templateKey !== undefined &&
        typeof parsedBody.templateKey !== "string"
      ) {
        return NextResponse.json(
          { error: "templateKey must be a string" },
          { status: 400 },
        );
      }

      if (parsedBody.variables !== undefined && !isVariableMap(parsedBody.variables)) {
        return NextResponse.json(
          { error: "variables must be an object with string or number values" },
          { status: 400 },
        );
      }

      if (parsedBody.send !== undefined && typeof parsedBody.send !== "boolean") {
        return NextResponse.json(
          { error: "send must be a boolean" },
          { status: 400 },
        );
      }

      if (
        parsedBody.signerEmail !== undefined &&
        typeof parsedBody.signerEmail !== "string"
      ) {
        return NextResponse.json(
          { error: "signerEmail must be a string" },
          { status: 400 },
        );
      }

      body = parsedBody;
    } catch (error: unknown) {
      return NextResponse.json(
        { error: `Invalid JSON body: ${getErrorMessage(error)}` },
        { status: 400 },
      );
    }

    const event = await prisma.venueEvent.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        slug: true,
        organizerName: true,
        orgName: true,
        contactEmail: true,
        date: true,
        startTime: true,
        endTime: true,
        dealType: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Venue event not found" }, { status: 404 });
    }

    let selectedTemplateKey: AgreementTemplateKey;

    if (body.templateKey) {
      if (!isAgreementTemplateKey(body.templateKey)) {
        return NextResponse.json(
          {
            error: `Invalid templateKey. Expected one of: ${AGREEMENT_TEMPLATE_KEYS.join(", ")}`,
          },
          { status: 400 },
        );
      }

      selectedTemplateKey = body.templateKey;
    } else {
      try {
        selectedTemplateKey = templateKeyForDealType(event.dealType);
      } catch (error: unknown) {
        return NextResponse.json(
          { error: getErrorMessage(error) },
          { status: 400 },
        );
      }
    }

    const defaultVariables: VariableMap = {
      orgName: event.orgName || event.organizerName || "",
      eventTitle: event.title,
      eventDate: formatEventDate(event.date),
      startTime: event.startTime || "",
      endTime: event.endTime || "",
      signerName: event.organizerName || "",
    };

    const mergedVariables: VariableMap = {
      ...defaultVariables,
      ...(body.variables ?? {}),
    };

    const renderedAgreement = renderTemplate(selectedTemplateKey, mergedVariables, {
      allowMissing: true,
    });

    if (body.signerEmail !== undefined && !EMAIL_REGEX.test(body.signerEmail)) {
      return NextResponse.json(
        { error: "signerEmail must be a valid email address" },
        { status: 400 },
      );
    }

    const recipientEmail = body.signerEmail || event.contactEmail || null;
    const token = randomBytes(32).toString("hex");
    const signingUrl = `${AGREEMENT_PUBLIC_BASE_URL}/agreements/${token}`;

    const agreementData: Record<string, unknown> = {
      venueEventId: event.id,
      templateKey: selectedTemplateKey,
      token,
      status: "DRAFT",
      contentMd: renderedAgreement,
      signerName:
        typeof mergedVariables.signerName === "number"
          ? String(mergedVariables.signerName)
          : mergedVariables.signerName,
      signerEmail: recipientEmail,
      // Creating and sending an agreement is the academy's approval act, so the
      // countersignature is stamped here rather than waiting on a second pass.
      aisaSignedAt: new Date(),
      aisaSignerName:
        typeof mergedVariables.aisaSignerName === "string" && mergedVariables.aisaSignerName.trim()
          ? mergedVariables.aisaSignerName.trim()
          : AISA_SIGNER_DEFAULTS.name,
      aisaSignerTitle:
        typeof mergedVariables.aisaSignerTitle === "string" && mergedVariables.aisaSignerTitle.trim()
          ? mergedVariables.aisaSignerTitle.trim()
          : AISA_SIGNER_DEFAULTS.title,
    };

    const agreement = await prisma.venueAgreement.create({
      data: agreementData as never,
    });

    if (body.send === true) {
      if (!recipientEmail) {
        return NextResponse.json(
          { error: "Agreement was created but no signer email is available" },
          { status: 400 },
        );
      }

      try {
        await sendMail({
          to: recipientEmail,
          subject: "Agreement ready for signature",
          html: [
            `<p>Hello ${escapeHtml(
              typeof mergedVariables.signerName === "number"
                ? String(mergedVariables.signerName)
                : mergedVariables.signerName || "there",
            )},</p>`,
            `<p>Your agreement for ${escapeHtml(event.title)} is ready to review and sign.</p>`,
            `<p><a href="${escapeHtml(signingUrl)}">${escapeHtml(signingUrl)}</a></p>`,
          ].join(""),
        } as never);

        const sentAgreement = await prisma.venueAgreement.update({
          where: { id: agreement.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
          } as never,
        });

        return NextResponse.json({
          id: sentAgreement.id,
          token: sentAgreement.token,
          status: sentAgreement.status,
          templateKey: selectedTemplateKey,
          signingUrl,
        });
      } catch (error: unknown) {
        logger.error({ err: error }, "Failed to send venue agreement email");

        return NextResponse.json(
          {
            error:
              "Agreement was created but could not be emailed. Please try sending it again.",
            id: agreement.id,
            token: agreement.token,
            status: agreement.status,
            templateKey: selectedTemplateKey,
            signingUrl,
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
      id: agreement.id,
      token: agreement.token,
      status: agreement.status,
      templateKey: selectedTemplateKey,
      signingUrl,
    });
  } catch (error: unknown) {
    logger.error({ err: error }, "Failed to create venue agreement");

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
