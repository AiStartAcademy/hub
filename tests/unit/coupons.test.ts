import { describe, expect, it, mock, beforeEach } from "bun:test";

// validateCode is the gate that decides whether real money comes off a real
// price, so it is mocked at the prisma boundary and exercised for real.
type Row = Record<string, unknown> | null;

let couponRow: Row = null;
let lastWhere: Record<string, unknown> | null = null;
let createdCouponData: Record<string, unknown> | null = null;

mock.module("@/lib/prisma", () => ({
  default: {
    coupon: {
      findUnique: async (args: { where: Record<string, unknown> }) => {
        lastWhere = args.where;
        return couponRow;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createdCouponData = args.data;
        return args.data;
      },
    },
  },
}));

mock.module("@/lib/stripe", () => ({
  stripe: {
    coupons: {
      create: async () => ({ id: "co_test" }),
      del: async () => undefined,
    },
    promotionCodes: {
      create: async () => ({ id: "promo_test" }),
      update: async () => undefined,
    },
  },
  stripeConfigured: false,
}));

const { CouponInputError, createCoupon, normalizeCouponCode, validateCode } =
  await import("@/lib/coupons");

const NOW = new Date("2026-08-12T12:00:00Z");

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: "cpn_1",
    code: "SAVE10",
    kind: "MANUAL",
    percentOff: 10,
    amountOff: null,
    appliesTo: "all",
    cohortId: null,
    maxRedemptions: null,
    expiresAt: null,
    active: true,
    ownerUserId: null,
    commissionPercent: null,
    stripePromotionCodeId: "promo_1",
    _count: { redemptions: 0 },
    owner: null,
    ...overrides,
  };
}

beforeEach(() => {
  couponRow = null;
  lastWhere = null;
  createdCouponData = null;
});

describe("normalizeCouponCode", () => {
  it("uppercases and trims usable codes", () => {
    expect(normalizeCouponCode("  save10 ")).toBe("SAVE10");
    expect(normalizeCouponCode("come-back-10")).toBe("COME-BACK-10");
  });

  it("rejects codes that would be unusable in Stripe", () => {
    expect(normalizeCouponCode("a")).toBeNull(); // too short
    expect(normalizeCouponCode("-LEADING")).toBeNull(); // must start alnum
    expect(normalizeCouponCode("HAS SPACE")).toBeNull();
    expect(normalizeCouponCode("EMOJI🎟")).toBeNull();
    expect(normalizeCouponCode(null)).toBeNull();
    expect(normalizeCouponCode(42)).toBeNull();
  });
});

describe("createCoupon", () => {
  it("creates a program coupon without a cohort pin", async () => {
    await expect(
      createCoupon({
        code: "prog10",
        kind: "MANUAL",
        percentOff: 10,
        appliesTo: "program",
        cohortId: "cohort_ignored",
      })
    ).resolves.toBeDefined();

    expect(createdCouponData).toMatchObject({
      code: "PROG10",
      appliesTo: "program",
      cohortId: null,
    });
  });

  it("rejects an invalid applies-to value", async () => {
    await expect(
      createCoupon({
        code: "invalid-scope",
        kind: "MANUAL",
        percentOff: 10,
        appliesTo: "bogus" as never,
      })
    ).rejects.toBeInstanceOf(CouponInputError);
  });
});

describe("validateCode", () => {
  it("accepts a live code and looks it up by its normalized form", async () => {
    couponRow = coupon();
    const result = await validateCode(" save10 ", { appliesTo: "cohort", now: NOW });
    expect(result?.code).toBe("SAVE10");
    expect(lastWhere).toEqual({ code: "SAVE10" });
  });

  it("returns null rather than throwing for an unknown or malformed code", async () => {
    couponRow = null;
    expect(await validateCode("NOPE", { appliesTo: "cohort", now: NOW })).toBeNull();
    expect(await validateCode("!!", { appliesTo: "cohort", now: NOW })).toBeNull();
  });

  it("rejects deactivated, expired and fully-redeemed codes", async () => {
    couponRow = coupon({ active: false });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).toBeNull();

    couponRow = coupon({ expiresAt: new Date("2026-08-11T12:00:00Z") });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).toBeNull();

    couponRow = coupon({ maxRedemptions: 2, _count: { redemptions: 2 } });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).toBeNull();

    // One use left is still usable.
    couponRow = coupon({ maxRedemptions: 2, _count: { redemptions: 1 } });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).not.toBeNull();
  });

  it("rejects a code with no Stripe mirror — nothing to apply at checkout", async () => {
    couponRow = coupon({ stripePromotionCodeId: null });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).toBeNull();
  });

  it("honors applies-to scoping in both directions", async () => {
    couponRow = coupon({ appliesTo: "membership" });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).toBeNull();
    expect(
      await validateCode("SAVE10", { appliesTo: "membership", now: NOW })
    ).not.toBeNull();

    // "all" applies everywhere.
    couponRow = coupon({ appliesTo: "all" });
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).not.toBeNull();
    expect(
      await validateCode("SAVE10", { appliesTo: "membership", now: NOW })
    ).not.toBeNull();
  });

  it("scopes program coupons to program checkouts", async () => {
    couponRow = coupon({ appliesTo: "program" });
    expect(
      await validateCode("SAVE10", { appliesTo: "program", now: NOW })
    ).not.toBeNull();
    expect(await validateCode("SAVE10", { appliesTo: "cohort", now: NOW })).toBeNull();
    expect(
      await validateCode("SAVE10", { appliesTo: "membership", now: NOW })
    ).toBeNull();

    couponRow = coupon({ appliesTo: "cohort" });
    expect(await validateCode("SAVE10", { appliesTo: "program", now: NOW })).toBeNull();

    couponRow = coupon({ appliesTo: "all" });
    expect(
      await validateCode("SAVE10", { appliesTo: "program", now: NOW })
    ).not.toBeNull();
  });

  it("pins a cohort-scoped code to its own cohort", async () => {
    couponRow = coupon({ appliesTo: "cohort", cohortId: "cohort_a" });
    expect(
      await validateCode("SAVE10", { appliesTo: "cohort", cohortId: "cohort_b", now: NOW })
    ).toBeNull();
    expect(
      await validateCode("SAVE10", { appliesTo: "cohort", cohortId: "cohort_a", now: NOW })
    ).not.toBeNull();
  });

  it("blocks an affiliate redeeming their own code, case- and space-insensitively", async () => {
    couponRow = coupon({
      kind: "AFFILIATE",
      ownerUserId: "user_1",
      commissionPercent: 10,
      owner: { email: "ambassador@example.com" },
    });

    expect(
      await validateCode("SAVE10", {
        appliesTo: "cohort",
        buyerEmail: " Ambassador@Example.com ",
        now: NOW,
      })
    ).toBeNull();

    // Anyone else may use it — that is the whole point of a referral code.
    expect(
      await validateCode("SAVE10", {
        appliesTo: "cohort",
        buyerEmail: "friend@example.com",
        now: NOW,
      })
    ).not.toBeNull();
  });
});
