import { describe, expect, it } from "bun:test";
import {
  CALL_OUTCOMES,
  callOutcomeLabel,
  isCallOutcome,
  manualCallStatusForOutcome,
} from "@/app/(dashboard)/admin/contacts/callOutcomes";

describe("call outcomes", () => {
  it("accepts every configured outcome and rejects unknown slugs", () => {
    for (const outcome of CALL_OUTCOMES) {
      expect(isCallOutcome(outcome)).toBe(true);
    }
    expect(isCallOutcome("voicemail")).toBe(false);
    expect(isCallOutcome("")).toBe(false);
  });

  it("maps voicemail to VOICEMAIL and all other outcomes to COMPLETED", () => {
    for (const outcome of CALL_OUTCOMES) {
      expect(manualCallStatusForOutcome(outcome)).toBe(
        outcome === "voicemail_left" ? "VOICEMAIL" : "COMPLETED"
      );
    }
  });

  it("labels known outcomes and safely preserves unknown stored slugs", () => {
    expect(callOutcomeLabel("voicemail_left")).toBe("Voicemail left");
    expect(callOutcomeLabel("legacy_slug")).toBe("legacy_slug");
    expect(callOutcomeLabel(null)).toBeNull();
  });
});
