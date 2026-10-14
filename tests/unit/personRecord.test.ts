import { beforeEach, describe, expect, it, mock } from "bun:test";

type ContactRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  birthday: string | null;
  phoneConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  userId: string | null;
  linkSource: string | null;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
};

type ContactLookupArgs = {
  where: { id?: string; email?: string; userId?: string };
};

type UserLookupArgs = {
  where: { id?: string; email?: string };
};

type ContactUpdateArgs = {
  where: { id: string };
  data: Partial<Pick<ContactRow, "userId" | "linkSource" | "birthday" | "name">>;
};

type UserUpdateArgs = {
  where: { id: string };
  data: Partial<Pick<UserRow, "name">>;
};

const contacts: ContactRow[] = [];
const users: UserRow[] = [];
const lookupOrder: string[] = [];
const contactCreates: unknown[] = [];
const contactUpdates: unknown[] = [];
const autoLinkCalls: string[] = [];

const contactModel = {
  findFirst: async (args: ContactLookupArgs): Promise<ContactRow | null> => {
    lookupOrder.push("contact.findFirst");
    return contacts.find((contact) => contact.userId === args.where.userId) ?? null;
  },
  findUnique: async (args: ContactLookupArgs): Promise<ContactRow | null> => {
    if (args.where.id !== undefined) {
      if (!autoLinkCalls.includes(args.where.id)) {
        autoLinkCalls.push(args.where.id);
      }
      const contact = contacts.find((row) => row.id === args.where.id);
      return contact ? { ...contact, linkSource: "manual" } : null;
    }
    lookupOrder.push("contact.findUnique");
    return contacts.find(
      (contact) =>
        args.where.email !== undefined && contact.email === args.where.email
    ) ?? null;
  },
  create: async (args: unknown): Promise<ContactRow> => {
    contactCreates.push(args);
    throw new Error("Unexpected contact create in resolvePersonContact test");
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
  findUnique: async (args: UserLookupArgs): Promise<UserRow | null> => {
    if (args.where.id !== undefined) {
      lookupOrder.push("user.findUnique");
      return users.find((user) => user.id === args.where.id) ?? null;
    }
    return users.find((user) => user.email === args.where.email) ?? null;
  },
  update: async (args: UserUpdateArgs): Promise<UserRow> => {
    const user = users.find((row) => row.id === args.where.id);
    if (!user) throw new Error(`Mock user ${args.where.id} not found`);
    Object.assign(user, args.data);
    return user;
  },
};

type TransactionClient = {
  contact: typeof contactModel;
  user: typeof userModel;
};

const transactionModel = async <T>(
  callback: (tx: TransactionClient) => Promise<T>
): Promise<T> => callback({ contact: contactModel, user: userModel });

const enrollmentModel = { count: async (): Promise<number> => 0 };
const paymentModel = { count: async (): Promise<number> => 0 };
const contactEventModel = {
  create: async (): Promise<never> => {
    throw new Error("Unexpected contact event in resolvePersonContact test");
  },
};

type PrismaModuleMock = {
  default: {
    contact: typeof contactModel;
    user: typeof userModel;
    enrollment: typeof enrollmentModel;
    payment: typeof paymentModel;
    contactEvent: typeof contactEventModel;
    $transaction: typeof transactionModel;
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
      $transaction: transactionModel,
    },
  };
}

mock.module("@/lib/prisma", createPrismaMock);

const { resolvePersonContact } = await import("@/lib/leads/personRecord");

function addContact(overrides: Partial<ContactRow> = {}): ContactRow {
  const contact: ContactRow = {
    id: "contact-1",
    email: "person@example.com",
    name: "Person",
    phone: null,
    birthday: null,
    phoneConsentAt: null,
    smsOptOutAt: null,
    doNotCall: false,
    userId: null,
    linkSource: null,
    ...overrides,
  };
  contacts.push(contact);
  return contact;
}

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

beforeEach(() => {
  mock.module("@/lib/prisma", createPrismaMock);
  contacts.length = 0;
  users.length = 0;
  lookupOrder.length = 0;
  contactCreates.length = 0;
  contactUpdates.length = 0;
  autoLinkCalls.length = 0;
});

describe("resolvePersonContact", () => {
  it("SC-1 resolves the contact via contact.userId first", async () => {
    const contact = addContact({ userId: "user-1", linkSource: "manual" });

    const result = await resolvePersonContact("user-1");

    expect(result).toEqual(contact);
    expect(lookupOrder).toEqual(["contact.findFirst"]);
    expect(autoLinkCalls).toEqual([]);
  });

  it("SC-2 falls back to a normalized-email match and starts auto-linking", async () => {
    addUser({ email: "  Person@Example.COM  " });
    const contact = addContact({ email: "person@example.com" });

    const result = await resolvePersonContact("user-1");

    expect(result).toEqual(contact);
    expect(lookupOrder).toEqual([
      "contact.findFirst",
      "user.findUnique",
      "contact.findUnique",
    ]);
    expect(autoLinkCalls).toEqual([contact.id]);
  });

  it("SC-3 returns null for a user with no contact and creates nothing", async () => {
    addUser();

    const result = await resolvePersonContact("user-1");

    expect(result).toBeNull();
    expect(contactCreates).toHaveLength(0);
    expect(contactUpdates).toHaveLength(0);
  });
});
