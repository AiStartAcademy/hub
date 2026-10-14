import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mail";
import { sanitizePlainText } from "@/lib/onboarding-security";
import {
  appUrl,
  ensureUnsubscribeToken,
  resolveDripFrom,
  unsubscribeHeaders,
  unsubscribeUrl,
} from "@/lib/drip/engine";
import { renderEmailShell, renderEmailSubject } from "@/lib/drip/template";
import { createTrackingSigner } from "@/lib/drip/tracking";
import {
  getUpcomingCohorts,
  renderNextCohortLine,
  renderUpcomingCohortsHtml,
} from "@/lib/drip/cohorts";
import { sanitizeEmailHtml } from "./sanitizeHtml";
import { textToEmailHtml } from "./textToEmailHtml";
import type { SendOneOffEmailResult } from "./types";

type SendOneOffEmailInput = {
  contactId: string;
  subject: string;
  html: string;
  mode?: OneOffBodyMode;
  staffId: string | null;
};

export type OneOffBodyMode = "plain" | "html";

type OneOffContact = {
  id: string;
  name: string;
  email: string;
  unsubscribedAt: Date | null;
};

type PreparedOneOffEmail = {
  contact: OneOffContact;
  subject: string;
  body: string;
};

type PrepareOneOffEmailResult =
  | { ok: true; value: PreparedOneOffEmail }
  | { ok: false; error: string };

type OneOffTracking = Parameters<typeof renderEmailShell>[1]["tracking"];

const ONE_OFF_CAMPAIGN_SLUG = "outreach-oneoff";

async function prepareOneOffEmail(input: {
  contactId: string;
  subject: string;
  body: string;
  mode: OneOffBodyMode;
}): Promise<PrepareOneOffEmailResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { id: true, name: true, email: true, unsubscribedAt: true },
  });
  if (!contact) return { ok: false, error: "Lead not found" };
  if (!contact.email.trim()) return { ok: false, error: "Lead has no email address" };

  const subject = sanitizePlainText(input.subject, 200);
  if (!subject) return { ok: false, error: "Email subject is empty" };
  const body = sanitizeEmailHtml(
    input.mode === "plain" ? textToEmailHtml(input.body) : input.body
  );
  if (!sanitizePlainText(body, 50_000, { multiline: true })) {
    return { ok: false, error: "Email body is empty" };
  }

  return { ok: true, value: { contact, subject, body } };
}

async function renderPreparedOneOffEmail(
  prepared: PreparedOneOffEmail,
  tracking?: OneOffTracking
): Promise<{ subject: string; html: string }> {
  const baseAppUrl = appUrl();
  const token = await ensureUnsubscribeToken(prepared.contact.id);
  let cohorts: Awaited<ReturnType<typeof getUpcomingCohorts>> = [];
  try {
    cohorts = await getUpcomingCohorts(baseAppUrl);
  } catch (error) {
    logger.warn(
      { err: error, contactId: prepared.contact.id },
      "[outreach:email] cohort lookup failed; using the cohorts-page fallback"
    );
  }

  const context = {
    name: prepared.contact.name,
    email: prepared.contact.email,
    unsubscribeUrl: unsubscribeUrl(token),
    appUrl: baseAppUrl,
    campaignSlug: ONE_OFF_CAMPAIGN_SLUG,
    upcomingCohortsHtml: renderUpcomingCohortsHtml(cohorts, baseAppUrl, {
      campaign: ONE_OFF_CAMPAIGN_SLUG,
      stepOrder: 1,
    }),
    nextCohortLine: renderNextCohortLine(cohorts),
  };
  const subject = renderEmailSubject(prepared.subject, context);
  if (!subject) throw new Error("Email subject is empty after merge fields are rendered");

  return {
    subject,
    html: renderEmailShell(
      { body: prepared.body, order: 1 },
      { ...context, tracking }
    ),
  };
}

export async function previewOneOffEmail(input: {
  contactId: string;
  subject: string;
  body: string;
  mode: OneOffBodyMode;
}): Promise<
  { ok: true; subject: string; html: string } | { ok: false; error: string }
> {
  const prepared = await prepareOneOffEmail(input);
  if (!prepared.ok) return prepared;

  try {
    // Preview and send share this pipeline; only send adds tracking and persistence/SMTP effects.
    const rendered = await renderPreparedOneOffEmail(prepared.value);
    return { ok: true, ...rendered };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendOneOffEmail(
  input: SendOneOffEmailInput
): Promise<SendOneOffEmailResult> {
  const prepared = await prepareOneOffEmail({
    contactId: input.contactId,
    subject: input.subject,
    body: input.html,
    mode: input.mode ?? "plain",
  });
  if (!prepared.ok) return prepared;
  const { contact, subject: subjectInput } = prepared.value;
  if (contact.unsubscribedAt) return { ok: false, error: "Lead has unsubscribed from email" };

  const baseMetadata = { kind: "oneoff", staffId: input.staffId } as const;
  const sourceEvent = await prisma.emailEvent.create({
    data: {
      contactId: contact.id,
      dripSendId: null,
      type: "SENT",
      subject: subjectInput,
      source: "hub",
      metadata: JSON.stringify(baseMetadata),
    },
    select: { id: true },
  });

  let renderedSubject = subjectInput;
  try {
    const baseAppUrl = appUrl();
    const tracking = await createTrackingSigner({
      kind: "oneoff",
      refId: sourceEvent.id,
      contactId: contact.id,
      baseUrl: baseAppUrl,
    });
    const rendered = await renderPreparedOneOffEmail(
      prepared.value,
      tracking ?? undefined
    );
    renderedSubject = rendered.subject;
    const { from, replyTo } = await resolveDripFrom();

    await prisma.emailEvent.update({
      where: { id: sourceEvent.id },
      data: { subject: renderedSubject, bodyHtml: rendered.html },
    });
    // Idempotent — renderPreparedOneOffEmail already minted it for the body's
    // unsubscribe link; re-reading keeps the header and the link on one token.
    const unsubToken = await ensureUnsubscribeToken(contact.id);
    await sendMail({
      to: contact.email,
      subject: renderedSubject,
      html: rendered.html,
      from,
      replyTo,
      // One-off outreach is nurture mail, not transactional — same bulk rules.
      headers: unsubscribeHeaders(unsubToken, replyTo),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await prisma.emailEvent.update({
        where: { id: sourceEvent.id },
        data: {
          type: "FAILED",
          subject: renderedSubject,
          metadata: JSON.stringify({ ...baseMetadata, error: message.slice(0, 500) }),
        },
      });
    } catch (updateError) {
      logger.error(
        { err: updateError, emailEventId: sourceEvent.id },
        "[outreach:email] failed to mark one-off send as failed"
      );
    }
    logger.error(
      { err: error, contactId: contact.id, emailEventId: sourceEvent.id },
      "[outreach:email] one-off send failed"
    );
    return { ok: false, error: `Email could not be sent: ${message}` };
  }

  try {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastActivityAt: new Date() },
    });
  } catch (error) {
    // SMTP already accepted the message; a CRM rollup failure must not relabel it FAILED.
    logger.error(
      { err: error, contactId: contact.id, emailEventId: sourceEvent.id },
      "[outreach:email] sent one-off email but failed to update contact activity"
    );
  }

  return { ok: true, emailEventId: sourceEvent.id };
}
