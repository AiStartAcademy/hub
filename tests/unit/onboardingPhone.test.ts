import { describe, expect, it } from "bun:test";
import { resolveFieldMapping } from "@/lib/onboarding-fields";
import {
  dedupeStoredPhoneValue,
  joinStoredPhoneValue,
  normalizePhoneE164,
  stripDuplicateDialCode,
} from "@/lib/phone";
import { onboardingPhoneForStorage } from "@/lib/onboarding-leads";
import { normalizePhone, parseAndValidateAnswers } from "@/lib/onboarding-security";

describe("onboarding phone support", () => {
  it("removes a country code duplicated in the national-number input", () => {
    expect(stripDuplicateDialCode("+1", "+1 (415) 234-5678")).toBe("4152345678");
    expect(dedupeStoredPhoneValue("+1 +1 (415) 234-5678")).toBe(
      joinStoredPhoneValue("+1", "4152345678")
    );
  });

  it("leaves a national number alone when its selected dial code is not duplicated", () => {
    expect(stripDuplicateDialCode("+1", "(415) 234-5678")).toBe("(415) 234-5678");
    expect(dedupeStoredPhoneValue("+1 (415) 234-5678")).toBe(
      joinStoredPhoneValue("+1", "(415) 234-5678")
    );
  });

  it("stores E.164 when parseable and preserves raw input when unparseable", () => {
    const joined = joinStoredPhoneValue("+1", "4152345678");
    expect(normalizePhoneE164(joined)).toBe("+14152345678");
    expect(onboardingPhoneForStorage(joined)).toBe("+14152345678");
    expect(onboardingPhoneForStorage("+1 12-34")).toBe("+1 12-34");
  });

  it("accepts and normalizes a valid phone-type answer", () => {
    const result = parseAndValidateAnswers(
      JSON.stringify({ answers: { phone: "  +1   4152345678  " } }),
      [{ id: "phone", type: "phone", required: true, options: [] }]
    );

    expect(result).toEqual({
      answers: { phone: joinStoredPhoneValue("+1", "4152345678") },
    });
  });

  it("rejects an invalid phone-type answer with status 400", () => {
    const result = parseAndValidateAnswers(
      JSON.stringify({ answers: { phone: "4152345678" } }),
      [{ id: "phone", type: "phone", required: true, options: [] }]
    );

    expect(result).toEqual({
      error: "Please enter a valid phone number.",
      status: 400,
    });
  });

  it("auto-infers a phone-type element into the phone mapping key without a label alias", () => {
    const mapping = resolveFieldMapping(
      [
        { id: "email", label: "Email", type: "text_single" },
        { id: "best-line", label: "Best line", type: "phone" },
      ],
      {}
    );

    expect(mapping.phone).toBe("best-line");
  });

  it("does not allow a phone-type element to map to email or firstName", () => {
    const mapping = resolveFieldMapping(
      [
        { id: "phone-field", label: "Email", type: "phone" },
        { id: "notes", label: "Notes", type: "text_single" },
      ],
      { email: "phone-field", firstName: "phone-field" }
    );

    expect(mapping.email).toBeUndefined();
    expect(mapping.firstName).toBeUndefined();
  });

  it("keeps legacy text_single phone mappings compatible with normalizePhone", () => {
    const mapping = resolveFieldMapping(
      [{ id: "legacy-phone", label: "Callback number", type: "text_single" }],
      { phone: "legacy-phone" }
    );
    expect(mapping.phone).toBe("legacy-phone");

    const result = parseAndValidateAnswers(
      JSON.stringify({ answers: { "legacy-phone": "(415) 234-5678" } }),
      [{ id: "legacy-phone", type: "text_single", required: false, options: [] }]
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(normalizePhone(result.answers["legacy-phone"])).toBe("(415) 234-5678");
  });
});
