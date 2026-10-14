// src/lib/drip/engine.ts
// The drip runtime: enrollment sweep, due-step execution, exits, unsubscribes.
//
// Invariants this module upholds (each one is a way drip systems normally go wrong):
//
//  1. **One active enrollment per lead, globally.** A lead matching three campaigns
//     joins exactly one — the lowest `priority`. Without this, overlapping segments
//     silently triple someone's inbox.
//  2. **One send per (enrollment, step), forever.** Guaranteed by the DripSend unique
//     constraint, claimed *before* the SMTP call. A crash, a double-tick, or two
//     concurrent runners cannot double-send.
//  3. **Unsubscribe wins everywhere.** Checked in the segment matcher, at enrollment,
//     and again immediately before each send.
//  4. **Segment membership is evaluated at enrollment only.** Re-checking per step
//     would eject a lead from a `status: NEW` nurture the moment staff marked them
//     CONTACTED. Ongoing exits are driven by `exitOnStatuses`, which is explicit.
//  5. **Deferral, never early sending.** A step due outside the send window moves to
//     the next opening; nothing is dropped and nothing goes out at 3am.

import { randomBytes } from "node:crypto";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { sendMail, fromHeader, escapeHtml } from "@/lib/mail";
import {
  mergeFirstName,
  renderCohortMessageSms,
  renderCohortMessageText,
  resolveCohortMessageMergeValues,
} from "@/lib/cohortMessages/render";
import { getSecret } from "@/lib/secrets";
import { sanitizePlainText } from "@/lib/onboarding-security";
import {
  candidateWhere,
  matchesSegment,
  parseSegment,
  parseTags,
  type DripSegment,
} from "./segment";
import {
  ABANDONED_TAG,
  MEMBERSHIP_ABANDONED_TAG,
  PROGRAM_ABANDONED_TAG,
  syncAbandonedCheckouts,
  type AbandonedSyncResult,
} from "./abandoned";
import {
  normalizeWindow,
  scheduleStep,
  isWithinWindow,
  clampWindowForCalls,
  clampWindowForSms,
} from "./schedule";
import { callabilityReason, smsableReason, type SmsPurpose } from "@/lib/phone";
import { certificateMergeContext } from "@/lib/drip/certificateNotify";
import { renderSmsBody } from "@/lib/sms/render";
import { sendContactSms } from "@/lib/sms/send";
import { bookingUrlForContact } from "@/lib/booking/bookingUrl";
import { initiateCall } from "@/lib/vapi/client";
import {
  DRIP_FROM,
  DRIP_REPLY_TO,
  renderStepHtml,
  renderSubject,
} from "./template";
import {
  getUpcomingCohorts,
  renderNextCohortLine,
  renderUpcomingCohortsHtml,
} from "./cohorts";
import { createTrackingSigner } from "./tracking";
import {
  COHORT_ANCHOR_SELECT,
  COHORT_TRIGGER,
  LEAD_TRIGGER,
  cohortMergeContext,
  cohortStartInstant,
  isCohortStepStale,
  cohortTag,
  enrollInCohortReminderCampaigns,
  stepDueAt,
  type CohortForAnchor,
} from "./cohortAnchor";
import { resolveBroadcastAudience } from "./audience";
import {
  BROADCAST_TRIGGER,
  CERTIFICATE_TRIGGER,
  COHORT_MESSAGE_TRIGGER,
} from "./constants";
import {
  COURSE_EMAIL_TRIGGERS,
  emailScopeForCampaignTrigger,
  emailScopeReason,
  type EmailScope,
} from "./emailScope";

/**
 * Cohort reminders and certificate notices are service messages about a program
 * the person is in; every other campaign is promotional. Twilio A2P requires
 * separate consent for the two, so SMS steps are gated by this purpose.
 */
export function smsPurposeForCampaignTrigger(trigger: string): SmsPurpose {
  return trigger === COHORT_TRIGGER ||
    trigger === COHORT_MESSAGE_TRIGGER ||
    trigger === CERTIFICATE_TRIGGER
    ? "transactional"
    : "marketing";
}

/**
 * Writes an EmailEvent, and optionally bumps the contact's last activity.
 *
 * Deliberately swallows its own errors: this is instrumentation. A failure to
 * record that a message was sent must never propagate into the send path, where
 * it would mark an email that genuinely went out as FAILED and — worse — leave
 * it eligible to be treated as un-sent.
 */
async function recordEmailEvent(p: {
  contactId: string;
  dripSendId?: string | null;
  type: string;
  subject?: string | null;
  url?: string | null;
  /** SENT rows only: the rendered HTML the recipient received. */
  bodyHtml?: string | null;
  metadata?: Record<string, unknown>;
  bumpActivity: boolean;
}): Promise<void> {
  try {
    await prisma.emailEvent.create({
      data: {
        contactId: p.contactId,
        dripSendId: p.dripSendId ?? null,
        type: p.type,
        subject: p.subject ?? null,
        url: p.url ?? null,
        bodyHtml: p.bodyHtml ?? null,
        metadata: p.metadata ? JSON.stringify(p.metadata) : null,
      },
    });
    if (p.bumpActivity) {
      await prisma.contact.update({
        where: { id: p.contactId },
        data: { lastActivityAt: new Date() },
      });
    }
  } catch {
    // Instrumentation only — never let it break or misreport the send.
  }
}

// Re-exported for existing server-side importers (actions.ts, etc). Client
// components must import from "@/lib/drip/constants" directly — never from
// this file, which pulls in nodemailer via sendMail above.
export {
  CAMPAIGN_STATUSES,
  ENROLLMENT_STATUSES,
  STEP_CHANNELS,
  type CampaignStatus,
  type StepChannel,
} from "./constants";

/** Safety rail: how many leads one campaign may absorb in a single tick. */
const ENROLL_LIMIT_PER_CAMPAIGN = 200;
/** Safety rail: how many emails one tick may send, across all campaigns. */
const DEFAULT_SEND_LIMIT = 100;

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function parseStringList(raw: string | null | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : fallback;
  } catch {
    return fallback;
  }
}

// ─── Unsubscribe ─────────────────────────────────────────────────────

/**
 * Return the contact's unsubscribe token, minting one on first use. Tokens are
 * long-lived and per-contact so a link in a months-old email still works.
 */
export async function ensureUnsubscribeToken(contactId: string): Promise<string> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { unsubscribeToken: true },
  });
  if (contact?.unsubscribeToken) return contact.unsubscribeToken;

  const token = randomBytes(24).toString("base64url");
  const updated = await prisma.contact.update({
    where: { id: contactId },
    data: { unsubscribeToken: token },
    select: { unsubscribeToken: true },
  });
  return updated.unsubscribeToken ?? token;
}

export function unsubscribeUrl(token: string): string {
  return `${appUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function courseUnsubscribeUrl(token: string): string {
  return `${unsubscribeUrl(token)}&scope=course`;
}

export function emailUnsubscribeUrlForScope(token: string, scope: EmailScope): string {
  return scope === "course" ? courseUnsubscribeUrl(token) : unsubscribeUrl(token);
}

/**
 * RFC 8058 one-click unsubscribe headers for nurture mail.
 *
 * Gmail and Yahoo require these on bulk mail; without them our nurture sends
 * look like unmanaged bulk and get filtered. The `mailto:` form is the legacy
 * fallback, the `https:` form is what the one-click button POSTs to
 * (`/api/unsubscribe`, not the human-facing `/unsubscribe` page — a POST
 * endpoint must not be a rendered page).
 *
 * Transactional mail (verification, invites, receipts) must NOT carry these:
 * a user can't opt out of a password-reset mail, and claiming otherwise is
 * itself a deliverability and compliance problem.
 */
export function unsubscribeHeaders(
  token: string,
  replyTo: string,
  scope: EmailScope = "marketing"
): { "List-Unsubscribe": string; "List-Unsubscribe-Post": string } {
  const scopeParam = scope === "course" ? "&scope=course" : "";
  const postUrl = `${appUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}${scopeParam}`;
  return {
    "List-Unsubscribe": `<mailto:${replyTo}?subject=unsubscribe>, <${postUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Honour an unsubscribe link. Idempotent — a second click (or a mail client
 * prefetching the URL twice) reports success without changing anything.
 *
 * Scoped (see ./emailScope.ts): "marketing" sets unsubscribedAt and exits only
 * non-course enrollments; "course" sets courseEmailOptOutAt and exits only
 * course-trigger enrollments. Neither scope touches the other field.
 */
export async function unsubscribeByToken(
  token: string,
  scope: EmailScope = "marketing"
): Promise<{ ok: true; email: string; alreadyDone: boolean } | { ok: false }> {
  if (!token) return { ok: false };
  const contact = await prisma.contact.findUnique({
    where: { unsubscribeToken: token },
    select: {
      id: true,
      email: true,
      unsubscribedAt: true,
      courseEmailOptOutAt: true,
    },
  });
  if (!contact) return { ok: false };

  if (emailScopeReason(contact, scope)) {
    return { ok: true, email: contact.email, alreadyDone: true };
  }

  const now = new Date();
  if (scope === "course") {
    // Course enrollments are NOT exited: runDueSteps skips their EMAIL steps
    // from now on, while their SMS steps still honour SMS consent on their own.
    await prisma.contact.update({
      where: { id: contact.id },
      data: { courseEmailOptOutAt: now },
    });
  } else {
    await prisma.$transaction([
      prisma.contact.update({
        where: { id: contact.id },
        data: { unsubscribedAt: now },
      }),
      prisma.dripEnrollment.updateMany({
        where: {
          contactId: contact.id,
          status: "ACTIVE",
          campaign: { trigger: { notIn: [...COURSE_EMAIL_TRIGGERS] } },
        },
        data: {
          status: "EXITED",
          exitedAt: now,
          exitReason: "unsubscribed",
          nextRunAt: null,
        },
      }),
    ]);
  }

  // Attribute the opt-out to the most recent message we sent them, so we learn
  // WHICH email drove it. Note this is never recorded as a CLICKED event — the
  // unsubscribe link is excluded from click wrapping on purpose.
  const lastSend = await prisma.dripSend.findFirst({
    where: { contactId: contact.id },
    orderBy: { sentAt: "desc" },
    select: { id: true, subject: true },
  });
  await recordEmailEvent({
    contactId: contact.id,
    dripSendId: lastSend?.id ?? null,
    type: "UNSUBSCRIBED",
    subject: lastSend?.subject ?? null,
    bumpActivity: true,
  });

  return { ok: true, email: contact.email, alreadyDone: false };
}

// ─── Enrollment ──────────────────────────────────────────────────────

type CampaignRow = {
  id: string;
  slug: string;
  segment: string;
  autoEnroll: boolean;
  priority: number;
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  skipWeekends: boolean;
  steps: Array<{ order: number; delayHours: number }>;
};

function windowOf(campaign: {
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  skipWeekends: boolean;
}) {
  return normalizeWindow({
    timezone: campaign.timezone,
    sendWindowStartHour: campaign.sendWindowStartHour,
    sendWindowEndHour: campaign.sendWindowEndHour,
    skipWeekends: campaign.skipWeekends,
  });
}

/**
 * Enroll one contact into one campaign. Returns why it declined, so callers
 * (the sweep, the admin "Enroll" button) can report rather than fail silently.
 */
export async function enrollContact(
  campaignId: string,
  contactId: string,
  options: { now?: Date; allowConcurrent?: boolean } = {}
): Promise<{ ok: true; enrollmentId: string } | { ok: false; reason: string }> {
  const now = options.now ?? new Date();

  const [campaign, contact] = await Promise.all([
    prisma.dripCampaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { order: "asc" }, select: { order: true, delayHours: true } } },
    }),
    prisma.contact.findUnique({ where: { id: contactId } }),
  ]);

  if (!campaign) return { ok: false, reason: "Campaign not found" };
  if (!contact) return { ok: false, reason: "Contact not found" };
  if (campaign.status !== "ACTIVE") return { ok: false, reason: "Campaign is not active" };
  if (!campaign.steps.length) return { ok: false, reason: "Campaign has no steps" };
  // Only the marketing opt-out blocks enrollment. A course-scope campaign
  // enrolls a course-email opt-out anyway: runDueSteps skips just its EMAIL
  // steps, so SMS steps still reach someone with transactional SMS consent.
  if (
    emailScopeForCampaignTrigger(campaign.trigger) === "marketing" &&
    emailScopeReason(contact, "marketing")
  ) {
    return { ok: false, reason: "Contact unsubscribed" };
  }

  // Cohort reminder enrollments never count toward (or against) the
  // one-active-campaign-per-lead rule — they are quasi-transactional and must
  // not be suppressed by a nurture campaign, nor block one.
  const existing = await prisma.dripEnrollment.findFirst({
    where: {
      contactId,
      ...(options.allowConcurrent ? { campaignId } : {}),
      ...(options.allowConcurrent
        ? {}
        : { status: "ACTIVE", campaign: { trigger: LEAD_TRIGGER } }),
    },
    select: { id: true, campaignId: true, status: true },
  });
  if (existing) {
    return {
      ok: false,
      reason:
        existing.campaignId === campaignId
          ? `Already enrolled (${existing.status.toLowerCase()})`
          : "Already active in another campaign",
    };
  }
  // Even with allowConcurrent, the (campaignId, contactId, cohortId) unique
  // constraint holds — manual/admin enrollments always carry cohortId "".
  const duplicate = await prisma.dripEnrollment.findUnique({
    where: {
      campaignId_contactId_cohortId: { campaignId, contactId, cohortId: "" },
    },
    select: { id: true },
  });
  if (duplicate) return { ok: false, reason: "Already enrolled in this campaign" };

  const firstStep = campaign.steps[0];
  const enrollment = await prisma.dripEnrollment.create({
    data: {
      campaignId,
      contactId,
      status: "ACTIVE",
      lastStepOrder: 0,
      enrolledAt: now,
      nextRunAt: scheduleStep(now, firstStep.delayHours, windowOf(campaign)),
    },
    select: { id: true },
  });
  return { ok: true, enrollmentId: enrollment.id };
}

/**
 * Sweep every ACTIVE + autoEnroll campaign (lowest priority first) and enroll
 * newly-matching leads. Runs before sends in each tick, so a lead captured
 * minutes ago can receive its first step in the same run.
 */
export async function enrollEligibleLeads(
  now: Date = new Date()
): Promise<{ enrolled: number; perCampaign: Record<string, number> }> {
  const campaigns = (await prisma.dripCampaign.findMany({
    // This exact trigger is a safety boundary: COHORT_SCHEDULE has its own
    // sweep, while BROADCAST is enrolled only by an explicit sendBroadcast().
    where: { status: "ACTIVE", autoEnroll: true, trigger: LEAD_TRIGGER },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: { steps: { orderBy: { order: "asc" }, select: { order: true, delayHours: true } } },
  })) as CampaignRow[];

  const perCampaign: Record<string, number> = {};
  let enrolled = 0;

  for (const campaign of campaigns) {
    if (!campaign.steps.length) continue;
    const segment = parseSegment(campaign.segment);

    const candidates = await prisma.contact.findMany({
      where: {
        ...candidateWhere(segment, now),
        // Exclude anyone already in this campaign, or busy in another LEAD
        // campaign. An active cohort-reminder enrollment doesn't make a lead
        // "busy" — reminders and nurture run side by side.
        dripEnrollments: {
          none: {
            OR: [
              { campaignId: campaign.id },
              { status: "ACTIVE", campaign: { trigger: LEAD_TRIGGER } },
            ],
          },
        },
      },
      select: {
        id: true,
        status: true,
        source: true,
        tags: true,
        createdAt: true,
        lastActivityAt: true,
        unsubscribedAt: true,
        phone: true,
        phoneConsentAt: true,
        smsMarketingConsentAt: true,
        smsTransactionalConsentAt: true,
        doNotCall: true,
        smsOptOutAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: ENROLL_LIMIT_PER_CAMPAIGN,
    });

    const window = windowOf(campaign);
    const firstStep = campaign.steps[0];
    let count = 0;

    for (const candidate of candidates) {
      if (!matchesSegment(candidate, segment, now)) continue;
      try {
        await prisma.dripEnrollment.create({
          data: {
            campaignId: campaign.id,
            contactId: candidate.id,
            status: "ACTIVE",
            lastStepOrder: 0,
            enrolledAt: now,
            nextRunAt: scheduleStep(now, firstStep.delayHours, window),
          },
        });
        count += 1;
      } catch {
        // Unique-constraint race with a concurrent tick or a manual enroll — fine.
      }
    }

    if (count) perCampaign[campaign.slug] = count;
    enrolled += count;
  }

  return { enrolled, perCampaign };
}

/**
 * Safety-net sweep for COHORT_SCHEDULE campaigns: every registrant of every
 * upcoming cohort — paid Enrollment rows (any source) and free registrants
 * tagged `cohort:<slug>` — ends up with a cohort-scoped DripEnrollment even if
 * the fire-point call at signup time was missed (deploy gap, webhook retry
 * path, Luma import). Delegates per-person work to
 * enrollInCohortReminderCampaigns, which is idempotent by unique constraint.
 */
export async function enrollCohortAudiences(
  now: Date = new Date()
): Promise<{ enrolled: number; perCohort: Record<string, number> }> {
  // Keep the trigger exact: BROADCAST must never enter an automatic sweep.
  const campaignCount = await prisma.dripCampaign.count({
    where: { status: "ACTIVE", trigger: COHORT_TRIGGER },
  });
  if (!campaignCount) return { enrolled: 0, perCohort: {} };

  const horizon = new Date(now.getTime() + 60 * 24 * 3_600_000);
  const cohorts = await prisma.cohort.findMany({
    where: {
      status: { in: ["ENROLLMENT", "IN_PROGRESS"] },
      startDate: { not: null, lte: horizon },
    },
    select: { ...COHORT_ANCHOR_SELECT, enrollments: { select: { user: { select: { email: true, name: true } } } } },
  });

  const perCohort: Record<string, number> = {};
  let enrolled = 0;

  for (const cohort of cohorts) {
    const start = cohortStartInstant(cohort, now);
    if (!start || start.getTime() <= now.getTime()) continue;

    // Paid/manual registrants (Users) + free registrants (tagged Contacts).
    const recipients = new Map<string, string | null>();
    for (const e of cohort.enrollments) {
      if (e.user?.email) recipients.set(e.user.email.toLowerCase(), e.user.name);
    }
    const tagged = await prisma.contact.findMany({
      where: { tags: { contains: `"${cohortTag(cohort)}"` } },
      select: { email: true, name: true },
    });
    for (const c of tagged) {
      if (!recipients.has(c.email.toLowerCase())) recipients.set(c.email.toLowerCase(), c.name);
    }

    let count = 0;
    for (const [email, name] of recipients) {
      // The welcome step is skip-safe here: anyone reaching the sweep without a
      // fire-point enrollment still deserves the full remaining sequence.
      const created = await enrollInCohortReminderCampaigns(email, name, cohort.id, { now });
      if (created) count += 1;
    }
    if (count) perCohort[cohort.slug || cohort.id] = count;
    enrolled += count;
  }

  return { enrolled, perCohort };
}

// ─── Sending ─────────────────────────────────────────────────────────

export type TickResult = {
  ranAt: string;
  enrolled: number;
  perCampaign: Record<string, number>;
  sent: number;
  tasks: number;
  calls: number;
  smsSent: number;
  deferred: number;
  failed: number;
  exited: number;
  completed: number;
  errors: string[];
  /** Abandoned-cart → lead sync, omitted when the tick ran with `skipEnroll`. */
  abandoned?: AbandonedSyncResult;
  /** Cohort reminder sweep, omitted when the tick ran with `skipEnroll`. */
  cohortAudiences?: { enrolled: number; perCohort: Record<string, number> };
};

// Commerce context for cart-recovery sends: the contact's latest abandoned
// checkout, so copy can say "your seat in <cohort> ($150)" and link a resume
// URL instead of a generic /cohorts page. Only queried for contacts that
// actually carry an abandoned tag — every other campaign skips the lookup.
async function abandonedCheckoutContext(contact: {
  email: string;
  tags: string | null;
}): Promise<{
  abandonedItemTitle?: string;
  abandonedAmount?: string;
  resumeCheckoutUrl?: string;
}> {
  const tags = parseTags(contact.tags);
  const cohortAbandoned = tags.includes(ABANDONED_TAG);
  const membershipAbandoned = tags.includes(MEMBERSHIP_ABANDONED_TAG);
  const programAbandoned = tags.includes(PROGRAM_ABANDONED_TAG);
  if (!cohortAbandoned && !membershipAbandoned && !programAbandoned) return {};

  const formatUsd = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      cents / 100
    );

  try {
    if (cohortAbandoned) {
      const payment = await prisma.payment.findFirst({
        where: {
          buyerEmail: contact.email,
          cohortId: { not: null },
          status: { in: ["failed", "pending"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          amount: true,
          status: true,
          checkoutUrl: true,
          cohort: { select: { title: true } },
        },
      });
      if (payment) {
        return {
          abandonedItemTitle: payment.cohort?.title ?? undefined,
          abandonedAmount: formatUsd(payment.amount),
          // Only `failed` rows carry a live URL: the webhook rewrote it to
          // Stripe's after-expiration recovery URL. A still-`pending` row's
          // original session URL is dead by the time the first email fires
          // (TTL 30 min < first step +1h) — fall back to /cohorts instead.
          resumeCheckoutUrl:
            payment.status === "failed"
              ? (payment.checkoutUrl ?? undefined)
              : undefined,
        };
      }
    }
    if (programAbandoned) {
      const payment = await prisma.payment.findFirst({
        where: {
          buyerEmail: contact.email,
          programId: { not: null },
          status: { in: ["failed", "pending"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          amount: true,
          status: true,
          checkoutUrl: true,
          program: { select: { name: true } },
        },
      });
      if (payment) {
        return {
          abandonedItemTitle: payment.program?.name ?? undefined,
          abandonedAmount: formatUsd(payment.amount),
          // Same rule as the cohort branch: only `failed` rows carry a live
          // after-expiration recovery URL; a still-`pending` session URL is
          // dead before the first step fires.
          resumeCheckoutUrl:
            payment.status === "failed"
              ? (payment.checkoutUrl ?? undefined)
              : undefined,
        };
      }
    }
    if (membershipAbandoned) {
      const membership = await prisma.membership.findFirst({
        where: {
          buyerEmail: contact.email,
          status: { in: ["expired", "pending"] },
        },
        orderBy: { createdAt: "desc" },
        select: { amount: true, tier: true },
      });
      if (membership) {
        return {
          abandonedItemTitle: brand.products.membership,
          abandonedAmount: `${formatUsd(membership.amount)}/mo`,
          // No resume URL: subscription sessions get no after-expiration
          // recovery URL, so the stored one is dead. Falls back to the
          // membership page, where they can start a fresh checkout.
        };
      }
    }
  } catch {
    // Merge fields fall back to safe generic copy — never fail the send.
  }
  return {};
}

async function upcomingCohortsOrFallback(baseAppUrl: string) {
  try {
    return await getUpcomingCohorts(baseAppUrl);
  } catch {
    // This merge block is identical for every recipient and already has a safe
    // empty-state renderer, so cohort-read failure should degrade the token
    // rather than aborting unrelated sends or blocking a staff test preview.
    return [];
  }
}

/** Extract the bare address from a mailbox string ("Name" <a@b.c> → a@b.c),
 *  or return the input unchanged if it's already bare. Used for replyTo,
 *  which must be a plain address, not a display-name mailbox. */
export function bareAddress(mailbox: string): string {
  const match = mailbox.match(/<([^>]+)>/);
  return (match ? match[1] : mailbox).trim();
}

/**
 * Resolve the drip From/Reply-To address. Reads the managed `DRIP_EMAIL_FROM`
 * key (Integrations → Settings, src/lib/secrets.ts) so staff can change the
 * sending address from the admin UI instead of filing a redeploy — falls back
 * to DRIP_FROM/DRIP_REPLY_TO from ./template.ts if the key is unset or the
 * secrets read fails, so a config miss degrades to a known-good sender rather
 * than blocking sends.
 */
export async function resolveDripFrom(): Promise<{ from: string; replyTo: string }> {
  let configured: string | undefined;
  try {
    configured = (await getSecret("DRIP_EMAIL_FROM"))?.trim();
  } catch {
    configured = undefined;
  }
  if (!configured) return { from: DRIP_FROM, replyTo: DRIP_REPLY_TO };
  return { from: fromHeader(configured), replyTo: bareAddress(configured) };
}

/** `{{token}}` SMS rendering for every campaign except cohort messages. */
async function renderCampaignSms(
  body: string,
  contact: { id: string; name: string | null },
  extra: { certificateUrl?: string; cohortName?: string }
): Promise<string> {
  const bookingUrl = await bookingUrlForContact(contact.id);
  return renderSmsBody(body.replace(/\{\{booking_url\}\}/g, () => bookingUrl ?? ""), {
    firstName: contact.name?.trim().split(/\s+/)[0],
    name: contact.name,
    bookingUrl,
    certificateUrl: extra.certificateUrl,
    cohortName: extra.cohortName,
  });
}

async function exitEnrollment(id: string, reason: string, now: Date) {
  await prisma.dripEnrollment.update({
    where: { id },
    data: { status: "EXITED", exitedAt: now, exitReason: reason, nextRunAt: null },
  });
}

/**
 * Execute every enrollment whose next step is due. Bounded by `limit` so one tick
 * has a predictable cost and cannot empty the queue into an SMTP rate limit.
 */
export async function runDueSteps(
  now: Date = new Date(),
  limit: number = DEFAULT_SEND_LIMIT
): Promise<Omit<TickResult, "ranAt" | "enrolled" | "perCampaign">> {
  const baseAppUrl = appUrl();
  const due = await prisma.dripEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: Math.max(1, limit),
    include: {
      contact: true,
      campaign: { include: { steps: { orderBy: { order: "asc" } } } },
    },
  });

  let sent = 0;
  let tasks = 0;
  let calls = 0;
  let smsSent = 0;
  let deferred = 0;
  let failed = 0;
  let exited = 0;
  let completed = 0;
  const errors: string[] = [];
  const touchedBroadcastCampaignIds = new Set<string>();
  let upcomingCohortsPromise: Promise<Awaited<ReturnType<typeof getUpcomingCohorts>>> | null = null;

  const upcomingCohortsForTick = async () => {
    if (!upcomingCohortsPromise) {
      upcomingCohortsPromise = upcomingCohortsOrFallback(baseAppUrl);
    }
    return upcomingCohortsPromise;
  };

  // Same address for every recipient this tick — resolve once, not per send.
  let dripFromPromise: ReturnType<typeof resolveDripFrom> | null = null;
  const dripFromForTick = async () => {
    if (!dripFromPromise) dripFromPromise = resolveDripFrom();
    return dripFromPromise;
  };

  // Cohort rows for COHORT_SCHEDULE enrollments — one DB read per cohort per
  // tick, however many registrants it has due.
  const cohortCache = new Map<
    string,
    { cohort: CohortForAnchor; start: Date | null } | null
  >();
  const cohortForTick = async (cohortId: string) => {
    if (!cohortCache.has(cohortId)) {
      const cohort = await prisma.cohort.findUnique({
        where: { id: cohortId },
        select: COHORT_ANCHOR_SELECT,
      });
      cohortCache.set(
        cohortId,
        cohort ? { cohort, start: cohortStartInstant(cohort, now) } : null
      );
    }
    return cohortCache.get(cohortId) ?? null;
  };

  for (const enrollment of due) {
    const { campaign, contact } = enrollment;
    if (campaign.trigger === BROADCAST_TRIGGER) {
      touchedBroadcastCampaignIds.add(campaign.id);
    }

    // Campaign paused/archived mid-flight: hold position, don't exit the lead.
    if (campaign.status !== "ACTIVE") {
      await prisma.dripEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "PAUSED", nextRunAt: null },
      });
      continue;
    }

    // Marketing opt-out ends the whole enrollment. A course opt-out only skips
    // the EMAIL steps of a course campaign (see skipReason below): the student
    // may still have consented to transactional SMS for the same message.
    const emailScope = emailScopeForCampaignTrigger(campaign.trigger);
    const optOutReason = emailScopeReason(contact, emailScope);
    if (optOutReason && emailScope === "marketing") {
      await exitEnrollment(enrollment.id, optOutReason, now);
      exited += 1;
      continue;
    }

    const isCohortCampaign = campaign.trigger === COHORT_TRIGGER;
    const isCertificateCampaign = campaign.trigger === CERTIFICATE_TRIGGER;

    // Status exits are a nurture concept. Cohort reminders go to buyers — a
    // WON contact (they bought!) must still get "class starts tomorrow".
    if (!campaignSkipsStatusExits(campaign.trigger)) {
      const exitStatuses = parseStringList(campaign.exitOnStatuses, ["WON", "LOST"]);
      if (exitStatuses.includes(contact.status ?? "NEW")) {
        await exitEnrollment(enrollment.id, "status_exit", now);
        exited += 1;
        continue;
      }
    }

    const step = campaign.steps.find((s) => s.order === enrollment.lastStepOrder + 1);
    if (!step) {
      await prisma.dripEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED", completedAt: now, nextRunAt: null },
      });
      completed += 1;
      continue;
    }

    // Resolve the anchoring cohort once per (tick, cohort). A vanished cohort
    // ends the enrollment — there is nothing left to remind anyone about.
    const cohortInfo = enrollment.cohortId
      ? await cohortForTick(enrollment.cohortId)
      : null;
    if (enrollment.cohortId && !cohortInfo) {
      await exitEnrollment(enrollment.id, "cohort_missing", now);
      exited += 1;
      continue;
    }

    // Cohort reminders ignore the campaign send window: T-2h before a 9am
    // class is 7am, and it must go out anyway. Deferral would defeat the point.
    const window = campaignUsesAllDaySendWindow(campaign.trigger)
      ? normalizeWindow({ sendWindowStartHour: 0, sendWindowEndHour: 24, timezone: campaign.timezone })
      : windowOf(campaign);
    const stepWindow =
      step.channel === "CALL"
        ? clampWindowForCalls(window)
        : step.channel === "SMS"
          ? clampWindowForSms(window)
          : window;
    if (!isWithinWindow(now, stepWindow)) {
      await prisma.dripEnrollment.update({
        where: { id: enrollment.id },
        data: { nextRunAt: scheduleStep(now, 0, stepWindow) },
      });
      deferred += 1;
      continue;
    }

    // Missed-window guard: a stalled cron must never fire "starting in 2 hours"
    // after the class has started (or long after the step's moment passed).
    // Claim the send as SKIPPED so the ledger shows why nothing was mailed,
    // then let the cursor advance below.
    let skipStale = false;
    if (appliesCohortStartGuard(campaign.trigger, step.anchor) && cohortInfo) {
      skipStale = isCohortStepStale({
        due: stepDueAt(step, cohortInfo.start, enrollment.enrolledAt),
        cohortStart: cohortInfo.start,
        now,
        // The anchor can move forward between ticks (the next session rolls
        // over); a step whose due time has drifted far past the moment it was
        // scheduled for belongs to the old anchor, not this one.
        scheduledFor: enrollment.nextRunAt,
      });
    }
    // Why this step is claimed as SKIPPED instead of delivered, if it is.
    const skipReason: string | null = skipStale
      ? "missed window (cohort reminder past due)"
      : optOutReason && step.channel === "EMAIL"
        ? optOutReason
        : null;

    // Cohort messages carry their own `{field}` merge syntax, resolved here at
    // send time from the live cohort (next session, its join link).
    const isCohortMessage = campaign.trigger === COHORT_MESSAGE_TRIGGER;
    const messageValues =
      isCohortMessage && cohortInfo
        ? resolveCohortMessageMergeValues(
            {
              ...cohortInfo.cohort,
              sessions: (cohortInfo.cohort.sessions ?? []).map((session) => ({
                ...session,
                id: session.id ?? "",
                meetingLink: session.meetingLink ?? null,
              })),
            },
            contact,
            now
          )
        : isCohortMessage
          ? { firstName: mergeFirstName(contact.name) }
          : null;
    const renderStep = messageValues
      ? {
          ...step,
          subject: renderCohortMessageText(step.subject, messageValues),
          body: renderCohortMessageText(step.body, messageValues, { escape: escapeHtml }),
        }
      : step;

    // Build the merge context up front so the DripSend row can snapshot the
    // subject that actually goes out rather than the raw `{{first_name}}`
    // template. Minting the unsubscribe token is idempotent and is not the
    // external send, so doing it before the claim is safe — the claim still
    // precedes the SMTP call, which is what the idempotency invariant protects.
    // Hoisted out of the merge context: the raw token is also what the
    // List-Unsubscribe headers need at send time.
    const unsubToken =
      step.channel === "EMAIL" && !skipReason ? await ensureUnsubscribeToken(contact.id) : null;
    const ctx =
      unsubToken
        ? {
            upcomingCohorts: await upcomingCohortsForTick(),
            name: contact.name,
            email: contact.email,
            unsubscribeUrl: emailUnsubscribeUrlForScope(unsubToken, emailScope),
            appUrl: baseAppUrl,
            campaignSlug: campaign.slug,
            emailScope,
            bookingUrl: /\{\{\s*booking_url\s*\}\}/i.test(step.body)
              ? await bookingUrlForContact(contact.id)
              : undefined,
          }
        : null;
    const certificateCtx =
      isCertificateCampaign && enrollment.cohortId
        ? await certificateMergeContext(contact, enrollment.cohortId, baseAppUrl)
        : undefined;
    const renderedCtx = ctx
      ? {
          ...ctx,
          upcomingCohortsHtml: renderUpcomingCohortsHtml(ctx.upcomingCohorts, baseAppUrl, {
            campaign: campaign.slug,
            stepOrder: step.order,
          }),
          nextCohortLine: renderNextCohortLine(ctx.upcomingCohorts),
          ...(await abandonedCheckoutContext(contact)),
          ...(cohortInfo
            ? cohortMergeContext(cohortInfo.cohort, cohortInfo.start, baseAppUrl, now)
            : {}),
          ...certificateCtx,
        }
      : null;

    // ── Claim the send BEFORE doing any I/O. The unique constraint on
    // (enrollmentId, stepId) is what makes the whole loop safe to re-run.
    let claimedSend: { id: string } | null = null;
    try {
      claimedSend = await prisma.dripSend.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: step.id,
          contactId: contact.id,
          // TASK sends nothing (SKIPPED); delivery channels claim optimistically as
          // SENT and are downgraded to FAILED/SKIPPED below if the attempt dies.
          status: step.channel === "TASK" || skipReason ? "SKIPPED" : "SENT",
          error: skipReason ?? undefined,
          subject: renderedCtx
            ? renderSubject(renderStep, renderedCtx)
            : renderStep.subject.slice(0, 200),
          sentAt: now,
        },
        select: { id: true },
      });
    } catch {
      claimedSend = null; // Already sent — fall through to advancing the cursor.
    }

    if (claimedSend && renderedCtx) {
      const subject = renderSubject(renderStep, renderedCtx);
      try {
        const { from, replyTo } = await dripFromForTick();
        // Tracking binds to the claimed send. A null signer (no configured
        // secret) renders exactly the untracked HTML — analytics never blocks mail.
        const tracking = await createTrackingSigner({
          kind: "drip",
          refId: claimedSend.id,
          contactId: contact.id,
          baseUrl: baseAppUrl,
        });
        // Hoisted so the exact bytes the recipient received are what the
        // timeline stores — a re-render could drift from what was delivered.
        const html = renderStepHtml(renderStep, {
          ...renderedCtx,
          tracking: tracking ?? undefined,
        });
        await sendMail({
          to: contact.email,
          subject,
          html,
          from,
          replyTo,
          // Nurture mail is bulk mail: Gmail/Yahoo want one-click unsubscribe.
          ...(unsubToken
            ? { headers: unsubscribeHeaders(unsubToken, replyTo, emailScope) }
            : {}),
        });
        sent += 1;
        await recordEmailEvent({
          contactId: contact.id,
          dripSendId: claimedSend.id,
          type: "SENT",
          subject,
          bodyHtml: html,
          bumpActivity: true,
        });
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${campaign.slug} step ${step.order} → ${contact.email}: ${message}`);
        await prisma.dripSend.updateMany({
          where: { enrollmentId: enrollment.id, stepId: step.id },
          data: { status: "FAILED", error: message.slice(0, 500) },
        });
        // No lastActivityAt bump: nothing reached the lead, so this is not activity.
        await recordEmailEvent({
          contactId: contact.id,
          dripSendId: claimedSend.id,
          type: "FAILED",
          subject,
          metadata: { error: message.slice(0, 500) },
          bumpActivity: false,
        });
      }
    } else if (claimedSend && step.channel === "CALL" && !skipReason) {
      // AI voice call via Vapi. Consent is re-checked at dial time no matter
      // what the segment promised — enrollment happened hours or days ago.
      const reason = callabilityReason(contact);
      if (reason) {
        await prisma.dripSend.update({
          where: { id: claimedSend.id },
          data: { status: "SKIPPED", error: reason },
        });
      } else {
        try {
          await initiateCall({
            contactId: contact.id,
            phone: contact.phone ?? "",
            contactName: contact.name,
            assistantId: step.callAssistantId,
            firstMessage: step.callFirstMessage,
            dripSendId: claimedSend.id,
          });
          calls += 1;
          // No lastActivityAt bump here — the webhook bumps it when the call
          // actually connects and finalizes.
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${campaign.slug} step ${step.order} → call ${contact.email}: ${message}`);
          await prisma.dripSend.update({
            where: { id: claimedSend.id },
            data: { status: "FAILED", error: message.slice(0, 500) },
          });
        }
      }
    } else if (claimedSend && step.channel === "SMS" && !skipReason) {
      const purpose = smsPurposeForCampaignTrigger(campaign.trigger);
      const reason = smsableReason(contact, purpose);
      if (reason) {
        await prisma.dripSend.update({
          where: { id: claimedSend.id },
          data: { status: "SKIPPED", error: reason },
        });
      } else {
        try {
          const body = messageValues
            ? renderCohortMessageSms(step.body, messageValues)
            : await renderCampaignSms(step.body, contact, {
                certificateUrl: certificateCtx?.certificateUrl,
                cohortName: cohortInfo?.cohort.title,
              });
          const result = await sendContactSms({
            contactId: contact.id,
            body,
            purpose,
            dripSendId: claimedSend.id,
          });
          if (result.ok) {
            smsSent += 1;
          } else {
            await prisma.dripSend.update({
              where: { id: claimedSend.id },
              data: { status: "SKIPPED", error: result.reason },
            });
          }
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${campaign.slug} step ${step.order} → SMS ${contact.email}: ${message}`);
          await prisma.dripSend.update({
            where: { id: claimedSend.id },
            data: { status: "FAILED", error: message.slice(0, 500) },
          });
        }
      }
    } else if (claimedSend && step.channel === "TASK" && !skipReason) {
      // A TASK step sends nothing — it drops an action item into the lead's notes
      // journal for staff to pick up. This writes a ContactNote rather than
      // appending a dated line to the Contact.notes blob (which it used to do):
      // the row carries its own timestamp and attribution, and the free-form blob
      // stays a human scratchpad instead of accreting machine-written lines.
      tasks += 1;
      await prisma.contactNote.create({
        data: {
          contactId: contact.id,
          body: sanitizePlainText(step.subject, 5000, { multiline: true }),
          authorId: null,
          authorLabel: `Drip: ${campaign.name}`,
          kind: "DRIP_TASK",
        },
      });
    }

    // Advance the cursor regardless of send outcome. A failed step is recorded as
    // FAILED and visible in the campaign UI; it is not auto-retried, because a
    // retry loop on a hard bounce means a stuck queue and a burnt sending domain.
    const nextStep = campaign.steps.find((s) => s.order === step.order + 1);
    if (nextStep) {
      // COHORT_START steps are due at an absolute instant, not N hours after
      // the previous send — clamp to `now` so a next step already in the past
      // is picked up (and stale-guarded) on the very next tick.
      const nextDue =
        isCohortCampaign && nextStep.anchor === "COHORT_START"
          ? (() => {
              const due = stepDueAt(nextStep, cohortInfo?.start ?? null, enrollment.enrolledAt);
              return due && due.getTime() > now.getTime() ? due : now;
            })()
          : scheduleStep(
              now,
              nextStep.delayHours,
              nextStep.channel === "CALL"
                ? clampWindowForCalls(window)
                : nextStep.channel === "SMS"
                  ? clampWindowForSms(window)
                  : window
            );
      await prisma.dripEnrollment.update({
        where: { id: enrollment.id },
        data: {
          lastStepOrder: step.order,
          nextRunAt: nextDue,
        },
      });
    } else {
      await prisma.dripEnrollment.update({
        where: { id: enrollment.id },
        data: {
          lastStepOrder: step.order,
          status: "COMPLETED",
          completedAt: now,
          nextRunAt: null,
        },
      });
      completed += 1;
    }
  }

  // A broadcast is a finite send, unlike a standing lead rule. Archive it only
  // after every enrollment has completed so no queued recipient is stranded.
  for (const campaignId of touchedBroadcastCampaignIds) {
    const unfinished = await prisma.dripEnrollment.count({
      where: { campaignId, status: { not: "COMPLETED" } },
    });
    if (unfinished === 0) {
      await prisma.dripCampaign.update({
        where: { id: campaignId },
        data: { status: "ARCHIVED" },
      });
    }
  }

  return { sent, tasks, calls, smsSent, deferred, failed, exited, completed, errors };
}

/** One full cycle: enroll new matches, then run everything due. */
export async function tick(
  options: { now?: Date; sendLimit?: number; skipEnroll?: boolean } = {}
): Promise<TickResult> {
  const now = options.now ?? new Date();
  // Abandoned checkouts become leads before the sweep, so a cart abandoned since the last
  // tick is enrollable on this one rather than waiting a further 15 minutes.
  const abandoned = options.skipEnroll
    ? undefined
    : await syncAbandonedCheckouts({ now });
  const enrollResult = options.skipEnroll
    ? { enrolled: 0, perCampaign: {} }
    : await enrollEligibleLeads(now);
  const cohortAudiences = options.skipEnroll
    ? undefined
    : await enrollCohortAudiences(now);
  const sendResult = await runDueSteps(now, options.sendLimit ?? DEFAULT_SEND_LIMIT);
  return {
    ranAt: now.toISOString(),
    ...enrollResult,
    ...sendResult,
    abandoned,
    cohortAudiences,
  };
}

// ─── Admin helpers ───────────────────────────────────────────────────

/** How many recipients a segment currently matches — the audience preview. */
export async function countSegmentMatches(
  segment: DripSegment,
  now: Date = new Date()
): Promise<number> {
  if (segment.cohorts || segment.products || segment.includeUsers) {
    const audience = await resolveBroadcastAudience(segment, { now });
    return audience.contactIds.length;
  }

  const pageSize = 1_000;
  let cursor: string | undefined;
  let count = 0;

  // A preview is a decision-making count, so silently clipping a broad lead
  // segment is worse than walking every candidate page and reporting the truth.
  while (true) {
    const candidates = await prisma.contact.findMany({
      where: candidateWhere(segment, now),
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        source: true,
        tags: true,
        createdAt: true,
        lastActivityAt: true,
        unsubscribedAt: true,
        phone: true,
        phoneConsentAt: true,
        smsMarketingConsentAt: true,
        smsTransactionalConsentAt: true,
        doNotCall: true,
        smsOptOutAt: true,
      },
    });
    count += candidates.filter((candidate) => matchesSegment(candidate, segment, now)).length;

    if (candidates.length < pageSize) break;
    cursor = candidates[candidates.length - 1]?.id;
    if (!cursor) break;
  }

  return count;
}

export async function stopEnrollment(enrollmentId: string, reason = "manual") {
  await exitEnrollment(enrollmentId, reason, new Date());
}

/**
 * Send one step to a staff inbox so it can be eyeballed before the campaign
 * goes near a real lead.
 *
 * Deliberately outside the enrollment machinery: no DripSend row is written, no
 * enrollment cursor moves, the send window is ignored, and the campaign's status
 * is irrelevant. That means a test send can never be mistaken for a real one in
 * the ledger, and can never advance somebody's sequence.
 *
 * The merge context is faked from the test address, and the unsubscribe link
 * points at a placeholder — a test send must not mint a real unsubscribe token,
 * because clicking it would suppress whoever's address that is.
 */
export async function sendTestStep(stepId: string): Promise<{ to: string; subject: string }> {
  const step = await prisma.dripStep.findUnique({
    where: { id: stepId },
    select: {
      subject: true,
      body: true,
      ctaLabel: true,
      ctaUrl: true,
      channel: true,
      order: true,
      campaign: { select: { name: true, slug: true, testEmail: true } },
    },
  });
  if (!step) throw new Error("Step not found");
  if (step.channel === "TASK") {
    throw new Error("TASK steps send no mail — there is nothing to test");
  }
  if (step.channel === "CALL") {
    throw new Error(
      "CALL steps can't be test-emailed — use the “Call with AI” button on your own lead profile to hear the assistant"
    );
  }
  if (step.channel === "SMS") {
    throw new Error(
      "SMS steps can't be test-emailed — use the “SMS” box on your own lead profile to send yourself a real text"
    );
  }

  const to = step.campaign.testEmail;
  if (!to) throw new Error("Set a test email on the campaign first");

  const baseAppUrl = appUrl();
  const upcomingCohorts = await upcomingCohortsOrFallback(baseAppUrl);
  const ctx = {
    name: "Test Recipient",
    email: to,
    unsubscribeUrl: `${baseAppUrl}/unsubscribe?token=test-send-not-a-real-token`,
    appUrl: baseAppUrl,
    campaignSlug: step.campaign.slug,
    upcomingCohortsHtml: renderUpcomingCohortsHtml(upcomingCohorts, baseAppUrl, {
      campaign: step.campaign.slug,
      stepOrder: step.order,
    }),
    nextCohortLine: renderNextCohortLine(upcomingCohorts),
  };

  // Prefixed so a test landing in a shared inbox is never mistaken for live mail.
  const subject = `[TEST] ${renderSubject(step, ctx)}`.slice(0, 200);
  const { from, replyTo } = await resolveDripFrom();
  await sendMail({
    to,
    subject,
    html: renderStepHtml(step, ctx),
    from,
    replyTo,
  });
  return { to, subject };
}
export function campaignSkipsStatusExits(trigger: string): boolean {
  return (
    trigger === COHORT_TRIGGER ||
    trigger === COHORT_MESSAGE_TRIGGER ||
    trigger === CERTIFICATE_TRIGGER
  );
}

/**
 * Course logistics ignore the campaign's daytime window for EMAIL. SMS and CALL
 * steps are still clamped (clampWindowForSms / clampWindowForCalls) on top of
 * this window, so a night-time send defers texts to the morning.
 */
export function campaignUsesAllDaySendWindow(trigger: string): boolean {
  return (
    trigger === COHORT_TRIGGER ||
    trigger === COHORT_MESSAGE_TRIGGER ||
    trigger === CERTIFICATE_TRIGGER
  );
}

export function appliesCohortStartGuard(trigger: string, anchor: string | null): boolean {
  return trigger === COHORT_TRIGGER && anchor === "COHORT_START";
}

export { smsableReason };
