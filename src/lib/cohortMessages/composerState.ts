import {
  COHORT_SMS_MAX_GSM7,
  COHORT_SMS_PREFIX,
  COHORT_SMS_SUFFIX,
  normalizeSmsText,
  smsLength,
} from "./smsText";

export type ComposerFingerprintInput = {
  subject: string;
  emailBody: string;
  smsBody: string;
  includeInstructors: boolean;
  sendAt: string | null;
};

/** Exact form state captured by Preview. Fixed key order makes it deterministic. */
export function composerFingerprint(input: ComposerFingerprintInput): string {
  return JSON.stringify([
    input.subject,
    input.emailBody,
    input.smsBody,
    input.includeInstructors,
    input.sendAt,
  ]);
}

export type ComposerSmsValidation = {
  enabled: boolean;
  hasText: boolean;
  ok: boolean;
  reason: string | null;
};

export function canSubmitCohortMessage(input: {
  previewFingerprint: string | null;
  currentFingerprint: string;
  previewOk: boolean;
  logisticsConfirmed: boolean;
  pending: boolean;
  subject: string;
  emailBody: string;
  smsValidation: ComposerSmsValidation;
  scheduleValidation?: { ok: boolean; reason: string | null };
}): { enabled: boolean; reason: string | null } {
  if (input.pending) return { enabled: false, reason: "A request is already in progress" };
  if (!input.subject.trim()) return { enabled: false, reason: "Subject is required" };
  if (!input.emailBody.trim()) return { enabled: false, reason: "Email body is required" };
  if (
    input.smsValidation.enabled &&
    input.smsValidation.hasText &&
    !input.smsValidation.ok
  ) {
    return {
      enabled: false,
      reason: input.smsValidation.reason ?? "Fix the text message before sending",
    };
  }
  if (input.scheduleValidation && !input.scheduleValidation.ok) {
    return {
      enabled: false,
      reason: input.scheduleValidation.reason ?? "Choose a valid schedule time",
    };
  }
  if (!input.previewFingerprint) {
    return { enabled: false, reason: "Preview the audience before sending" };
  }
  if (input.previewFingerprint !== input.currentFingerprint) {
    return { enabled: false, reason: "Message changed since preview. Preview again" };
  }
  if (!input.previewOk) {
    return { enabled: false, reason: "Preview must succeed before sending" };
  }
  if (!input.logisticsConfirmed) {
    return {
      enabled: false,
      reason: "Confirm this is a logistics update, not a promotion",
    };
  }
  return { enabled: true, reason: null };
}

export type SmsCounterResult = {
  text: string;
  /** GSM-7 septet length of the complete branded template. */
  length: number;
  septets: number;
  max: number;
  nonGsmChars: string[];
  ok: boolean;
  reason: string | null;
};

/**
 * Counts the raw template because recipient merge values are not known in the
 * browser. The UI labels this "before merge fields"; send-time validation still
 * checks the longest resolved recipient value.
 */
export function smsCounter(smsBody: string): SmsCounterResult {
  const text = normalizeSmsText(COHORT_SMS_PREFIX + smsBody + COHORT_SMS_SUFFIX);
  const { septets, nonGsmChars } = smsLength(text);
  const reason =
    nonGsmChars.length > 0
      ? `Text contains characters outside GSM-7: ${nonGsmChars.join(" ")}`
      : septets > COHORT_SMS_MAX_GSM7
        ? `Text exceeds the ${COHORT_SMS_MAX_GSM7} GSM-7 character limit`
        : null;
  return {
    text,
    length: septets,
    septets,
    max: COHORT_SMS_MAX_GSM7,
    nonGsmChars,
    ok: reason === null,
    reason,
  };
}

export function insertAtCursor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  token: string
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(text.length, selectionStart));
  const end = Math.max(start, Math.min(text.length, selectionEnd));
  return {
    value: text.slice(0, start) + token + text.slice(end),
    cursor: start + token.length,
  };
}

export type CohortMessageHistoryCampaign = {
  id: string;
  sentAt: Date | string | null;
  createdAt: Date | string;
  audienceSnapshot: string | null;
};

export type CohortMessageHistoryUser = {
  name: string | null;
  email: string | null;
};

export type CohortMessageHistoryStats = {
  delivered: number;
  opened: number;
};

export type CohortMessageHistoryRow = {
  id: string;
  sentAt: string;
  scheduledFor?: string;
  senderName: string;
  emailCount: number;
  smsCount: number;
  total: number;
  delivered?: number;
  opened?: number;
};

type ParsedSnapshot = {
  sentByUserId: string | null;
  total: number;
  email: number;
  sms: number;
  sendAt: string | null;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseSnapshot(raw: string | null): ParsedSnapshot {
  const empty: ParsedSnapshot = {
    sentByUserId: null,
    total: 0,
    email: 0,
    sms: 0,
    sendAt: null,
  };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty;
    const snapshot = parsed as Record<string, unknown>;
    return {
      sentByUserId:
        typeof snapshot.sentByUserId === "string" ? snapshot.sentByUserId : null,
      total: count(snapshot.total),
      email: count(snapshot.email),
      sms: count(snapshot.sms),
      sendAt: validIso(snapshot.sendAt),
    };
  } catch {
    return empty;
  }
}

export function historySenderIds(
  campaigns: readonly CohortMessageHistoryCampaign[]
): string[] {
  return [
    ...new Set(
      campaigns
        .map((campaign) => parseSnapshot(campaign.audienceSnapshot).sentByUserId)
        .filter((id): id is string => id !== null)
    ),
  ];
}

function dateIso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

export function buildHistoryRows(
  campaigns: readonly CohortMessageHistoryCampaign[],
  usersById: ReadonlyMap<string, CohortMessageHistoryUser>,
  statsByCampaign: ReadonlyMap<string, CohortMessageHistoryStats>
): CohortMessageHistoryRow[] {
  return campaigns.map((campaign) => {
    const snapshot = parseSnapshot(campaign.audienceSnapshot);
    const user = snapshot.sentByUserId
      ? usersById.get(snapshot.sentByUserId)
      : undefined;
    const senderName = user?.name?.trim() || user?.email?.trim() || "Unknown sender";
    const stats = statsByCampaign.get(campaign.id);
    return {
      id: campaign.id,
      sentAt: dateIso(campaign.sentAt ?? campaign.createdAt),
      ...(snapshot.sendAt ? { scheduledFor: snapshot.sendAt } : {}),
      senderName,
      emailCount: snapshot.email,
      smsCount: snapshot.sms,
      total: snapshot.total,
      ...(stats
        ? { delivered: count(stats.delivered), opened: count(stats.opened) }
        : {}),
    };
  });
}

const TIMEZONE_ALIASES: Readonly<Record<string, string>> = {
  PT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MT: "America/Denver",
  MST: "America/Denver",
  MDT: "America/Denver",
  CT: "America/Chicago",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  UTC: "UTC",
  GMT: "UTC",
};

function ianaZone(zone: string): string | null {
  const candidate = TIMEZONE_ALIASES[zone.trim().toUpperCase()] ?? zone.trim();
  if (!candidate) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return null;
  }
}

function wallParts(instant: Date, zone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return [get("year"), get("month"), get("day"), get("hour") % 24, get("minute")];
}

function zoneOffsetMs(instant: Date, zone: string): number {
  const [year, month, day, hour, minute] = wallParts(instant, zone);
  return Date.UTC(year, month - 1, day, hour, minute) - instant.getTime();
}

export type WallTimeResult =
  | { ok: true; iso: string }
  | { ok: false; reason: string };

/** Convert a datetime-local wall reading in the cohort zone to an ISO instant. */
export function wallTimeToIso(value: string, timezone: string): WallTimeResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const zone = ianaZone(timezone);
  if (!match || !zone) return { ok: false, reason: "Choose a valid date and time" };

  const requested = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = requested;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return { ok: false, reason: "Choose a valid date and time" };
  }

  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMs(new Date(naive), zone);
  let instant = new Date(naive - firstOffset);
  const secondOffset = zoneOffsetMs(instant, zone);
  if (secondOffset !== firstOffset) instant = new Date(naive - secondOffset);

  const actual = wallParts(instant, zone);
  if (actual.some((part, index) => part !== requested[index])) {
    return {
      ok: false,
      reason: "That local time does not exist in the cohort timezone",
    };
  }
  return { ok: true, iso: instant.toISOString() };
}

/**
 * Confirmation prompt for Send/Schedule. Counts who actually receives each channel —
 * the audience total includes people every channel will skip (opted out, no consent).
 */
export function sendConfirmMessage(input: {
  total: number;
  email: number;
  sms: number;
  smsOn: boolean;
  schedule?: { when: string; timezone: string };
}): string {
  const channels = input.smsOn
    ? `email to ${input.email} and text to ${input.sms}`
    : `email to ${input.email}`;
  const people = `of ${input.total} ${input.total === 1 ? "person" : "people"}`;
  if (input.schedule) {
    return `Schedule ${channels} ${people} for ${input.schedule.when} ${input.schedule.timezone}?`;
  }
  return `Send ${channels} ${people} now?${input.smsOn ? "" : " Text messages are off."}`;
}
