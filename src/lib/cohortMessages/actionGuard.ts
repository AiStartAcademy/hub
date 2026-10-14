import { hasAnyRole } from "@/lib/roles";

export type CohortMessageActionUser = {
  role?: string | null;
  roles?: string | string[] | null;
} | null | undefined;

export type PreviewCohortMessageActionInput = {
  cohortId: string;
  includeInstructors: boolean;
};

export type SendCohortMessageActionInput = {
  cohortId: string;
  subject: string;
  emailBody: string;
  smsBody?: string | null;
  sendAt: Date | null;
  includeInstructors: boolean;
  logisticsConfirmed: boolean;
  idempotencyKey: string;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const COHORT_MESSAGE_ROLES = ["ADMIN", "TEAM_MEMBER"] as const;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

export function canSendCohortMessages(user: CohortMessageActionUser): boolean {
  return hasAnyRole(user, COHORT_MESSAGE_ROLES);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredTrimmedString(
  input: Record<string, unknown>,
  key: string,
  reason: string
): ParseResult<string> {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) return { ok: false, reason };
  return { ok: true, value: value.trim() };
}

export function parsePreviewCohortMessageInput(
  raw: unknown
): ParseResult<PreviewCohortMessageActionInput> {
  if (!isRecord(raw)) return { ok: false, reason: "Invalid preview input" };

  const cohortId = requiredTrimmedString(raw, "cohortId", "cohortId is required");
  if (!cohortId.ok) return cohortId;
  if (typeof raw.includeInstructors !== "boolean") {
    return { ok: false, reason: "includeInstructors must be a boolean" };
  }

  return {
    ok: true,
    value: { cohortId: cohortId.value, includeInstructors: raw.includeInstructors },
  };
}

export function parseSendCohortMessageInput(
  raw: unknown
): ParseResult<SendCohortMessageActionInput> {
  if (!isRecord(raw)) return { ok: false, reason: "Invalid cohort message input" };

  const cohortId = requiredTrimmedString(raw, "cohortId", "cohortId is required");
  if (!cohortId.ok) return cohortId;
  const subject = requiredTrimmedString(raw, "subject", "Subject is required");
  if (!subject.ok) return subject;
  if (typeof raw.emailBody !== "string" || !raw.emailBody.trim()) {
    return { ok: false, reason: "Email body is required" };
  }

  const smsBody = raw.smsBody;
  if (smsBody !== undefined && smsBody !== null && typeof smsBody !== "string") {
    return { ok: false, reason: "smsBody must be a string or null" };
  }

  let sendAt: Date | null = null;
  if (raw.sendAt !== undefined && raw.sendAt !== null) {
    if (typeof raw.sendAt !== "string") {
      return { ok: false, reason: "sendAt must be an ISO date string or null" };
    }
    sendAt = new Date(raw.sendAt);
    if (Number.isNaN(sendAt.getTime())) {
      return { ok: false, reason: "sendAt is not a valid date" };
    }
  }

  if (typeof raw.includeInstructors !== "boolean") {
    return { ok: false, reason: "includeInstructors must be a boolean" };
  }
  if (typeof raw.logisticsConfirmed !== "boolean") {
    return { ok: false, reason: "logisticsConfirmed must be a boolean" };
  }

  const idempotencyKey = requiredTrimmedString(
    raw,
    "idempotencyKey",
    "Missing idempotency key"
  );
  if (!idempotencyKey.ok) return idempotencyKey;
  if (idempotencyKey.value.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return { ok: false, reason: "Idempotency key must be 200 characters or fewer" };
  }

  return {
    ok: true,
    value: {
      cohortId: cohortId.value,
      subject: subject.value,
      emailBody: raw.emailBody,
      smsBody,
      sendAt,
      includeInstructors: raw.includeInstructors,
      logisticsConfirmed: raw.logisticsConfirmed,
      idempotencyKey: idempotencyKey.value,
    },
  };
}
