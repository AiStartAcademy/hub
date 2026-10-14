import { beforeEach, describe, expect, it, mock } from "bun:test";

type ContactRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  birthday: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  userId: string | null;
  linkSource: string | null;
  status: string;
  source: string | null;
  tags: string | null;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
};

type PaymentRow = {
  userId: string | null;
  buyerEmail: string | null;
  status: string;
};

type ContactLookupArgs = {
  where: { id?: string; email?: string; userId?: string };
};

type UserLookupArgs = {
  where: { id: string };
};

type ContactCreateData = {
  email: string;
  name: string;
  phone: string | null;
  birthday?: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  userId: string;
  linkSource: string;
  status: string;
  source: string;
  tags: string;
};

type ContactCreateArgs = { data: ContactCreateData };
type ContactUpdateData = {
  phone?: string | null;
  phoneConsentAt?: Date | null;
  smsMarketingConsentAt?: Date | null;
  smsTransactionalConsentAt?: Date | null;
  smsOptOutAt?: Date | null;
  doNotCall?: boolean;
};
type ContactUpdateArgs = {
  where: { id: string };
  data: ContactUpdateData;
};
type ContactEventCreateArgs = {
  data: { contactId: string; type: string; metadata: string };
};
type CountArgs = { where: { userId: string } };
type PaymentCountArgs = {
  where: {
    userId?: string;
    status?: { in: readonly string[] };
    OR?: ReadonlyArray<{ userId: string } | { buyerEmail: string }>;
  };
};

const contacts: ContactRow[] = [];
const users: UserRow[] = [];
const enrolledUserIds = new Set<string>();
const payments: PaymentRow[] = [];
const contactCreates: ContactCreateArgs[] = [];
const contactUpdates: ContactUpdateArgs[] = [];
const contactEventCreates: ContactEventCreateArgs[] = [];

const contactModel = {
  findFirst: async (args: ContactLookupArgs): Promise<ContactRow | null> =>
    contacts.find((contact) => contact.userId === args.where.userId) ?? null,
  findUnique: async (args: ContactLookupArgs): Promise<ContactRow | null> =>
    contacts.find(
      (contact) =>
        (args.where.id !== undefined && contact.id === args.where.id) ||
        (args.where.email !== undefined && contact.email === args.where.email)
    ) ?? null,
  create: async (args: ContactCreateArgs): Promise<ContactRow> => {
    contactCreates.push(args);
    const contact: ContactRow = {
      id: `contact-${contacts.length + 1}`,
      birthday: null,
      smsOptOutAt: null,
      doNotCall: false,
      ...args.data,
    };
    contacts.push(contact);
    return contact;
  },
  update: async (args: ContactUpdateArgs): Promise<ContactRow> => {
    contactUpdates.push(args);
    const contact = contacts.find((row) => row.id === args.where.id);
    if (!contact) throw new Error(`Mock contact ${args.where.id} not found`);
    Object.assign(contact, args.data);
    return contact;
  },
};

const userModel = {
  findUnique: async (args: UserLookupArgs): Promise<UserRow | null> =>
    users.find((user) => user.id === args.where.id) ?? null,
};

const enrollmentModel = {
  count: async (args: CountArgs): Promise<number> =>
    enrolledUserIds.has(args.where.userId) ? 1 : 0,
};

const paymentModel = {
  count: async (args: PaymentCountArgs): Promise<number> =>
    payments.filter((payment) => {
      if (
        args.where.status &&
        !args.where.status.in.includes(payment.status)
      ) {
        return false;
      }
      if (
        args.where.OR &&
        !args.where.OR.some((route) =>
          "userId" in route
            ? payment.userId === route.userId
            : payment.buyerEmail === route.buyerEmail
        )
      ) {
        return false;
      }
      return (
        args.where.userId === undefined ||
        payment.userId === args.where.userId
      );
    }).length,
};

const contactEventModel = {
  create: async (
    args: ContactEventCreateArgs
  ): Promise<ContactEventCreateArgs["data"]> => {
    contactEventCreates.push(args);
    return args.data;
  },
};

type PrismaModuleMock = {
  default: {
    contact: typeof contactModel;
    user: typeof userModel;
    enrollment: typeof enrollmentModel;
    payment: typeof paymentModel;
    contactEvent: typeof contactEventModel;
  };
};

function createPrismaMock(): PrismaModuleMock {
  return {
    default: {
      contact: contactModel,
      user: userModel,
      enrollment: enrollmentModel,
      payment: paymentModel,
      contactEvent: contactEventModel,
    },
  };
}

mock.module("@/lib/prisma", createPrismaMock);

const { InvalidPhoneError, setPersonPhone } = await import(
  "@/lib/leads/personRecord"
);


function addUser(overrides: Partial<UserRow> = {}): UserRow {
  const user: UserRow = {
    id: "user-1",
    email: "person@example.com",
    name: "Person",
    ...overrides,
  };
  users.push(user);
  return user;
}

function addContact(overrides: Partial<ContactRow> = {}): ContactRow {
  const contact: ContactRow = {
    id: "contact-1",
    email: "person@example.com",
    name: "Person",
    phone: null,
    birthday: null,
    phoneConsentAt: null,
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: null,
    smsOptOutAt: null,
    doNotCall: false,
    userId: "user-1",
    linkSource: "auto_email",
    status: "NEW",
    source: null,
    tags: null,
    ...overrides,
  };
  contacts.push(contact);
  return contact;
}

beforeEach(() => {
  mock.module("@/lib/prisma", createPrismaMock);
  contacts.length = 0;
  users.length = 0;
  enrolledUserIds.clear();
  payments.length = 0;
  contactCreates.length = 0;
  contactUpdates.length = 0;
  contactEventCreates.length = 0;
});

describe("setPersonPhone consent state", () => {
  it("SC-4 first write creates a settings Contact with a derived WON status", async () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    addUser({ name: "  " });
    payments.push({
      userId: "user-1",
      buyerEmail: "person@example.com",
      status: "paid",
    });

    const result = await setPersonPhone({
      userId: "user-1",
      phone: "(415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
      now,
    });

    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0]?.data).toEqual({
      email: "person@example.com",
      name: "Lead",
      phone: "+14155552671",
      phoneConsentAt: now,
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      source: "settings",
      tags: JSON.stringify(["account"]),
      userId: "user-1",
      linkSource: "auto_email",
      status: "WON",
    });
    expect(result.phoneConsentAt).toBe(now);
    expect(contactEventCreates).toEqual([
      {
        data: {
          contactId: result.contactId,
          type: "PHONE_CONSENT",
          metadata: JSON.stringify({
            action: "granted",
            kind: "calls",
            source: "self",
            actorUserId: "user-1",
          }),
        },
      },
    ]);
  });

  it("SC-4b first write for a user with no enrollment and no payment derives a NEW status", async () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    addUser({ name: "  " });

    await setPersonPhone({
      userId: "user-1",
      phone: "(415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
      now,
    });

    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0]?.data.status).toBe("NEW");
  });

  it("SC-4c an enrollment alone (no payment) derives a WON status", async () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    addUser({ name: "  " });
    enrolledUserIds.add("user-1");

    await setPersonPhone({
      userId: "user-1",
      phone: "(415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
      now,
    });

    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0]?.data.status).toBe("WON");
  });

  it("SC-4d a pending payment alone derives NEW, not WON", async () => {
    addUser();
    payments.push({
      userId: "user-1",
      buyerEmail: "person@example.com",
      status: "pending",
    });

    await setPersonPhone({
      userId: "user-1",
      phone: "(415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
    });

    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0]?.data.status).toBe("NEW");
  });

  it("SC-4e a guest paid payment matched only by buyerEmail derives WON", async () => {
    addUser({ email: " Guest@Example.com " });
    payments.push({
      userId: null,
      buyerEmail: "guest@example.com",
      status: "paid",
    });

    await setPersonPhone({
      userId: "user-1",
      phone: "(415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
    });

    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0]?.data.status).toBe("WON");
  });

  it("SC-4f a refunded payment derives WON", async () => {
    addUser();
    payments.push({
      userId: "user-1",
      buyerEmail: "person@example.com",
      status: "refunded",
    });

    await setPersonPhone({
      userId: "user-1",
      phone: "(415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
    });

    expect(contactCreates).toHaveLength(1);
    expect(contactCreates[0]?.data.status).toBe("WON");
  });

  it("SC-5 checked consent sets phoneConsentAt", async () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    addContact();

    const result = await setPersonPhone({
      userId: "user-1",
      phone: "415-555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "admin",
      now,
    });

    expect(result.phone).toBe("+14155552671");
    expect(result.phoneConsentAt).toBe(now);
    expect(contactUpdates[0]?.data).toEqual({
      phone: "+14155552671",
      phoneConsentAt: now,
    });
    expect(contactEventCreates).toHaveLength(1);
  });

  it("SC-6 does not refresh existing consent evidence and skips a no-op update", async () => {
    const consentedAt = new Date("2026-01-02T03:04:05.000Z");
    addContact({ phone: "+14155552671", phoneConsentAt: consentedAt });

    const result = await setPersonPhone({
      userId: "user-1",
      phone: "+1 (415) 555-2671",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
      now: new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(result.phoneConsentAt).toBe(consentedAt);
    expect(contactUpdates).toHaveLength(0);
    expect(contactEventCreates).toHaveLength(0);
  });

  it("SC-7 re-checking consent never clears a non-null smsOptOutAt", async () => {
    const consentedAt = new Date("2026-01-02T03:04:05.000Z");
    const optedOutAt = new Date("2026-02-03T04:05:06.000Z");
    addContact({
      phone: "+14155552671",
      phoneConsentAt: consentedAt,
      smsOptOutAt: optedOutAt,
    });

    const result = await setPersonPhone({
      userId: "user-1",
      phone: "+1 212 555 0123",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
    });

    expect(result.smsOptOutAt).toBe(optedOutAt);
    // The number changed, so call consent is re-stamped for the new number;
    // smsOptOutAt is never part of the write.
    expect(contactUpdates[0]?.data).toEqual({
      phone: "+12125550123",
      phoneConsentAt: expect.any(Date),
    });
    expect(contactUpdates[0]?.data).not.toHaveProperty("smsOptOutAt");
    expect(contactUpdates[0]?.data).not.toHaveProperty("smsOptOutAt");
    expect(contactEventCreates).toHaveLength(0);
  });

  it("SC-8 unchecking withdraws consent and leaves doNotCall untouched", async () => {
    const contact = addContact({
      phone: "+14155552671",
      phoneConsentAt: new Date("2026-01-02T03:04:05.000Z"),
      doNotCall: true,
    });

    const result = await setPersonPhone({
      userId: "user-1",
      phone: "+14155552671",
      callConsent: false,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "admin",
    });

    expect(result.phoneConsentAt).toBeNull();
    expect(result.doNotCall).toBe(true);
    expect(contact.doNotCall).toBe(true);
    expect(contactUpdates[0]?.data).toEqual({ phoneConsentAt: null });
    expect(contactUpdates[0]?.data).not.toHaveProperty("doNotCall");
    expect(JSON.parse(contactEventCreates[0]?.data.metadata ?? "{}")).toEqual({
      action: "withdrawn",
      kind: "calls",
      source: "admin",
      actorUserId: "user-1",
    });
  });

  it("SC-9 clearing the phone clears consent and preserves opt-out and do-not-call", async () => {
    const optedOutAt = new Date("2026-02-03T04:05:06.000Z");
    addContact({
      phone: "+14155552671",
      phoneConsentAt: new Date("2026-01-02T03:04:05.000Z"),
      smsOptOutAt: optedOutAt,
      doNotCall: true,
    });

    const result = await setPersonPhone({
      userId: "user-1",
      phone: "   ",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
    });

    expect(result).toMatchObject({
      phone: null,
      phoneConsentAt: null,
      smsOptOutAt: optedOutAt,
      doNotCall: true,
    });
    expect(contactUpdates[0]?.data).toEqual({
      phone: null,
      phoneConsentAt: null,
    });
    expect(contactUpdates[0]?.data).not.toHaveProperty("smsOptOutAt");
    expect(contactUpdates[0]?.data).not.toHaveProperty("doNotCall");
    expect(contactEventCreates).toHaveLength(1);
  });

  it("SC-10 rejects an unparseable phone before any write", async () => {
    addUser();

    const attempt = setPersonPhone({
      userId: "user-1",
      phone: "not a phone number",
      callConsent: true,
      smsMarketingConsent: false,
      smsTransactionalConsent: false,
      actor: "self",
    });

    await expect(attempt).rejects.toBeInstanceOf(InvalidPhoneError);
    await expect(attempt).rejects.toMatchObject({
      name: "InvalidPhoneError",
      code: "INVALID_PHONE",
      message: "Enter a valid phone number.",
    });
    expect(contactCreates).toHaveLength(0);
    expect(contactUpdates).toHaveLength(0);
    expect(contactEventCreates).toHaveLength(0);
  });
});
