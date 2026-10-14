import { describe, expect, it } from "bun:test";
import {
  fillContactPhoneFromCheckout,
  type ContactPhoneFillDb,
} from "@/lib/leads/personRecord";

const SUBMITTED = "+15550007777";
const EXISTING = "+15550008888";

type Call = { method: string; args: Record<string, unknown> };

function fakeDb(contact: { email: string; phone: string | null } | null): {
  db: ContactPhoneFillDb;
  calls: Call[];
} {
  const calls: Call[] = [];
  const db = {
    contact: {
      findUnique: async (args: Record<string, unknown>) => {
        calls.push({ method: "findUnique", args });
        return contact ? { ...contact } : null;
      },
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ method: "updateMany", args });
        return { count: 1 };
      },
      // Present so an accidental create would be recorded rather than throwing
      // an unrelated TypeError that could be mistaken for a pass.
      create: async (args: Record<string, unknown>) => {
        calls.push({ method: "create", args });
        return { id: "should-never-happen" };
      },
      update: async (args: Record<string, unknown>) => {
        calls.push({ method: "update", args });
        return { id: "should-never-happen" };
      },
    },
  } as unknown as ContactPhoneFillDb;
  return { db, calls };
}

const CONSENT_KEYS = ["phoneConsentAt", "smsOptOutAt", "doNotCall"] as const;

describe("fillContactPhoneFromCheckout (folded into personRecord)", () => {
  it("SC-24: fills a blank phone on an existing Contact and writes no consent field", async () => {
    const { db, calls } = fakeDb({ email: "buyer@example.com", phone: null });

    await fillContactPhoneFromCheckout({ buyerEmail: "Buyer@Example.com", phone: SUBMITTED }, db);

    const writes = calls.filter((c) => c.method === "updateMany");
    expect(writes).toHaveLength(1);
    expect((writes[0].args.data as Record<string, unknown>).phone).toBe(SUBMITTED);
    for (const key of CONSENT_KEYS) {
      expect(writes[0].args.data as Record<string, unknown>).not.toHaveProperty(key);
    }
  });

  it("SC-24: never creates a Contact when none exists for the buyer email", async () => {
    const { db, calls } = fakeDb(null);

    await fillContactPhoneFromCheckout({ buyerEmail: "ghost@example.com", phone: SUBMITTED }, db);

    expect(calls.some((c) => c.method === "create")).toBe(false);
    expect(calls.some((c) => c.method === "updateMany")).toBe(false);
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });

  it("SC-24: never overwrites an existing number and no-ops on missing email or phone", async () => {
    const populated = fakeDb({ email: "buyer@example.com", phone: EXISTING });
    await fillContactPhoneFromCheckout({ buyerEmail: "buyer@example.com", phone: SUBMITTED }, populated.db);
    expect(populated.calls.some((c) => c.method !== "findUnique")).toBe(false);

    const noEmail = fakeDb({ email: "buyer@example.com", phone: null });
    await fillContactPhoneFromCheckout({ buyerEmail: null, phone: SUBMITTED }, noEmail.db);
    expect(noEmail.calls).toHaveLength(0);

    const noPhone = fakeDb({ email: "buyer@example.com", phone: null });
    await fillContactPhoneFromCheckout({ buyerEmail: "buyer@example.com", phone: null }, noPhone.db);
    expect(noPhone.calls).toHaveLength(0);
  });
});
