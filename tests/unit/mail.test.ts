import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { brand, brandFromMailbox } from "@/config/brand";
import { content } from "@/config/content";

// Deliverability tests need a real transport seam. nodemailer is mocked here
// (mock.module is process-wide in bun, so this file owns that mock for the run)
// and @/lib/secrets is mocked narrowly: SMTP_HOST only, null for every other
// key, so nothing downstream (DRIP_EMAIL_FROM etc.) silently changes.
type SentOptions = {
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
};
const sent: SentOptions[] = [];
const transportSendMail = mock(async (options: SentOptions) => {
  sent.push(options);
  return { accepted: [options.to], rejected: [], response: "250 OK" };
});

mock.module("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: transportSendMail }) },
  createTransport: () => ({ sendMail: transportSendMail }),
}));
mock.module("@/lib/secrets", () => ({
  getSecret: async (key: string) => (key === "SMTP_HOST" ? "smtp.example.com" : null),
}));

// Query-param import busts bun's module registry: outreach-email.test.ts and
// outreach-text-to-html.test.ts both mock.module("@/lib/mail"), and that mock
// leaks across files in the same run — we need the real implementation here.
const { buildSelfPacedWelcomeEmail, fromHeader, sendMail, sendVerificationEmail } = (await import(
  "../../src/lib/mail.ts?real"
)) as typeof import("@/lib/mail");

const original = process.env.MAIL_FROM;
afterEach(() => {
  if (original === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = original;
});

beforeEach(() => {
  sent.length = 0;
  transportSendMail.mockClear();
});

describe("fromHeader", () => {
  it("wraps a bare address in a display name + angle brackets", () => {
    process.env.MAIL_FROM = brand.email.contact;
    expect(fromHeader()).toBe(brandFromMailbox);
  });

  it("leaves an already-formatted mailbox untouched (no double-wrapping)", () => {
    const mailbox = `"${brand.shortName}" <hi@${brand.domains.site}>`;
    process.env.MAIL_FROM = mailbox;
    expect(fromHeader()).toBe(mailbox);
  });

  it("passes through a bare address with angle brackets only", () => {
    const mailbox = `<hi@${brand.domains.site}>`;
    process.env.MAIL_FROM = mailbox;
    expect(fromHeader()).toBe(mailbox);
  });

  // Regression: the old code prefixed the academy name to MAIL_FROM before
  // applying the fallback.
  // where the || fallback was unreachable, so an unset MAIL_FROM produced the
  // academy name followed by `undefined` as the From header.
  it("falls back to a valid address when MAIL_FROM is unset", () => {
    delete process.env.MAIL_FROM;
    expect(fromHeader()).toBe(`"${brand.email.fromName}" <onboarding@example.com>`);
    expect(fromHeader()).not.toContain("undefined");
  });

  it("falls back when MAIL_FROM is empty or whitespace", () => {
    process.env.MAIL_FROM = "   ";
    expect(fromHeader()).toBe(`"${brand.email.fromName}" <onboarding@example.com>`);
  });

  it("honours an explicit override ahead of MAIL_FROM", () => {
    process.env.MAIL_FROM = brand.email.contact;
    expect(fromHeader(`billing@${brand.domains.site}`)).toBe(
      `"${brand.email.fromName}" <billing@${brand.domains.site}>`
    );
  });

  it("always produces a header containing an address in angle brackets", () => {
    for (const v of ["hello@x.com", '"N" <n@x.com>', "", "  "]) {
      process.env.MAIL_FROM = v;
      expect(fromHeader()).toMatch(/<[^>]+@[^>]+>/);
    }
  });
});

describe("sendMail plain-text alternative + custom headers", () => {
  it("SC1.11: hands nodemailer both html and a derived non-empty text part", async () => {
    await sendMail({
      to: "ada@example.com",
      subject: "Hello",
      html: '<p>Hi Ada, <a href="https://hub.example.com/x">open the hub</a>.</p>',
    });

    expect(transportSendMail).toHaveBeenCalledTimes(1);
    const options = sent[0]!;
    expect(options.html).toContain("<a href=");
    expect(options.text).toBeString();
    expect(options.text!.length).toBeGreaterThan(0);
    expect(options.text).toBe("Hi Ada, open the hub (https://hub.example.com/x).");
    expect(options.text).not.toContain("<");
  });

  it("SC1.12: prefers an explicitly supplied text part over the derived one", async () => {
    await sendMail({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Rendered</p>",
      text: "Handwritten plain text",
    });

    expect(sent[0]!.text).toBe("Handwritten plain text");
  });

  it("SC1.13: passes custom headers straight through to the transport", async () => {
    await sendMail({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Rendered</p>",
      headers: {
        "List-Unsubscribe": "<mailto:hello@example.com?subject=unsubscribe>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    expect(sent[0]!.headers).toEqual({
      "List-Unsubscribe": "<mailto:hello@example.com?subject=unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("SC1.14: sends no headers key when the caller supplies none", async () => {
    await sendMail({ to: "ada@example.com", subject: "Hello", html: "<p>Rendered</p>" });
    expect(sent[0]!.headers).toBeUndefined();
  });
});

describe("self-paced welcome email", () => {
  it("SC-4 uses the configured self-paced product name in the subject and body", () => {
    const email = buildSelfPacedWelcomeEmail("Ada Lovelace", "program-1");

    expect(email.subject).toBe(`Welcome to the ${content.selfPacedProgram.name}`);
    expect(email.html).toContain(`<strong>${content.selfPacedProgram.name}</strong>`);
  });

  it("SC-4 HTML-escapes a configured product name", () => {
    const email = buildSelfPacedWelcomeEmail(
      "Ada Lovelace",
      "program-1",
      'Self-Paced <Course> & "Lab"',
    );

    expect(email.html).toContain(
      "<strong>Self-Paced &lt;Course&gt; &amp; &quot;Lab&quot;</strong>",
    );
    expect(email.html).not.toContain("<Course>");
  });
});

describe("sendVerificationEmail", () => {
  it("SC1.15: includes a non-empty plain-text part alongside the HTML", async () => {
    await sendVerificationEmail("ada@example.com", "tok-123");

    const options = sent[0]!;
    expect(options.html).toContain("tok-123");
    expect(options.text).toBeString();
    expect(options.text!.length).toBeGreaterThan(0);
    expect(options.text).toContain("verify-email?token=tok-123");
  });

  it("SC5.1: uses the 'Verify my email' button label", async () => {
    await sendVerificationEmail("ada@example.com", "tok-123");

    expect(sent[0]!.html).toContain("Verify my email");
    expect(sent[0]!.html).not.toContain("Verify Email Setting");
  });

  it("SC5.2: carries no Cyrillic template comments", async () => {
    await sendVerificationEmail("ada@example.com", "tok-123");

    expect(sent[0]!.html).not.toMatch(/[Ѐ-ӿ]/);
  });
});
