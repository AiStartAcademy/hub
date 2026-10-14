import { describe, expect, test } from "bun:test";
import { brand } from "@/config/brand";
import {
  BODY_CHAR_BUDGET,
  buildGmailComposeUrl,
  buildOrganizerEmail,
  type OrganizerEmailEvent,
} from "@/lib/venueOrganizerEmail";

function baseEvent(overrides: Partial<OrganizerEmailEvent> = {}): OrganizerEmailEvent {
  return {
    title: "Example Org Networking",
    organizerName: "Jordan Lee",
    contactEmail: "organizer@example.com",
    date: "2026-08-19T00:00:00.000Z",
    startTime: "7:00 PM",
    endTime: "10:00 PM",
    quoteAmountCents: 40000,
    rentalFeeCents: null,
    rentalPaymentUrl: "https://buy.stripe.com/live_abc123",
    rentalPaymentStatus: "pending",
    latestAgreement: { token: "tok_abc", status: "DRAFT" },
    ...overrides,
  };
}

describe("buildOrganizerEmail", () => {
  test("full email carries both links, price, greeting, and next steps", () => {
    const email = buildOrganizerEmail(baseEvent());

    expect(email.to).toBe("organizer@example.com");
    expect(email.subject).toContain("August 19");
    expect(email.body).toContain("Hi Jordan,");
    expect(email.body).toContain("$400 flat");
    expect(email.body).toContain("Wednesday, August 19, 7:00 PM–10:00 PM");
    expect(email.body).toContain(brand.address.street);
    expect(email.body).toContain(`${brand.urls.hub}/agreements/tok_abc`);
    expect(email.body).toContain("https://buy.stripe.com/live_abc123");
    expect(email.body).toContain("Once you sign and payment comes through");
    expect(email.body).toContain(brand.founderFirstName);
    expect(email.warnings).toEqual([]);
  });

  test("agreement-only email omits the payment paragraph and warns", () => {
    const email = buildOrganizerEmail(
      baseEvent({ rentalPaymentUrl: null, rentalPaymentStatus: null })
    );

    expect(email.body).toContain("agreements/tok_abc");
    expect(email.body).not.toContain("payment link");
    expect(email.body).toContain("Once you sign,");
    expect(email.warnings.some((w) => w.includes("No payment link"))).toBe(true);
  });

  test("payment-only email omits the agreement paragraph and warns", () => {
    const email = buildOrganizerEmail(baseEvent({ latestAgreement: null }));

    expect(email.body).not.toContain("agreements/");
    expect(email.body).toContain("https://buy.stripe.com/live_abc123");
    expect(email.warnings.some((w) => w.includes("No agreement"))).toBe(true);
  });

  test("signed + paid variant thanks instead of linking", () => {
    const email = buildOrganizerEmail(
      baseEvent({
        latestAgreement: { token: "tok_abc", status: "SIGNED" },
        rentalPaymentStatus: "paid",
      })
    );

    expect(email.body).not.toContain("agreements/tok_abc");
    expect(email.body).not.toContain("buy.stripe.com");
    expect(email.body).toContain("The agreement is signed");
    expect(email.body).toContain("Payment is received");
    expect(email.body).toContain("just reply here");
    expect(email.warnings).toEqual([]);
  });

  test("rentalFeeCents wins over quoteAmountCents, and cents render when fractional", () => {
    const email = buildOrganizerEmail(baseEvent({ rentalFeeCents: 47550 }));
    expect(email.body).toContain("$475.50 flat");
  });

  test("body stays inside the Gmail deep-link budget", () => {
    const email = buildOrganizerEmail(baseEvent());
    expect(email.body.length).toBeLessThan(BODY_CHAR_BUDGET);
  });

  test("gmailUrl encodes to, subject, and body", () => {
    const url = new URL(buildGmailComposeUrl("a@b.co", "Sub ject", "Line 1\n\nLine 2"));
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("to")).toBe("a@b.co");
    expect(url.searchParams.get("su")).toBe("Sub ject");
    expect(url.searchParams.get("body")).toBe("Line 1\n\nLine 2");
  });
});
