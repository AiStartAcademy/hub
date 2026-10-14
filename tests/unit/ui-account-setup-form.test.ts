import { describe, expect, it } from "bun:test";

// Error-copy contract for /set-password: an invalid, used, or expired token
// must not dead-end the visitor — they get the two recovery paths.
import {
  ACCOUNT_SETUP_SMS_CONTENT,
  ACCOUNT_SETUP_SMS_HEADING,
  EXPIRED_LINK_COPY,
  accountSetupErrorMessage,
  buildAccountSetupPayload,
  defaultSmsConsentState,
  isExpiredLinkError,
} from "@/app/set-password/AccountSetupForm";
import {
  PRIVACY_POLICY_URL,
  SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  TERMS_OF_SERVICE_URL,
} from "@/lib/phone";

describe("account setup SMS consent", () => {
  it("SC-18: exposes the approved optional SMS copy, disclosure, and legal links", () => {
    expect(ACCOUNT_SETUP_SMS_HEADING).toBe("Get class reminders by text (optional)");
    expect(ACCOUNT_SETUP_SMS_CONTENT).toEqual({
      heading: ACCOUNT_SETUP_SMS_HEADING,
      disclosure: SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
      termsUrl: TERMS_OF_SERVICE_URL,
      privacyUrl: PRIVACY_POLICY_URL,
    });
  });

  it("SC-18: defaults to an empty phone and unchecked consent", () => {
    expect(defaultSmsConsentState()).toEqual({
      phone: "",
      smsTransactionalConsent: false,
    });
  });

  it("SC-18: includes an explicit false consent value in an unticked submit", () => {
    expect(
      buildAccountSetupPayload({
        token: "setup-token",
        password: "Valid1!password",
        phone: "+14155552671",
        smsTransactionalConsent: false,
      })
    ).toEqual({
      token: "setup-token",
      password: "Valid1!password",
      phone: "+14155552671",
      smsTransactionalConsent: false,
    });
  });
});

describe("isExpiredLinkError", () => {
  it("matches the API's invalid-or-expired message", () => {
    expect(isExpiredLinkError("This setup link is invalid or has expired.")).toBe(true);
  });

  it("ignores unrelated errors and non-strings", () => {
    expect(isExpiredLinkError("Could not set up the account.")).toBe(false);
    expect(isExpiredLinkError("Invalid setup link or password.")).toBe(false);
    expect(isExpiredLinkError(undefined)).toBe(false);
    expect(isExpiredLinkError(400)).toBe(false);
  });
});

describe("accountSetupErrorMessage", () => {
  it("swaps an expired/invalid token error for the recovery copy", () => {
    const msg = accountSetupErrorMessage("This setup link is invalid or has expired.");
    expect(msg).toBe(EXPIRED_LINK_COPY);
    expect(msg).toMatch(/may have expired/);
    expect(msg).toMatch(/Register again for the event/);
    expect(msg).toMatch(/sign in with Google using the same email/);
  });

  it("passes other API errors through verbatim (weak-password 400 included)", () => {
    expect(accountSetupErrorMessage("Invalid setup link or password.")).toBe(
      "Invalid setup link or password."
    );
    expect(accountSetupErrorMessage("Password too weak.")).toBe("Password too weak.");
  });

  it("falls back to the generic message when the body has no error", () => {
    expect(accountSetupErrorMessage(undefined)).toBe("Could not set up the account.");
    expect(accountSetupErrorMessage("")).toBe("Could not set up the account.");
  });
});
