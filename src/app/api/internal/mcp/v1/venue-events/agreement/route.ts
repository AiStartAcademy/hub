import { randomBytes } from "node:crypto";

import { NextRequest } from "next/server";

import {
  AGREEMENT_TEMPLATE_KEYS,
  AISA_SIGNER_DEFAULTS,
  renderTemplate,
  templateKeyForDealType,
  type AgreementTemplateKey,
} from "@/lib/agreementTemplates";
import { logger } from "@/lib/logger";
import { escapeHtml, sendMail } from "@/lib/mail";
import {
  MCP_DETAIL_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";
import prisma from "@/lib/prisma";
import { AGREEMENT_PUBLIC_BASE_URL } from "@/lib/venueAgreementPayment";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BODY_KEYS = new Set([
  "venueEventId",
  "templateKey",
  "variables",
  "send",
  "signerEmail",
]);

type VariableMap = Record<string, string | number>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
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

export async function POST(req: NextRequest) {
  const denied = await requireMcpToken(req);
  if (denied) {
    return denied;
  }

  if (!(await mcpWritesEnabled())) {
    logger.error(
      { operation: "POST" },
      "venue agreement POST denied because MCP writes are disabled",
    );
    return mcpError("MCP writes are disabled", 403);
  }

  try {
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch (error: unknown) {
      return mcpError(`Invalid JSON body: ${getErrorMessage(error)}`, 400);
    }

    if (!isPlainObject(parsedBody)) {
      return mcpError("Request body must be a JSON object", 400);
    }

    for (const key of Object.keys(parsedBody)) {
      if (!BODY_KEYS.has(key)) {
        return mcpError(`Unknown body key \`${key}\``, 400);
      }
    }

    const { venueEventId, templateKey, variables, send, signerEmail } =
      parsedBody as {
        venueEventId?: unknown;
        templateKey?: unknown;
        variables?: unknown;
        send?: unknown;
        signerEmail?: unknown;
      };

    if (typeof venueEventId !== "string" || !venueEventId.trim()) {
      return mcpError("venueEventId is required and must be a string", 400);
    }
    if (templateKey !== undefined && typeof templateKey !== "string") {
      return mcpError("templateKey must be a string", 400);
    }
    if (variables !== undefined && !isVariableMap(variables)) {
      return mcpError(
        "variables must be an object with string or number values",
        400,
      );
    }
    if (send !== undefined && typeof send !== "boolean") {
      return mcpError("send must be a boolean", 400);
    }
    if (signerEmail !== undefined && typeof signerEmail !== "string") {
      return mcpError("signerEmail must be a string", 400);
    }
    if (signerEmail !== undefined && !EMAIL_REGEX.test(signerEmail)) {
      return mcpError("signerEmail must be a valid email address", 400);
    }

    const event = await prisma.venueEvent.findUnique({
      where: { id: venueEventId.trim() },
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
      return mcpError("Venue event not found", 404);
    }

    let selectedTemplateKey: AgreementTemplateKey;
    if (templateKey) {
      if (!isAgreementTemplateKey(templateKey)) {
        return mcpError(
          `Invalid templateKey. Expected one of: ${AGREEMENT_TEMPLATE_KEYS.join(", ")}`,
          400,
        );
      }
      selectedTemplateKey = templateKey;
    } else {
      try {
        selectedTemplateKey = templateKeyForDealType(event.dealType);
      } catch (error: unknown) {
        return mcpError(getErrorMessage(error), 400);
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
      ...((variables as VariableMap | undefined) ?? {}),
    };

    const renderedAgreement = renderTemplate(selectedTemplateKey, mergedVariables, {
      allowMissing: true,
    });

    const recipientEmail = signerEmail || event.contactEmail || null;
    const token = randomBytes(32).toString("hex");
    const signingUrl = `${AGREEMENT_PUBLIC_BASE_URL}/agreements/${token}`;
    const signerNameValue =
      typeof mergedVariables.signerName === "number"
        ? String(mergedVariables.signerName)
        : mergedVariables.signerName;

    const agreement = await prisma.venueAgreement.create({
      data: {
        venueEventId: event.id,
        templateKey: selectedTemplateKey,
        token,
        status: "DRAFT",
        contentMd: renderedAgreement,
        signerName: signerNameValue,
        signerEmail: recipientEmail,
        // Creating and sending an agreement is the academy's approval act, so the
        // countersignature is stamped here rather than waiting on a second pass.
        aisaSignedAt: new Date(),
        aisaSignerName:
          typeof mergedVariables.aisaSignerName === "string" &&
          mergedVariables.aisaSignerName.trim()
            ? mergedVariables.aisaSignerName.trim()
            : AISA_SIGNER_DEFAULTS.name,
        aisaSignerTitle:
          typeof mergedVariables.aisaSignerTitle === "string" &&
          mergedVariables.aisaSignerTitle.trim()
            ? mergedVariables.aisaSignerTitle.trim()
            : AISA_SIGNER_DEFAULTS.title,
      } as never,
    });

    if (send === true) {
      if (!recipientEmail) {
        return mcpError(
          "Agreement was created but no signer email is available",
          400,
        );
      }

      try {
        await sendMail({
          to: recipientEmail,
          subject: "Agreement ready for signature",
          html: [
            `<p>Hello ${escapeHtml(signerNameValue || "there")},</p>`,
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

        return mcpJsonLimited(
          {
            id: sentAgreement.id,
            token: sentAgreement.token,
            status: sentAgreement.status,
            templateKey: selectedTemplateKey,
            signingUrl,
          },
          MCP_DETAIL_MAX_BYTES,
        );
      } catch (error: unknown) {
        logger.error(
          { err: error },
          "Failed to send venue agreement email via MCP",
        );

        return mcpJson(
          {
            error:
              "Agreement was created but could not be emailed. Please try sending it again.",
            id: agreement.id,
            token: agreement.token,
            status: agreement.status,
            templateKey: selectedTemplateKey,
            signingUrl,
          },
          502,
        );
      }
    }

    return mcpJsonLimited(
      {
        id: agreement.id,
        token: agreement.token,
        status: agreement.status,
        templateKey: selectedTemplateKey,
        signingUrl,
      },
      MCP_DETAIL_MAX_BYTES,
    );
  } catch (error: unknown) {
    logger.error({ err: error }, "Failed to create venue agreement via MCP");
    return mcpError("Internal server error", 500);
  }
}
