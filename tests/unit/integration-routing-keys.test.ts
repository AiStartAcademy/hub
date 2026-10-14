import { describe, expect, it } from "bun:test";

import {
  CATEGORIES,
  KINDS,
  KNOWN_INTEGRATION_KEYS,
} from "@/app/(dashboard)/admin/integrations/knownKeys";
import { validateIntegrationValue } from "@/lib/integrations/validateIntegrationValue";

describe("telephony integration registry and validation", () => {
  it("SC4.1: registers every telephony and routing key with comms metadata", () => {
    const expectedKinds = new Map<string, "secret" | "config">([
      ["TWILIO_ACCOUNT_SID", "config"],
      ["TWILIO_AUTH_TOKEN", "secret"],
      ["TWILIO_PHONE_NUMBER", "config"],
      ["TWILIO_API_KEY_SID", "config"],
      ["TWILIO_API_KEY_SECRET", "secret"],
      ["TWILIO_TWIML_APP_SID", "config"],
      ["VAPI_API_KEY", "secret"],
      ["VAPI_PHONE_NUMBER_ID", "config"],
      ["VAPI_DEFAULT_ASSISTANT_ID", "config"],
      ["VAPI_WEBHOOK_SECRET", "secret"],
      ["INBOUND_ROUTE_CHAIN", "config"],
      ["CLOSER_RING_STRATEGY", "config"],
      ["INBOUND_FORWARD_NUMBER", "config"],
      ["VAPI_INBOUND_NUMBER", "config"],
    ]);

    for (const [key, kind] of expectedKinds) {
      const entry = KNOWN_INTEGRATION_KEYS.find((candidate) => candidate.key === key);
      expect(entry, `${key} must be registered`).toBeDefined();
      expect(entry?.kind).toBe(kind);
      expect(entry?.category).toBe("comms");
      expect(entry?.example.trim().length).toBeGreaterThan(0);
    }

    for (const key of ["INBOUND_FORWARD_NUMBER", "VAPI_INBOUND_NUMBER"]) {
      const entry = KNOWN_INTEGRATION_KEYS.find((candidate) => candidate.key === key);
      expect(entry?.description).toContain("must never equal TWILIO_PHONE_NUMBER");
    }
  });

  it("SC4.2: keeps registry keys unique and all metadata valid and non-empty", () => {
    const keys = KNOWN_INTEGRATION_KEYS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const entry of KNOWN_INTEGRATION_KEYS) {
      expect(entry.key.trim().length).toBeGreaterThan(0);
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
      expect(entry.example.trim().length).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(entry.category);
      expect(KINDS).toContain(entry.kind);
    }
  });

  it("uses deployment-neutral endpoint examples", () => {
    for (const entry of KNOWN_INTEGRATION_KEYS) {
      expect(entry.example).not.toContain("svc.cluster.local");
    }
  });

  it("SC4.3: guards only inbound destination keys from normalized Twilio loops", () => {
    for (const key of ["INBOUND_FORWARD_NUMBER", "VAPI_INBOUND_NUMBER"]) {
      expect(
        validateIntegrationValue({
          key,
          value: "(415) 555-0123",
          twilioNumber: "+1 415 555 0123",
        }),
      ).toContain(`${key} must not match TWILIO_PHONE_NUMBER`);
      expect(
        validateIntegrationValue({
          key,
          value: "+14155550124",
          twilioNumber: "+14155550123",
        }),
      ).toBeNull();
    }

    expect(
      validateIntegrationValue({
        key: "UNRELATED_KEY",
        value: "(415) 555-0123",
        twilioNumber: "+14155550123",
      }),
    ).toBeNull();
  });

  it("SC4.4: rejects malformed route chains and unsupported ring strategies", () => {
    for (const value of [
      "not json",
      "{}",
      "[]",
      '["owner","unknown"]',
      '["owner","owner"]',
    ]) {
      expect(validateIntegrationValue({ key: "INBOUND_ROUTE_CHAIN", value })).not.toBeNull();
    }
    expect(
      validateIntegrationValue({
        key: "INBOUND_ROUTE_CHAIN",
        value: '["forward","vapi","closers","owner"]',
      }),
    ).toBeNull();

    for (const value of ["", "round_robin", "SIMULRING", "owner"]) {
      expect(validateIntegrationValue({ key: "CLOSER_RING_STRATEGY", value })).not.toBeNull();
    }
    expect(validateIntegrationValue({ key: "CLOSER_RING_STRATEGY", value: "simulring" })).toBeNull();
    expect(validateIntegrationValue({ key: "CLOSER_RING_STRATEGY", value: "round-robin" })).toBeNull();
  });
});
