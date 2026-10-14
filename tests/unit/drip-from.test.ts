import { beforeEach, describe, expect, it, mock } from "bun:test";
import { brand, brandFromMailbox } from "@/config/brand";

// resolveDripFrom() reads the DRIP_EMAIL_FROM key via getSecret(), which is
// backed by prisma.secret. Mock at the prisma boundary so we exercise the
// real getSecret() resolution order (DB → env → undefined), not a stub of it.
let secretRow: { kind: string; valuePlain: string | null } | null = null;
const findUniqueCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", () => ({
  default: {
    secret: {
      findUnique: async (args: Record<string, unknown>) => {
        findUniqueCalls.push(args);
        return secretRow;
      },
    },
  },
}));

const { bareAddress, resolveDripFrom } = await import("@/lib/drip/engine");
const { bustSecretCache } = await import("@/lib/secrets");
const { DRIP_FROM, DRIP_REPLY_TO, resolveDripSender } = await import("@/lib/drip/template");

describe("resolveDripSender", () => {
  it("prefers the neutral sender names over legacy aliases", () => {
    expect(
      resolveDripSender({
        DRIP_FROM: "new-from@example.com",
        DRIP_REPLY_TO: "new-reply@example.com",
        AISA_FROM: "old-from@example.com",
        AISA_REPLY_TO: "old-reply@example.com",
      })
    ).toEqual({ from: "new-from@example.com", replyTo: "new-reply@example.com" });
  });

  it("uses legacy aliases when neutral names are unset", () => {
    expect(
      resolveDripSender({
        AISA_FROM: "old-from@example.com",
        AISA_REPLY_TO: "old-reply@example.com",
      })
    ).toEqual({ from: "old-from@example.com", replyTo: "old-reply@example.com" });
  });

  it("falls back when neutral names are empty", () => {
    expect(
      resolveDripSender({
        DRIP_FROM: "  ",
        DRIP_REPLY_TO: "",
        AISA_FROM: "old-from@example.com",
        AISA_REPLY_TO: "old-reply@example.com",
      })
    ).toEqual({ from: "old-from@example.com", replyTo: "old-reply@example.com" });
  });

  it("uses brand defaults when no sender names are configured", () => {
    expect(resolveDripSender({})).toEqual({
      from: brandFromMailbox,
      replyTo: brand.email.contact,
    });
  });
});

describe("bareAddress", () => {
  it("extracts the address from a full mailbox", () => {
    expect(bareAddress(brandFromMailbox)).toBe(brand.email.contact);
  });

  it("returns a bare address unchanged", () => {
    expect(bareAddress(brand.email.contact)).toBe(brand.email.contact);
  });

  it("trims surrounding whitespace", () => {
    expect(bareAddress(`  ${brand.email.contact}  `)).toBe(brand.email.contact);
  });
});

describe("resolveDripFrom", () => {
  beforeEach(() => {
    secretRow = null;
    findUniqueCalls.length = 0;
    delete process.env.DRIP_EMAIL_FROM;
    bustSecretCache("DRIP_EMAIL_FROM");
  });

  it("falls back to the template defaults when the key is unset", async () => {
    const result = await resolveDripFrom();
    expect(result.from).toBe(DRIP_FROM);
    expect(result.replyTo).toBe(DRIP_REPLY_TO);
    expect(findUniqueCalls[0]?.where).toEqual({ key: "DRIP_EMAIL_FROM" });
  });

  it("uses a bare address from the Integrations store, formatted as a mailbox", async () => {
    secretRow = { kind: "config", valuePlain: brand.email.contact };
    bustSecretCache("DRIP_EMAIL_FROM");
    const result = await resolveDripFrom();
    expect(result.from).toBe(brandFromMailbox);
    expect(result.replyTo).toBe(brand.email.contact);
  });

  it("respects an already-formatted mailbox value without double-wrapping it", async () => {
    secretRow = { kind: "config", valuePlain: `"Hello Team" <${brand.email.contact}>` };
    bustSecretCache("DRIP_EMAIL_FROM");
    const result = await resolveDripFrom();
    expect(result.from).toBe(`"Hello Team" <${brand.email.contact}>`);
    expect(result.replyTo).toBe(brand.email.contact);
  });

  it("ignores a blank configured value and falls back to defaults", async () => {
    secretRow = { kind: "config", valuePlain: "   " };
    bustSecretCache("DRIP_EMAIL_FROM");
    const result = await resolveDripFrom();
    expect(result.from).toBe(DRIP_FROM);
    expect(result.replyTo).toBe(DRIP_REPLY_TO);
  });
});
