import {
  parseRingStrategy,
  parseRouteChain,
  ROUTE_STEPS,
  validateRoutingNumbers,
} from "@/lib/calls/inboundRouting";
import { normalizePhoneE164 } from "@/lib/phone";

export type ValidateIntegrationValueInput = {
  key: string;
  value: string;
  twilioNumber?: string | null;
};

function validateRouteChain(value: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "INBOUND_ROUTE_CHAIN must be a JSON array of routing steps";
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "INBOUND_ROUTE_CHAIN must contain at least one routing step";
  }
  if (
    !parsed.every(
      (step): step is (typeof ROUTE_STEPS)[number] =>
        typeof step === "string" && (ROUTE_STEPS as readonly string[]).includes(step),
    )
  ) {
    return `INBOUND_ROUTE_CHAIN steps must be one of: ${ROUTE_STEPS.join(", ")}`;
  }
  if (new Set(parsed).size !== parsed.length) {
    return "INBOUND_ROUTE_CHAIN must not contain duplicate routing steps";
  }

  // Use the runtime parser as the canonical conversion after strict save-time checks.
  parseRouteChain(value);
  return null;
}

function validateRingStrategy(value: string): string | null {
  const strategy = parseRingStrategy(value);
  return value === strategy && (value === "simulring" || value === "round-robin")
    ? null
    : "CLOSER_RING_STRATEGY must be simulring or round-robin";
}

function validateInboundDestination(
  key: "INBOUND_FORWARD_NUMBER" | "VAPI_INBOUND_NUMBER",
  value: string,
  twilioNumber: string | null | undefined,
): string | null {
  const normalizedValue = normalizePhoneE164(value);
  const normalizedTwilioNumber = normalizePhoneE164(twilioNumber);
  const result = validateRoutingNumbers({
    twilioNumber: normalizedTwilioNumber,
    forwardNumber: key === "INBOUND_FORWARD_NUMBER" ? normalizedValue : undefined,
    vapiNumber: key === "VAPI_INBOUND_NUMBER" ? normalizedValue : undefined,
  });

  if (!normalizedValue || result.errors.some((error) => error.includes("not a valid phone number"))) {
    return `${key} must be a valid phone number`;
  }
  if (normalizedTwilioNumber && normalizedValue === normalizedTwilioNumber) {
    return `${key} must not match TWILIO_PHONE_NUMBER because that would create a call loop`;
  }
  return null;
}

export function validateIntegrationValue(input: ValidateIntegrationValueInput): string | null {
  if (input.key === "INBOUND_ROUTE_CHAIN") return validateRouteChain(input.value);
  if (input.key === "CLOSER_RING_STRATEGY") return validateRingStrategy(input.value);
  if (input.key === "INBOUND_FORWARD_NUMBER" || input.key === "VAPI_INBOUND_NUMBER") {
    return validateInboundDestination(input.key, input.value, input.twilioNumber);
  }
  return null;
}
