import twilio from "twilio";

import { normalizePhoneE164 } from "@/lib/phone";

export const ROUTE_STEPS = ["owner", "closers", "vapi", "forward"] as const;
export type RouteStep = (typeof ROUTE_STEPS)[number];
export type RingStrategy = "simulring" | "round-robin";

export type CloserLeg = {
  kind: "closer";
  userIds: string[];
  owner: boolean;
};

export type NumberLeg = {
  kind: "number";
  target: string;
  purpose: "vapi" | "forward";
};

export type Leg = CloserLeg | NumberLeg;

export type BuildLegsInput = {
  chain: readonly RouteStep[];
  strategy: RingStrategy;
  forwardNumber: string | null;
  vapiNumber: string | null;
  ownerCandidate: {
    userId: string;
    available: boolean;
    isStaff: boolean;
  } | null;
  availableClosers: readonly {
    id: string;
    lastAnsweredAt: Date | null;
  }[];
};

export type RoutingNumbersInput = {
  twilioNumber?: unknown;
  forwardNumber?: unknown;
  vapiNumber?: unknown;
};

export type RoutingNumbersResult = {
  forwardNumber: string | null;
  vapiNumber: string | null;
  errors: string[];
};

export type NextLegResult =
  | { action: "finalize" }
  | { action: "dial"; index: number; leg: Leg }
  | { action: "voicemail" };

export type TwimlForLegInput = {
  contactCallId: string;
  contactId: string;
  leadName: string;
  legs: string;
  index: number;
  appUrl: string;
};

const DEFAULT_CHAIN: readonly RouteStep[] = ROUTE_STEPS;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PACKED_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_LEGS = 8;
const MAX_SIMULRING_CLIENTS = 10;
const MAX_ROUND_ROBIN_LEGS = 4;

type PackedCloserLeg = ["c", 0 | 1, string[]];
type PackedNumberLeg = ["n", "v" | "f", string];
type PackedLeg = PackedCloserLeg | PackedNumberLeg;
type PackedPayload = [1, PackedLeg[]];

function isRouteStep(value: unknown): value is RouteStep {
  return typeof value === "string" && (ROUTE_STEPS as readonly string[]).includes(value);
}

export function parseRouteChain(raw: string | undefined): RouteStep[] {
  if (typeof raw !== "string") return [...DEFAULT_CHAIN];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Invalid configuration has a defined safe default.
    return [...DEFAULT_CHAIN];
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isRouteStep)) {
    return [...DEFAULT_CHAIN];
  }
  return parsed;
}

export function parseRingStrategy(raw: string | undefined): RingStrategy {
  return raw === "round-robin" ? "round-robin" : "simulring";
}

function compareClosers(
  left: BuildLegsInput["availableClosers"][number],
  right: BuildLegsInput["availableClosers"][number]
): number {
  if (left.lastAnsweredAt === null && right.lastAnsweredAt !== null) return -1;
  if (left.lastAnsweredAt !== null && right.lastAnsweredAt === null) return 1;
  if (left.lastAnsweredAt !== null && right.lastAnsweredAt !== null) {
    const timeDifference = left.lastAnsweredAt.getTime() - right.lastAnsweredAt.getTime();
    if (timeDifference !== 0) return timeDifference;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function closerLegs(input: BuildLegsInput, ownerId: string | null): CloserLeg[] {
  const seen = new Set<string>();
  const closers = input.availableClosers.filter((closer) => {
    if (closer.id === ownerId || !USER_ID_PATTERN.test(closer.id) || seen.has(closer.id)) {
      return false;
    }
    seen.add(closer.id);
    return true;
  });

  if (input.strategy === "simulring") {
    const userIds = closers.slice(0, MAX_SIMULRING_CLIENTS).map((closer) => closer.id);
    return userIds.length > 0 ? [{ kind: "closer", userIds, owner: false }] : [];
  }

  return [...closers]
    .sort(compareClosers)
    .slice(0, MAX_ROUND_ROBIN_LEGS)
    .map((closer) => ({ kind: "closer", userIds: [closer.id], owner: false }));
}

export function buildLegs(input: BuildLegsInput): Leg[] {
  const ownerId =
    input.ownerCandidate?.available === true &&
    input.ownerCandidate.isStaff === true &&
    USER_ID_PATTERN.test(input.ownerCandidate.userId)
      ? input.ownerCandidate.userId
      : null;
  const result: Leg[] = [];

  for (const step of input.chain) {
    if (step === "owner") {
      if (ownerId) result.push({ kind: "closer", userIds: [ownerId], owner: true });
    } else if (step === "closers") {
      result.push(...closerLegs(input, ownerId));
    } else if (step === "vapi") {
      if (input.vapiNumber) {
        result.push({ kind: "number", target: input.vapiNumber, purpose: "vapi" });
      }
    } else {
      // RouteStep is exhaustive, so the remaining step is "forward".
      if (input.forwardNumber) {
        result.push({ kind: "number", target: input.forwardNumber, purpose: "forward" });
      }
    }

    if (result.length >= MAX_LEGS) return result.slice(0, MAX_LEGS);
  }

  return result;
}

function validatedRoutingNumber(
  raw: unknown,
  label: "INBOUND_FORWARD_NUMBER" | "VAPI_INBOUND_NUMBER",
  twilioNumber: string | null,
  errors: string[]
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const normalized = normalizePhoneE164(raw);
  if (!normalized) {
    errors.push(`${label} is not a valid phone number`);
    return null;
  }
  if (twilioNumber && normalized === twilioNumber) {
    errors.push(`${label} must not match TWILIO_PHONE_NUMBER`);
    return null;
  }
  return normalized;
}

export function validateRoutingNumbers(input: RoutingNumbersInput): RoutingNumbersResult {
  const errors: string[] = [];
  const twilioNumber = normalizePhoneE164(input.twilioNumber);
  return {
    forwardNumber: validatedRoutingNumber(
      input.forwardNumber,
      "INBOUND_FORWARD_NUMBER",
      twilioNumber,
      errors
    ),
    vapiNumber: validatedRoutingNumber(
      input.vapiNumber,
      "VAPI_INBOUND_NUMBER",
      twilioNumber,
      errors
    ),
    errors,
  };
}

function packLeg(leg: Leg): PackedLeg {
  return leg.kind === "closer"
    ? ["c", leg.owner ? 1 : 0, leg.userIds]
    : ["n", leg.purpose === "vapi" ? "v" : "f", leg.target];
}

export function packLegs(legs: readonly Leg[]): string {
  const payload: PackedPayload = [1, legs.map(packLeg)];
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function unpackLeg(value: unknown): Leg | null {
  if (!Array.isArray(value) || value.length !== 3) return null;

  if (value[0] === "c") {
    const owner = value[1];
    const userIds = value[2];
    if (
      (owner !== 0 && owner !== 1) ||
      !Array.isArray(userIds) ||
      userIds.length === 0 ||
      userIds.length > MAX_SIMULRING_CLIENTS ||
      !userIds.every((userId): userId is string =>
        typeof userId === "string" && USER_ID_PATTERN.test(userId)
      )
    ) {
      return null;
    }
    return { kind: "closer", userIds, owner: owner === 1 };
  }

  if (value[0] === "n") {
    const purpose = value[1];
    const target = value[2];
    if (
      (purpose !== "v" && purpose !== "f") ||
      typeof target !== "string" ||
      normalizePhoneE164(target) !== target
    ) {
      return null;
    }
    return { kind: "number", target, purpose: purpose === "v" ? "vapi" : "forward" };
  }

  return null;
}

export function unpackLegs(packed: string | null | undefined): Leg[] | null {
  if (typeof packed !== "string" || !PACKED_PATTERN.test(packed)) return null;

  let parsed: unknown;
  try {
    const bytes = Buffer.from(packed, "base64url");
    if (bytes.toString("base64url") !== packed) return null;
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    // Invalid packed input is expected at this trust boundary and maps to null.
    return null;
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    parsed[0] !== 1 ||
    !Array.isArray(parsed[1]) ||
    parsed[1].length > MAX_LEGS
  ) {
    return null;
  }

  const legs: Leg[] = [];
  for (const value of parsed[1]) {
    const leg = unpackLeg(value);
    if (!leg) return null;
    legs.push(leg);
  }
  return legs;
}

export function nextLeg(legs: readonly Leg[], currentIndex: number, dialStatus: string): NextLegResult {
  if (dialStatus === "completed") return { action: "finalize" };
  if (!Number.isInteger(currentIndex) || currentIndex < -1) return { action: "voicemail" };

  const index = currentIndex + 1;
  const leg = legs[index];
  return leg ? { action: "dial", index, leg } : { action: "voicemail" };
}

export function twimlForLeg(
  leg: Leg,
  input: TwimlForLegInput
): twilio.twiml.VoiceResponse {
  const baseUrl = input.appUrl.replace(/\/+$/, "");
  const action =
    `${baseUrl}/api/webhooks/twilio/voice/inbound/after` +
    `?contactCallId=${encodeURIComponent(input.contactCallId)}` +
    `&legs=${encodeURIComponent(input.legs)}` +
    `&i=${encodeURIComponent(String(input.index))}`;
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    record: "record-from-answer-dual",
    recordingStatusCallback: `${baseUrl}/api/webhooks/twilio/voice/recording`,
    recordingStatusCallbackEvent: ["completed"],
    timeout: leg.kind === "closer" && leg.userIds.length > 1 ? 20 : 15,
    action,
    method: "POST",
  });

  if (leg.kind === "number") {
    dial.number(leg.target);
    return response;
  }

  for (const userId of leg.userIds) {
    const client = dial.client();
    client.identity(`closer-${userId}`);
    client.parameter({ name: "contactId", value: input.contactId });
    client.parameter({ name: "leadName", value: input.leadName });
  }
  return response;
}
