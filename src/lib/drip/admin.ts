import prisma from "@/lib/prisma";
import { sanitizePlainText } from "@/lib/onboarding-security";
import { sanitizeEmailBody } from "@/lib/sanitize";
import { isValidIanaTimezone } from "@/lib/timezone";
import { slugify } from "@/lib/slug";
import { CAMPAIGN_TRIGGERS, STEP_CHANNELS } from "@/lib/drip/constants";
import { serializeSegment, type DripSegment } from "@/lib/drip/segment";
import { isSupportedCtaUrlMergeField } from "@/lib/drip/template";
import { LEAD_STATUSES } from "@/app/(dashboard)/admin/contacts/leadStatus";

const CTA_URL_MERGE_FIELD_PREFIX = /^\{\{\s*([a-z_]+)\s*\}\}/i;
const CTA_URL_UNSAFE_CHARACTERS = /[\s"'<>]/;
const LEADING_URL_OBFUSCATION = /^[\u0000-\u0020\u007f]+/;
const CTA_WARNING_VALUE_MAX_LENGTH = 80;

export const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

function hasRejectedUrlScheme(value: string): boolean {
  const normalized = value.replace(LEADING_URL_OBFUSCATION, "").toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("data:");
}

function sanitizeMergeFieldUrl(value: string): string | null {
  const match = CTA_URL_MERGE_FIELD_PREFIX.exec(value);
  if (!match) return null;
  if (!isSupportedCtaUrlMergeField(match[1])) return null;

  const suffix = value.slice(match[0].length);
  if (CTA_URL_UNSAFE_CHARACTERS.test(suffix)) return null;
  if (!suffix) return value.slice(0, 500);
  if (!suffix.startsWith("/") && !suffix.startsWith("?") && !suffix.startsWith("#")) return null;
  return value.slice(0, 500);
}

export function sanitizeUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (hasRejectedUrlScheme(input)) return null;
  if (value.startsWith("/")) return value.slice(0, 500);
  const mergeFieldUrl = sanitizeMergeFieldUrl(value);
  if (mergeFieldUrl) return mergeFieldUrl;
  try {
    const url = new URL(value);
    const allowed =
      url.protocol === "https:" ||
      url.protocol === "mailto:" ||
      (url.protocol === "http:" && process.env.NODE_ENV !== "production");
    return allowed ? url.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

export type DripStepInput = {
  delayHours: unknown;
  channel: unknown;
  subject: unknown;
  body: unknown;
  ctaLabel?: unknown;
  ctaUrl?: unknown;
  /** ENROLLMENT (default) | COHORT_START — cohort-anchored scheduling. */
  anchor?: unknown;
  /** Minutes relative to cohort start (negative = before). COHORT_START only. */
  offsetMinutes?: unknown;
  callAssistantId?: unknown;
  callFirstMessage?: unknown;
};

export const MAX_DRIP_STEPS = 50;

export type NormalizedDripStep = {
  delayHours: number;
  channel: string;
  subject: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  anchor: string;
  offsetMinutes: number;
  callAssistantId: string | null;
  callFirstMessage: string | null;
};

export type NormalizeDripStepResult = {
  step: NormalizedDripStep;
  warnings: string[];
};

export type NormalizedDripStepWithOrder = NormalizedDripStep & { order: number };

export type NormalizeDripStepSequenceResult = {
  steps: NormalizedDripStepWithOrder[];
  warnings: string[];
};

function formatCtaWarningValue(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return JSON.stringify("");
  const truncated =
    compact.length > CTA_WARNING_VALUE_MAX_LENGTH
      ? `${compact.slice(0, CTA_WARNING_VALUE_MAX_LENGTH - 3)}...`
      : compact;
  return JSON.stringify(truncated);
}

function buildCtaWarning(field: "ctaLabel" | "ctaUrl", value: string, reason?: string): string {
  return `${field} ${formatCtaWarningValue(value)} was rejected${
    reason ? ` because ${reason}` : ""
  } — CTA dropped`;
}

export function normalizeDripStep(input: DripStepInput): NormalizeDripStepResult {
  const channel =
    typeof input.channel === "string" && (STEP_CHANNELS as readonly string[]).includes(input.channel)
      ? input.channel
      : "EMAIL";
  const rawCtaUrl = typeof input.ctaUrl === "string" ? input.ctaUrl : "";
  const rawCtaLabel = typeof input.ctaLabel === "string" ? input.ctaLabel : "";
  const ctaUrl = sanitizeUrl(rawCtaUrl);
  const ctaLabel = sanitizePlainText(input.ctaLabel, 60) || null;
  const hadCtaUrlInput = rawCtaUrl.trim().length > 0;
  const hadCtaLabelInput = rawCtaLabel.trim().length > 0;
  const ctaUrlRejected = hadCtaUrlInput && !ctaUrl;
  const ctaLabelRejected = hadCtaLabelInput && !ctaLabel;
  const warnings: string[] = [];
  const supportsCta = channel !== "SMS";

  if (supportsCta && ctaUrlRejected) {
    warnings.push(buildCtaWarning("ctaUrl", rawCtaUrl));
  }
  if (supportsCta && ctaLabelRejected) {
    warnings.push(buildCtaWarning("ctaLabel", rawCtaLabel));
  }
  if (supportsCta && ctaUrl && !ctaLabel) {
    warnings.push(
      buildCtaWarning("ctaLabel", rawCtaLabel, "CTA buttons need both label and URL")
    );
  }
  if (supportsCta && ctaLabel && !ctaUrl && !ctaUrlRejected) {
    warnings.push(
      buildCtaWarning("ctaUrl", rawCtaUrl, "CTA buttons need both label and URL")
    );
  }

  const anchor = input.anchor === "COHORT_START" ? "COHORT_START" : "ENROLLMENT";
  // Offsets are "before start" by contract: clamp to ≤ 0 (max one year back).
  const offsetMinutes =
    anchor === "COHORT_START" ? clampInt(input.offsetMinutes, -525_600, 0, 0) : 0;

  return {
    step: {
      delayHours: clampInt(input.delayHours, 0, 24 * 365, 48),
      anchor,
      offsetMinutes,
      channel,
      subject: sanitizePlainText(input.subject, 200) || "(no subject)",
      body:
        channel === "SMS"
          ? sanitizePlainText(input.body, 640, { multiline: true })
          : sanitizeEmailBody(typeof input.body === "string" ? input.body : ""),
      // A button needs both halves; keeping one without the other renders nothing.
      ctaLabel: supportsCta && ctaUrl ? ctaLabel : null,
      ctaUrl: supportsCta && ctaLabel ? ctaUrl : null,
      // Voice-call overrides only mean anything on a CALL step.
      callAssistantId:
        channel === "CALL" ? sanitizePlainText(input.callAssistantId, 100) || null : null,
      callFirstMessage:
        channel === "CALL" ? sanitizePlainText(input.callFirstMessage, 500) || null : null,
    },
    warnings,
  };
}

export function normalizeDripStepSequence(
  steps: readonly DripStepInput[]
): NormalizeDripStepSequenceResult {
  if (steps.length > MAX_DRIP_STEPS) {
    throw new Error(`A campaign can have at most ${MAX_DRIP_STEPS} steps`);
  }

  const normalized = steps.map((step, index) => {
    const result = normalizeDripStep(step);
    const order = index + 1;
    return {
      order,
      step: { ...result.step, order },
      warnings: result.warnings.map((warning) => `step ${order}: ${warning}`),
    };
  });

  return {
    steps: normalized.map((result) => result.step),
    warnings: normalized.flatMap((result) => result.warnings),
  };
}

export type DripSettingsInput = {
  name?: unknown;
  description?: unknown;
  /** LEAD_SEGMENT (default) | COHORT_SCHEDULE. Omit to leave unchanged. */
  trigger?: unknown;
  autoEnroll?: unknown;
  priority?: unknown;
  timezone?: unknown;
  sendWindowStartHour?: unknown;
  sendWindowEndHour?: unknown;
  skipWeekends?: unknown;
  exitOnStatuses?: unknown;
  testEmail?: unknown;
};

/**
 * Staff inbox for step test sends. Deliberately permissive on shape (one @, no
 * spaces) — this address is only ever used for a manual test send, never for a
 * lead-facing one, so a typo costs a bounce and nothing else.
 */
export function normalizeTestEmail(input: unknown): string | null {
  const value = sanitizePlainText(input, 200).trim();
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("Test email must be a valid email address");
  }
  return value.toLowerCase();
}

export function normalizeDripSettings(input: DripSettingsInput): {
  name: string;
  description: string | null;
  trigger: string | undefined;
  autoEnroll: boolean;
  priority: number;
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  skipWeekends: boolean;
  exitOnStatuses: string[];
  testEmail: string | null;
} {
  const start = clampInt(input.sendWindowStartHour, 0, 23, 8);
  const end = clampInt(input.sendWindowEndHour, 1, 24, 18);
  if (end <= start) throw new Error("Send window end must be after start");

  return {
    name: sanitizePlainText(input.name, 120) || "Untitled campaign",
    description: sanitizePlainText(input.description, 1000, { multiline: true }) || null,
    // Undefined leaves the stored trigger untouched; anything else must be valid.
    // The allowlist is CAMPAIGN_TRIGGERS so adding a trigger never means
    // remembering to widen a second hand-written literal here.
    trigger:
      input.trigger === undefined
        ? undefined
        : typeof input.trigger === "string" &&
            (CAMPAIGN_TRIGGERS as readonly string[]).includes(input.trigger)
          ? input.trigger
          : (() => {
              throw new Error(`trigger must be one of ${CAMPAIGN_TRIGGERS.join(", ")}`);
            })(),
    autoEnroll: Boolean(input.autoEnroll),
    priority: clampInt(input.priority, 1, 999, 100),
    timezone:
      typeof input.timezone === "string" && isValidIanaTimezone(input.timezone)
        ? input.timezone
        : "America/Los_Angeles",
    sendWindowStartHour: start,
    sendWindowEndHour: end,
    skipWeekends: Boolean(input.skipWeekends),
    exitOnStatuses: Array.isArray(input.exitOnStatuses)
      ? input.exitOnStatuses.filter(
          (status): status is string =>
            typeof status === "string" && (LEAD_STATUSES as readonly string[]).includes(status)
        )
      : [],
    testEmail: normalizeTestEmail(input.testEmail),
  };
}

// Reordering live steps breaks the runner's `lastStepOrder + 1` walk and can skip or resend messages,
// so bulk replacement is only safe while the campaign is still a draft.
export function stepReplacementRefusalReason(status: string): string | null {
  return status === "DRAFT"
    ? null
    : `Steps can only be replaced while the campaign is DRAFT (this campaign is ${status})`;
}

async function uniqueCampaignSlug(name: string): Promise<string> {
  const base = slugify(name) || "campaign";
  let slug = base;
  for (let i = 2; await prisma.dripCampaign.findUnique({ where: { slug } }); i += 1) {
    slug = `${base}-${i}`;
  }
  return slug;
}

export async function createDripCampaign(input: {
  name: unknown;
}): Promise<{ id: string; slug: string; name: string; slugWasAdjusted: boolean }> {
  const clean = sanitizePlainText(input.name, 120) || "Untitled campaign";
  const base = slugify(clean) || "campaign";
  const slug = await uniqueCampaignSlug(clean);
  const campaign = await prisma.dripCampaign.create({
    data: { slug, name: clean, status: "DRAFT", segment: "{}", autoEnroll: false },
    select: { id: true, slug: true, name: true },
  });
  return {
    ...campaign,
    slugWasAdjusted: slug !== base,
  };
}

export async function duplicateCampaign(
  campaignId: string
): Promise<{ id: string; slug: string; name: string }> {
  const source = await prisma.dripCampaign.findUnique({
    where: { id: campaignId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!source) {
    throw new Error(`Cannot duplicate campaign ${campaignId}: campaign not found`);
  }

  const name = `Copy of ${source.name}`;
  const slug = await uniqueCampaignSlug(name);

  // Copy only the campaign definition so enrollments and delivery history cannot leak into the draft.
  return prisma.dripCampaign.create({
    data: {
      slug,
      name,
      description: source.description,
      status: "DRAFT",
      trigger: source.trigger,
      segment: source.segment,
      autoEnroll: source.autoEnroll,
      exitOnStatuses: source.exitOnStatuses,
      priority: source.priority,
      timezone: source.timezone,
      sendWindowStartHour: source.sendWindowStartHour,
      sendWindowEndHour: source.sendWindowEndHour,
      skipWeekends: source.skipWeekends,
      testEmail: source.testEmail,
      sentAt: null,
      audienceSnapshot: null,
      steps: {
        create: source.steps.map((step) => ({
          order: step.order,
          delayHours: step.delayHours,
          anchor: step.anchor,
          offsetMinutes: step.offsetMinutes,
          channel: step.channel,
          subject: step.subject,
          body: step.body,
          ctaLabel: step.ctaLabel,
          ctaUrl: step.ctaUrl,
          callAssistantId: step.callAssistantId,
          callFirstMessage: step.callFirstMessage,
        })),
      },
    },
    select: { id: true, slug: true, name: true },
  });
}

export async function updateDripCampaignSettings(
  campaignId: string,
  input: DripSettingsInput
): Promise<void> {
  const normalized = normalizeDripSettings(input);
  await prisma.dripCampaign.update({
    where: { id: campaignId },
    data: {
      name: normalized.name,
      description: normalized.description,
      ...(normalized.trigger ? { trigger: normalized.trigger } : {}),
      autoEnroll: normalized.autoEnroll,
      priority: normalized.priority,
      timezone: normalized.timezone,
      sendWindowStartHour: normalized.sendWindowStartHour,
      sendWindowEndHour: normalized.sendWindowEndHour,
      skipWeekends: normalized.skipWeekends,
      exitOnStatuses: JSON.stringify(normalized.exitOnStatuses),
      testEmail: normalized.testEmail,
    },
  });
}

export async function updateDripCampaignSegment(
  campaignId: string,
  segment: DripSegment
): Promise<void> {
  await prisma.dripCampaign.update({
    where: { id: campaignId },
    data: { segment: serializeSegment(segment) },
  });
}

export async function addDripStep(campaignId: string): Promise<void> {
  const last = await prisma.dripStep.findFirst({
    where: { campaignId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  await prisma.dripStep.create({
    data: {
      campaignId,
      order: (last?.order ?? 0) + 1,
      delayHours: 48,
      channel: "EMAIL",
      subject: "New step",
      body: '<p style="margin:0 0 16px">Write the email here.</p>',
    },
  });
}

export async function updateDripStep(
  stepId: string,
  input: DripStepInput
): Promise<{ campaignId: string; warnings: string[] }> {
  const step = await prisma.dripStep.findUnique({
    where: { id: stepId },
    select: { campaignId: true },
  });
  if (!step) throw new Error("Step not found");

  const normalized = normalizeDripStep(input);

  await prisma.dripStep.update({
    where: { id: stepId },
    data: normalized.step,
  });

  return { ...step, warnings: normalized.warnings };
}

export async function deleteDripStep(stepId: string): Promise<{ campaignId: string } | null> {
  const step = await prisma.dripStep.findUnique({
    where: { id: stepId },
    select: { campaignId: true, order: true },
  });
  if (!step) return null;

  // Close the gap in `order` so the runner's `lastStepOrder + 1` lookup keeps
  // finding the next step instead of silently completing the enrollment.
  await prisma.$transaction(async (tx) => {
    await tx.dripStep.delete({ where: { id: stepId } });
    const rest = await tx.dripStep.findMany({
      where: { campaignId: step.campaignId, order: { gt: step.order } },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    let next = step.order;
    for (const row of rest) {
      await tx.dripStep.update({ where: { id: row.id }, data: { order: next } });
      next += 1;
    }
  });

  return { campaignId: step.campaignId };
}

export async function replaceDripSteps(
  campaignId: string,
  steps: readonly NormalizedDripStepWithOrder[]
): Promise<number> {
  await prisma.$transaction(async (tx) => {
    await tx.dripStep.deleteMany({ where: { campaignId } });
    for (const step of steps) {
      await tx.dripStep.create({
        data: {
          campaignId,
          ...step,
        },
      });
    }
  });

  return steps.length;
}
