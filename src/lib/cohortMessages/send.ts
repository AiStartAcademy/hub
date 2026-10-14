// Cohort messages: preview (read-only) and send (snapshot + enqueue).
//
// Mirrors src/lib/drip/broadcast.ts: this module only creates the campaign and
// its enrollments. Delivery, consent re-checks at send time, the SMS window
// clamp, tracking and the DripSend idempotency ledger all stay tick()'s job.

import { randomBytes } from "node:crypto";
import prisma from "@/lib/prisma";
import { getSecret } from "@/lib/secrets";
import { resolveIanaZone } from "@/lib/sessionInstant";
import { COHORT_MESSAGE_TRIGGER } from "@/lib/drip/constants";
import { isUniqueConstraintViolation } from "@/lib/drip/prismaErrors";
import {
  resolveCohortMessageAudience,
  type CohortMessageRecipient,
} from "./audience";
import {
  mergeFirstName,
  resolveCohortMessageMergeValues,
  validateCohortMessageSms,
} from "./render";

const SMS_FLAG_KEY = "SMS_TRANSACTIONAL_ENABLED";
/** Generous bound for one cohort's enrollments inside a single transaction. */
const SEND_TRANSACTION_TIMEOUT_MS = 30_000;

export type MissingRecipient = { name: string; reason: string };

export type CohortMessagePreview =
  | {
      ok: true;
      total: number;
      email: number;
      sms: number;
      smsEnabled: boolean;
      emailMissing: MissingRecipient[];
      smsMissing: MissingRecipient[];
    }
  | { ok: false; reason: string };

export type SendCohortMessageInput = {
  cohortId: string;
  subject: string;
  emailBody: string;
  smsBody?: string | null;
  sendAt?: Date | null;
  includeInstructors: boolean;
  logisticsConfirmed: boolean;
  idempotencyKey: string;
  sentByUserId: string;
  now?: Date;
};

export type SendCohortMessageResult =
  | {
      ok: true;
      campaignId: string;
      enrolled: number;
      duplicate: boolean;
      /** Present only when an SMS body was given but SMS sending is switched off. */
      smsSkipped?: "disabled";
    }
  | { ok: false; reason: string };

/** Transactional SMS stays dark until Twilio approves the campaign (spec F7). */
export async function isTransactionalSmsEnabled(): Promise<boolean> {
  return (await getSecret(SMS_FLAG_KEY))?.trim().toLowerCase() === "true";
}

function missingList(
  recipients: CohortMessageRecipient[],
  pick: (recipient: CohortMessageRecipient) => string | null
): MissingRecipient[] {
  const missing: MissingRecipient[] = [];
  for (const recipient of recipients) {
    const reason = pick(recipient);
    if (reason) missing.push({ name: recipient.name, reason });
  }
  return missing;
}

/** Who would get what. Reads only: no Contact, campaign, enrollment or send is written. */
export async function previewCohortMessage(input: {
  cohortId: string;
  includeInstructors: boolean;
  now?: Date;
}): Promise<CohortMessagePreview> {
  const audience = await resolveCohortMessageAudience(input.cohortId, {
    includeInstructors: input.includeInstructors,
    ensureContacts: false,
    now: input.now,
  });
  if (!audience) return { ok: false, reason: "Cohort not found" };

  const { recipients } = audience;
  const emailMissing = missingList(recipients, (r) => r.emailReason);
  const smsMissing = missingList(recipients, (r) => r.smsReason);
  return {
    ok: true,
    total: recipients.length,
    email: recipients.length - emailMissing.length,
    sms: recipients.length - smsMissing.length,
    smsEnabled: await isTransactionalSmsEnabled(),
    emailMissing,
    smsMissing,
  };
}

function validateInput(input: SendCohortMessageInput): string | null {
  if (!input.logisticsConfirmed) {
    return "Confirm this is a logistics update, not a promotion, before sending";
  }
  if (!input.subject.trim()) return "Subject is required";
  if (!input.emailBody.trim()) return "Email body is required";
  if (!input.idempotencyKey.trim()) return "Missing idempotency key";
  if (input.sendAt && Number.isNaN(input.sendAt.getTime())) return "sendAt is not a valid date";
  return null;
}

async function existingCampaign(
  idempotencyKey: string
): Promise<{ id: string; enrolled: number } | null> {
  const campaign = await prisma.dripCampaign.findUnique({
    where: { idempotencyKey },
    select: { id: true, _count: { select: { enrollments: true } } },
  });
  return campaign ? { id: campaign.id, enrolled: campaign._count.enrollments } : null;
}

function slugPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "cohort"
  );
}

/**
 * The longest first name in the audience, so the SMS length check covers the
 * worst case of `{firstName}` rather than the template's own length.
 */
function longestFirstName(recipients: CohortMessageRecipient[]): string {
  let longest = "";
  for (const recipient of recipients) {
    const first = mergeFirstName(recipient.name);
    if (first.length > longest.length) longest = first;
  }
  return longest;
}

/**
 * Create one COHORT_MESSAGE campaign and one cohort-scoped enrollment per
 * recipient, atomically. A repeated idempotency key returns the first send's
 * campaign instead of creating anything.
 */
export async function sendCohortMessage(
  input: SendCohortMessageInput
): Promise<SendCohortMessageResult> {
  const now = input.now ?? new Date();
  const invalid = validateInput(input);
  if (invalid) return { ok: false, reason: invalid };

  const idempotencyKey = input.idempotencyKey.trim();
  const prior = await existingCampaign(idempotencyKey);
  if (prior) {
    return { ok: true, campaignId: prior.id, enrolled: prior.enrolled, duplicate: true };
  }

  const cohort = await prisma.cohort.findUnique({
    where: { id: input.cohortId },
    select: {
      id: true,
      slug: true,
      title: true,
      zoomLink: true,
      timezone: true,
      sessions: {
        orderBy: { date: "asc" },
        take: 60,
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
          timezone: true,
          meetingLink: true,
        },
      },
    },
  });
  if (!cohort) return { ok: false, reason: "Cohort not found" };

  const audience = await resolveCohortMessageAudience(cohort.id, {
    includeInstructors: input.includeInstructors,
    ensureContacts: true,
    now,
  });
  if (!audience) return { ok: false, reason: "Cohort not found" };
  const contactIds = [
    ...new Set(
      audience.recipients
        .map((recipient) => recipient.contactId)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  if (!contactIds.length) return { ok: false, reason: "Cohort has no recipients" };

  const smsBody = input.smsBody?.trim() ? input.smsBody : null;
  if (smsBody) {
    const values = resolveCohortMessageMergeValues(
      cohort,
      { name: longestFirstName(audience.recipients) },
      now
    );
    const sms = validateCohortMessageSms(smsBody, values);
    if (!sms.ok) return { ok: false, reason: sms.error };
  }
  const smsEnabled = smsBody ? await isTransactionalSmsEnabled() : false;
  const includeSms = smsBody !== null && smsEnabled;

  const { recipients } = audience;
  const snapshot = {
    sentByUserId: input.sentByUserId,
    includeInstructors: input.includeInstructors,
    total: recipients.length,
    email: recipients.filter((r) => !r.emailReason).length,
    sms: includeSms ? recipients.filter((r) => !r.smsReason).length : 0,
    smsStatus: smsBody ? (smsEnabled ? "queued" : "disabled") : "none",
    sendAt: input.sendAt ? input.sendAt.toISOString() : null,
  };
  const day = now.toISOString().slice(0, 10);
  const runAt = input.sendAt ?? now;

  try {
    const campaignId = await prisma.$transaction(
      async (tx) => {
        const campaign = await tx.dripCampaign.create({
          data: {
            slug: `cohort-message-${slugPart(cohort.slug || cohort.id)}-${day}-${randomBytes(4).toString("hex")}`,
            name: `Cohort message — ${cohort.title} — ${day}`,
            trigger: COHORT_MESSAGE_TRIGGER,
            status: "ACTIVE",
            autoEnroll: false,
            // WON is exactly who a cohort message is for: never status-exit.
            exitOnStatuses: "[]",
            priority: 0,
            segment: JSON.stringify({ cohorts: [cohort.id] }),
            timezone: resolveIanaZone(cohort.timezone),
            // Email goes out at once; the engine clamps SMS steps on its own.
            sendWindowStartHour: 0,
            sendWindowEndHour: 24,
            skipWeekends: false,
            cohortId: cohort.id,
            logisticsConfirmedAt: now,
            idempotencyKey,
            sentAt: now,
            audienceSnapshot: JSON.stringify(snapshot),
            steps: {
              create: [
                {
                  order: 1,
                  channel: "EMAIL",
                  delayHours: 0,
                  subject: input.subject.trim(),
                  body: input.emailBody,
                },
                ...(includeSms && smsBody
                  ? [{ order: 2, channel: "SMS", delayHours: 0, subject: "SMS", body: smsBody }]
                  : []),
              ],
            },
          },
          select: { id: true },
        });
        // Created directly, never through enrollContact: like cohort reminders,
        // a cohort message is outside the one-active-campaign-per-lead rule.
        for (const contactId of contactIds) {
          await tx.dripEnrollment.create({
            data: {
              campaignId: campaign.id,
              contactId,
              cohortId: cohort.id,
              status: "ACTIVE",
              lastStepOrder: 0,
              enrolledAt: now,
              nextRunAt: runAt,
            },
          });
        }
        return campaign.id;
      },
      { timeout: SEND_TRANSACTION_TIMEOUT_MS }
    );

    return {
      ok: true,
      campaignId,
      enrolled: contactIds.length,
      duplicate: false,
      ...(smsBody && !smsEnabled ? { smsSkipped: "disabled" as const } : {}),
    };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      // A concurrent submit with the same key committed first.
      const winner = await existingCampaign(idempotencyKey);
      if (winner) {
        return { ok: true, campaignId: winner.id, enrolled: winner.enrolled, duplicate: true };
      }
    }
    throw new Error(`Failed to send cohort message for cohort ${cohort.id}`, { cause: error });
  }
}
