import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  computeSalesTotals,
  formatAmount,
  isCollected,
  isCompleted,
  normalizeEmail,
  paymentToPurchase,
  membershipToPurchase,
  type Purchase,
} from "@/lib/purchases";

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  const kind = overrides.kind ?? "COHORT";

  return {
    id: "p1",
    kind,
    title:
      kind === "VENUE_RENTAL"
        ? "Venue rental — Demo Day"
        : kind === "MEMBERSHIP"
          ? brand.products.membership
          : "10-Day Intensive",
    tier: kind === "COHORT" ? "In Person" : null,
    status: "paid",
    amount: 50000,
    currency: "usd",
    purchasedAt: new Date("2026-07-01"),
    currentPeriodEnd: null,
    userId: "u1",
    buyerEmail: "buyer@example.com",
    buyerName: "Buyer",
    attribution: {},
    segment: null,
    cohortId: kind === "COHORT" ? "c1" : null,
    stripeSessionId: "cs_1",
    recoveredAt: null,
    couponCode: null,
    ...overrides,
  };
}

type PaymentRowInput = Parameters<typeof paymentToPurchase>[0];

function paymentRow(overrides: Partial<PaymentRowInput> = {}): PaymentRowInput {
  return {
    id: "p",
    userId: "u",
    cohortId: "c",
    venueEventId: null,
    buyerEmail: "a@b.com",
    buyerName: "A",
    attribution: '{"utm_source":"meta"}',
    segment: "founder",
    stripeSessionId: "cs",
    amount: 50000,
    currency: "usd",
    status: "paid",
    recoveredAt: null,
    couponCode: null,
    createdAt: new Date("2026-07-01"),
    cohort: { title: "10-Day Intensive" },
    venueEvent: null,
    group: { name: "In Person" },
    ...overrides,
  };
}

describe("formatAmount", () => {
  it("renders integer cents as currency", () => {
    expect(formatAmount(5000)).toBe("$50.00");
    expect(formatAmount(50000)).toBe("$500.00");
    expect(formatAmount(15000)).toBe("$150.00");
  });

  it("renders zero rather than an empty string", () => {
    expect(formatAmount(0)).toBe("$0.00");
  });

  it("does not lose cents to float drift", () => {
    expect(formatAmount(1999)).toBe("$19.99");
    expect(formatAmount(100)).toBe("$1.00");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("normalizes mixed-case guest checkout email for buyer matching", () => {
    expect(normalizeEmail("\tGuest.Buyer+Venue@Example.COM  ")).toBe(
      "guest.buyer+venue@example.com",
    );
  });

  it("rejects non-emails and empty values", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("status semantics", () => {
  it("treats paid and active as collected", () => {
    expect(isCollected("paid")).toBe(true);
    expect(isCollected("active")).toBe(true);
  });

  it("never treats pending or failed as collected", () => {
    expect(isCollected("pending")).toBe(false);
    expect(isCollected("failed")).toBe(false);
    expect(isCollected("refunded")).toBe(false);
  });

  it("does not present a pending checkout as a completed purchase", () => {
    expect(isCompleted(purchase({ status: "pending" }))).toBe(false);
    expect(isCompleted(purchase({ status: "failed" }))).toBe(false);
    expect(isCompleted(purchase({ status: "paid" }))).toBe(true);
  });
});

describe("computeSalesTotals", () => {
  const mixed = [
    purchase({ id: "a", status: "paid", amount: 50000 }),
    purchase({ id: "b", status: "paid", amount: 15000 }),
    purchase({ id: "c", status: "pending", amount: 50000 }),
    purchase({ id: "d", status: "failed", amount: 50000 }),
    purchase({ id: "e", status: "refunded", amount: 15000 }),
    purchase({ id: "f", kind: "MEMBERSHIP", status: "active", amount: 100 }),
    purchase({ id: "g", kind: "MEMBERSHIP", status: "canceled", amount: 100 }),
  ];

  it("counts only collected money as revenue", () => {
    // 50000 + 15000 paid, + 100 active membership
    expect(computeSalesTotals(mixed).collectedCents).toBe(65100);
  });

  it("excludes pending and failed rows from collected revenue", () => {
    const totals = computeSalesTotals(mixed);
    // The naive bug this guards: summing every amount would give 180200.
    expect(totals.collectedCents).not.toBe(180200);
    expect(totals.pendingCents).toBe(50000);
    expect(totals.failedCount).toBe(2); // row d (failed) + row g (canceled)
  });

  it("counts recovered money as a subset of collected, never an addition", () => {
    const recovered = new Date("2026-07-02");
    const rows = [
      purchase({ id: "a", status: "paid", amount: 50000, recoveredAt: recovered }),
      purchase({ id: "b", status: "paid", amount: 15000 }),
    ];
    const totals = computeSalesTotals(rows);
    expect(totals.recoveredCents).toBe(50000);
    expect(totals.recoveredCount).toBe(1);
    // The bug this guards: reporting 115000 collected by adding recovery back in.
    expect(totals.collectedCents).toBe(65000);
  });

  it("never counts an unpaid cart as recovered, even if stamped", () => {
    // A recoveredAt on a still-pending or failed row is data we should not
    // believe — money that was not collected cannot have been recovered.
    const stamped = new Date("2026-07-02");
    const totals = computeSalesTotals([
      purchase({ id: "a", status: "pending", amount: 50000, recoveredAt: stamped }),
      purchase({ id: "b", status: "failed", amount: 50000, recoveredAt: stamped }),
    ]);
    expect(totals.recoveredCents).toBe(0);
    expect(totals.recoveredCount).toBe(0);
  });

  it("reports refunds as their own figure", () => {
    expect(computeSalesTotals(mixed).refundedCents).toBe(15000);
  });

  it("computes net as collected minus refunded", () => {
    const totals = computeSalesTotals(mixed);
    expect(totals.netCents).toBe(totals.collectedCents - totals.refundedCents);
    expect(totals.netCents).toBe(50100);
  });

  it("counts every row exactly once", () => {
    const t = computeSalesTotals(mixed);
    expect(t.totalCount).toBe(mixed.length);
    expect(t.collectedCount + t.refundedCount + t.pendingCount + t.failedCount).toBe(mixed.length);
  });

  it("returns zeroes for an empty ledger without dividing by anything", () => {
    const t = computeSalesTotals([]);
    expect(t.collectedCents).toBe(0);
    expect(t.netCents).toBe(0);
    expect(t.totalCount).toBe(0);
  });

  it("counts a paid venue rental in collected totals", () => {
    const totals = computeSalesTotals([
      purchase({
        id: "venue-paid",
        kind: "VENUE_RENTAL",
        title: "Venue rental — Launch Night",
        status: "paid",
        amount: 87500,
      }),
    ]);

    expect(totals.collectedCents).toBe(87500);
    expect(totals.collectedCount).toBe(1);
    expect(totals.pendingCount).toBe(0);
  });

  it("excludes a pending venue rental from collected totals", () => {
    const totals = computeSalesTotals([
      purchase({
        id: "venue-pending",
        kind: "VENUE_RENTAL",
        title: "Venue rental — Alumni Mixer",
        status: "pending",
        amount: 64000,
      }),
    ]);

    expect(totals.collectedCents).toBe(0);
    expect(totals.pendingCents).toBe(64000);
    expect(totals.pendingCount).toBe(1);
  });
});

describe("row mapping", () => {
  it("carries cohort title and tier onto a cohort purchase", () => {
    const mapped = paymentToPurchase(paymentRow());
    expect(mapped.title).toBe("10-Day Intensive");
    expect(mapped.tier).toBe("In Person");
    expect(mapped.attribution.utm_source).toBe("meta");
    expect(mapped.kind).toBe("COHORT");
  });

  it("maps a venue payment to the venue rental label", () => {
    const mapped = paymentToPurchase(
      paymentRow({
        cohortId: null,
        venueEventId: "ve_1",
        venueEvent: { title: "Founder Demo Night", slug: "founder-demo-night" },
        group: null,
      }),
    );

    expect(mapped.kind).toBe("VENUE_RENTAL");
    expect(mapped.title).toContain("Founder Demo Night");
    expect(mapped.tier).toBeNull();
  });

  it("keeps cohort rows on the cohort branch when no venue event is present", () => {
    const mapped = paymentToPurchase(
      paymentRow({
        venueEventId: null,
        venueEvent: null,
        cohort: { title: "Accelerator Cohort" },
      }),
    );

    expect(mapped.kind).toBe("COHORT");
    expect(mapped.title).toBe("Accelerator Cohort");
  });

  it("survives malformed attribution JSON instead of throwing", () => {
    const mapped = paymentToPurchase(
      paymentRow({
        userId: null,
        buyerName: null,
        attribution: "{not json",
        segment: null,
        amount: 100,
        createdAt: new Date(),
        cohort: null,
        group: null,
      }),
    );
    expect(mapped.attribution).toEqual({});
    expect(mapped.title).toBe("Cohort seat");
  });

  it("maps an unknown status to pending rather than into revenue", () => {
    const mapped = paymentToPurchase(
      paymentRow({
        userId: null,
        buyerEmail: null,
        buyerName: null,
        attribution: null,
        segment: null,
        amount: 999,
        status: "weird_new_status",
        createdAt: new Date(),
        cohort: null,
        group: null,
      }),
    );
    expect(mapped.status).toBe("pending");
    expect(isCollected(mapped.status)).toBe(false);
  });

  it("carries currentPeriodEnd onto a membership purchase", () => {
    const end = new Date("2026-09-01");
    const mapped = membershipToPurchase({
      id: "m", userId: "u", buyerEmail: "a@b.com", buyerName: "A",
      attribution: null, segment: null, stripeSessionId: "cs",
      amount: 100, currency: "usd", status: "active", currentPeriodEnd: end,
      createdAt: new Date("2026-07-01"),
    });
    expect(mapped.kind).toBe("MEMBERSHIP");
    expect(mapped.currentPeriodEnd).toEqual(end);
    expect(mapped.tier).toBeNull();
  });
});
