// tests/unit/free-seat-email.test.ts
// SC3 (email half) — what a free registrant actually receives: when the next
// session is, the link they click, and a way into the passwordless account the
// registration just created for them.

import { describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

type TokenRow = { identifier: string; token: string; expires: Date };

const tokens: TokenRow[] = [];

mock.module("@/lib/prisma", () => ({
  default: {
    verificationToken: {
      findFirst: async ({ where }: { where: { identifier: string } }) =>
        tokens.find((t) => t.identifier === where.identifier) ?? null,
      delete: async ({
        where,
      }: {
        where: { identifier_token: { identifier: string; token: string } };
      }) => {
        const index = tokens.findIndex(
          (t) =>
            t.identifier === where.identifier_token.identifier &&
            t.token === where.identifier_token.token
        );
        if (index >= 0) tokens.splice(index, 1);
        return { count: 1 };
      },
      create: async ({ data }: { data: TokenRow }) => {
        tokens.push(data);
        return data;
      },
    },
  },
}));

const { renderFreeSeatEmail, accountSetupUrl } = await import("@/lib/mail");
const { generateAccountSetupToken } = await import("@/lib/tokens");

const cohortSlug = `${brand.name.toLowerCase().replaceAll(" ", "-")}-q-a`;
const base = {
  name: "Ada Lovelace",
  cohortTitle: `${brand.name} Q&A`,
  whenLine: "09 SEP 2026 · 18:00 PDT",
  joinLink: "https://zoom.us/j/borrowed",
  cohortUrl: `https://hub.test/cohorts/${cohortSlug}`,
};

describe("renderFreeSeatEmail", () => {
  it("SC3.1: subject names the cohort and the body carries the session time and join link", () => {
    const { subject, html } = renderFreeSeatEmail(base);
    expect(subject).toBe(`You're registered — ${brand.name} Q&A`);
    expect(html).toContain("09 SEP 2026 · 18:00 PDT");
    expect(html).toContain('href="https://zoom.us/j/borrowed"');
    expect(html).toContain("Ada");
  });

  it("SC3.2: with no upcoming link it promises one instead of rendering a dead anchor", () => {
    const { html } = renderFreeSeatEmail({ ...base, joinLink: null, whenLine: null });
    expect(html).toContain("We'll email you the join link before the session.");
    expect(html).not.toContain("<a href=\"\"");
  });

  it("SC3.3: a non-http join link is refused rather than rendered as an href", () => {
    const { html } = renderFreeSeatEmail({ ...base, joinLink: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("We'll email you the join link before the session.");
  });

  it("SC3.4: a setup token adds the set-password button; without one there is none", () => {
    const withToken = renderFreeSeatEmail({ ...base, setupToken: "tok-123" });
    expect(withToken.html).toContain("/set-password?token=tok-123");
    expect(withToken.html).toContain("Set up your account");

    const withoutToken = renderFreeSeatEmail(base);
    expect(withoutToken.html).not.toContain("/set-password");
  });

  it("SC3.5: every interpolated value is escaped — a name cannot inject markup", () => {
    const { html } = renderFreeSeatEmail({
      ...base,
      name: '<script>alert(1)</script>',
      cohortTitle: 'Q&A "live" <b>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Q&amp;A &quot;live&quot; &lt;b&gt;");
  });

  it("SC3.6: an unnamed registrant is greeted, not addressed as null", () => {
    const { html } = renderFreeSeatEmail({ ...base, name: null });
    expect(html).toContain("Hi there");
    expect(html).not.toContain("null");
  });
});

describe("accountSetupUrl", () => {
  it("SC3.7: builds the same /set-password link the account-setup email uses", () => {
    expect(accountSetupUrl("a b+c")).toContain("/set-password?token=a%20b%2Bc");
  });
});

describe("generateAccountSetupToken", () => {
  it("SC3.8: defaults to a one-hour token and honours an explicit longer TTL", async () => {
    tokens.length = 0;
    const before = Date.now();
    const short = await generateAccountSetupToken("guest@example.com");
    expect(short.identifier).toBe("account-setup:guest@example.com");
    const shortTtl = short.expires.getTime() - before;
    expect(shortTtl).toBeGreaterThan(3500 * 1000);
    expect(shortTtl).toBeLessThanOrEqual(3600 * 1000 + 5000);

    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const long = await generateAccountSetupToken("guest@example.com", { ttlMs: sevenDays });
    const longTtl = long.expires.getTime() - Date.now();
    expect(longTtl).toBeGreaterThan(sevenDays - 5000);
    expect(longTtl).toBeLessThanOrEqual(sevenDays + 5000);

    // The previous token for this identifier is replaced, not accumulated.
    expect(tokens).toHaveLength(1);
  });
});
