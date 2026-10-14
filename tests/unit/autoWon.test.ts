import { beforeEach, describe, expect, it, mock } from "bun:test";

// Exercise the real autoWon service and the real status core it delegates to,
// keeping only their persistence and side-effect boundaries as stubs — matching
// the prisma-module mock style of the lead timeline and linking tests.
type ContactRow = {
  id: string;
  email: string;
  userId: string | null;
  status: string;
};

type EventRow = {
  contactId: string;
  type: string;
  metadata: string;
};

const contacts: ContactRow[] = [];
const events: EventRow[] = [];
const conversions: Array<{ name: string; leadId?: string }> = [];

/** Number of remaining updateMany calls that must report a lost compare-and-swap. */
let forcedConflicts = 0;

function matches(row: ContactRow, where: { id?: string; email?: string; userId?: string }): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.email !== undefined && row.email !== where.email) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  return true;
}

mock.module("@/lib/prisma", () => ({
  default: {
    contact: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        contacts.find((row) => matches(row, where)) ?? null,
      findFirst: async ({ where }: { where: { userId?: string } }) =>
        contacts.find((row) => matches(row, where)) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: { status: string };
      }) => {
        if (forcedConflicts > 0) {
          forcedConflicts -= 1;
          return { count: 0 };
        }
        const row = contacts.find((c) => c.id === where.id && c.status === where.status);
        if (!row) return { count: 0 };
        row.status = data.status;
        return { count: 1 };
      },
    },
    contactEvent: {
      create: async ({ data }: { data: EventRow }) => {
        events.push(data);
        return data;
      },
    },
  },
}));

mock.module("next/cache", () => ({ revalidatePath: () => {} }));

mock.module("@/lib/serverConversions", () => ({
  dispatchConversion: async (event: { name: string; leadId?: string }) => {
    conversions.push(event);
  },
}));

const { markLeadWonForPurchase } = await import("@/lib/leads/autoWon");

beforeEach(() => {
  contacts.length = 0;
  events.length = 0;
  conversions.length = 0;
  forcedConflicts = 0;
});

function seed(row: Partial<ContactRow> & { id: string }): ContactRow {
  const contact: ContactRow = {
    email: `${row.id}@example.com`,
    userId: null,
    status: "NEW",
    ...row,
  };
  contacts.push(contact);
  return contact;
}

describe("markLeadWonForPurchase", () => {
  it("SC-4: a real grant promotes a Contact to WON while a LOST Contact stays LOST", async () => {
    const contact = seed({ id: "c1" });
    const lostContact = seed({ id: "lost", status: "LOST" });

    await markLeadWonForPurchase({
      buyerEmail: "c1@example.com",
      kind: "COHORT",
      refId: "cohort-aug",
    });
    await markLeadWonForPurchase({
      buyerEmail: "lost@example.com",
      kind: "COHORT",
      refId: "cohort-sep",
    });

    expect(contact.status).toBe("WON");
    expect(lostContact.status).toBe("LOST");
    expect(events).toHaveLength(1);
    expect(events[0].contactId).toBe("c1");
    expect(events[0].type).toBe("PURCHASE");
    expect(JSON.parse(events[0].metadata)).toEqual({ kind: "COHORT", refId: "cohort-aug" });
    // A LOST Contact is inert, not merely un-promoted: it earns neither a
    // timeline entry nor a reported conversion.
    expect(events.some((event) => event.contactId === "lost")).toBe(false);
    expect(conversions.some((conversion) => conversion.leadId === "lost")).toBe(false);
  });

  it("reports the won conversion to Meta exactly once", async () => {
    seed({ id: "c1" });

    await markLeadWonForPurchase({ buyerEmail: "c1@example.com", kind: "COHORT", refId: "r1" });

    expect(conversions.map((c) => c.name)).toEqual(["lead_won"]);
  });

  it("is idempotent — a replayed webhook changes nothing and writes no second event", async () => {
    const contact = seed({ id: "c1" });
    const input = { buyerEmail: "c1@example.com", kind: "COHORT" as const, refId: "r1" };

    await markLeadWonForPurchase(input);
    await markLeadWonForPurchase(input);

    expect(contact.status).toBe("WON");
    expect(events).toHaveLength(1);
    expect(conversions).toHaveLength(1);
  });

  it("prefers the linked account over an email match", async () => {
    const linked = seed({ id: "linked", email: "other@example.com", userId: "u1" });
    const byEmail = seed({ id: "byEmail", email: "buyer@example.com" });

    await markLeadWonForPurchase({
      buyerEmail: "buyer@example.com",
      userId: "u1",
      kind: "MEMBERSHIP",
      refId: "m1",
    });

    expect(linked.status).toBe("WON");
    expect(byEmail.status).toBe("NEW");
  });

  it("falls back to the email match when the buyer's account is not linked to a lead", async () => {
    const byEmail = seed({ id: "byEmail", email: "buyer@example.com" });

    await markLeadWonForPurchase({
      buyerEmail: "buyer@example.com",
      userId: "u-unlinked",
      kind: "MEMBERSHIP",
      refId: "m1",
    });

    expect(byEmail.status).toBe("WON");
  });

  it("matches a buyer email that differs only by case and padding", async () => {
    const contact = seed({ id: "c1", email: "buyer@example.com" });

    await markLeadWonForPurchase({
      buyerEmail: "  BUYER@Example.COM  ",
      kind: "COHORT",
      refId: "r1",
    });

    expect(contact.status).toBe("WON");
  });

  it("returns quietly when the buyer was never a lead", async () => {
    await markLeadWonForPurchase({
      buyerEmail: "stranger@example.com",
      kind: "COHORT",
      refId: "r1",
    });

    expect(events).toHaveLength(0);
    expect(conversions).toHaveLength(0);
  });

  it("returns quietly when no buyer email or user id is usable", async () => {
    seed({ id: "c1" });

    await markLeadWonForPurchase({ buyerEmail: null, kind: "COHORT", refId: "r1" });

    expect(events).toHaveLength(0);
  });

  it("retries a lost compare-and-swap and succeeds on the second attempt", async () => {
    const contact = seed({ id: "c1" });
    forcedConflicts = 1;

    await markLeadWonForPurchase({ buyerEmail: "c1@example.com", kind: "COHORT", refId: "r1" });

    expect(contact.status).toBe("WON");
    expect(events).toHaveLength(1);
  });

  it("gives up without throwing when the conflict persists", async () => {
    const contact = seed({ id: "c1" });
    forcedConflicts = 2;

    await markLeadWonForPurchase({ buyerEmail: "c1@example.com", kind: "COHORT", refId: "r1" });

    expect(contact.status).toBe("NEW");
    expect(events).toHaveLength(0);
  });
});
