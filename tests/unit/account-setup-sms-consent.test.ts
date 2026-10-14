import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  password: string;
  emailVerified: Date | null;
};

type TokenRow = { token: string; identifier: string; expires: Date };

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
  source: string;
  tags: string;
  status: string;
};

type ContactEventRow = {
  contactId: string;
  type: string;
  metadata: string;
};

type DbState = {
  users: UserRow[];
  tokens: TokenRow[];
  contacts: ContactRow[];
  events: ContactEventRow[];
};

const USER_ID = "user-1";
const EMAIL = "student@example.com";
const TOKEN = "valid-setup-token";
const OLD_PASSWORD = "old-password-hash";
const CONSENT_AT = new Date("2026-09-01T12:00:00.000Z");

let state: DbState;
let contactWriteError: Error | null = null;
let transactionCommitted = false;
const callOrder: string[] = [];

function initialState(): DbState {
  return {
    users: [
      {
        id: USER_ID,
        email: EMAIL,
        name: "Student",
        password: OLD_PASSWORD,
        emailVerified: null,
      },
    ],
    tokens: [
      {
        token: TOKEN,
        identifier: `account-setup:${EMAIL}`,
        expires: new Date("2099-01-01T00:00:00.000Z"),
      },
    ],
    contacts: [],
    events: [],
  };
}

function cloneState(source: DbState): DbState {
  return {
    users: source.users.map((row) => ({
      ...row,
      emailVerified: row.emailVerified ? new Date(row.emailVerified) : null,
    })),
    tokens: source.tokens.map((row) => ({ ...row, expires: new Date(row.expires) })),
    contacts: source.contacts.map((row) => ({
      ...row,
      phoneConsentAt: row.phoneConsentAt ? new Date(row.phoneConsentAt) : null,
      smsMarketingConsentAt: row.smsMarketingConsentAt
        ? new Date(row.smsMarketingConsentAt)
        : null,
      smsTransactionalConsentAt: row.smsTransactionalConsentAt
        ? new Date(row.smsTransactionalConsentAt)
        : null,
      smsOptOutAt: row.smsOptOutAt ? new Date(row.smsOptOutAt) : null,
    })),
    events: source.events.map((row) => ({ ...row })),
  };
}

function makeClient(getState: () => DbState) {
  return {
    verificationToken: {
      findUnique: async ({ where }: { where: { token: string } }) =>
        getState().tokens.find((row) => row.token === where.token) ?? null,
      delete: async ({ where }: { where: { token: string } }) => {
        const db = getState();
        const index = db.tokens.findIndex((row) => row.token === where.token);
        if (index < 0) throw new Error("Token not found");
        const [deleted] = db.tokens.splice(index, 1);
        return deleted;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        getState().users.find(
          (row) =>
            (where.id !== undefined && row.id === where.id) ||
            (where.email !== undefined && row.email === where.email)
        ) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<UserRow, "password" | "emailVerified">>;
      }) => {
        const user = getState().users.find((row) => row.id === where.id);
        if (!user) throw new Error("User not found");
        Object.assign(user, data);
        callOrder.push("password-write");
        return user;
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        getState().contacts.find((row) => row.userId === where.userId) ?? null,
      findUnique: async ({ where }: { where: { email: string } }) =>
        getState().contacts.find((row) => row.email === where.email) ?? null,
      create: async ({ data }: { data: Omit<ContactRow, "id" | "birthday" | "smsOptOutAt" | "doNotCall"> }) => {
        if (contactWriteError) throw contactWriteError;
        const contact: ContactRow = {
          ...data,
          id: `contact-${getState().contacts.length + 1}`,
          birthday: null,
          smsOptOutAt: null,
          doNotCall: false,
        };
        getState().contacts.push(contact);
        callOrder.push("contact-write");
        return contact;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<ContactRow>;
      }) => {
        if (contactWriteError) throw contactWriteError;
        const contact = getState().contacts.find((row) => row.id === where.id);
        if (!contact) throw new Error("Contact not found");
        Object.assign(contact, data);
        callOrder.push("contact-write");
        return contact;
      },
    },
    contactEvent: {
      create: async ({ data }: { data: ContactEventRow }) => {
        getState().events.push(data);
        return data;
      },
    },
    enrollment: { count: async () => 1 },
    payment: { count: async () => 0 },
  };
}

const globalClient = makeClient(() => state);
const prismaMock = {
  ...globalClient,
  $transaction: async <T>(callback: (tx: ReturnType<typeof makeClient>) => Promise<T>) => {
    const draft = cloneState(state);
    const tx = makeClient(() => draft);
    const result = await callback(tx);
    state = draft;
    transactionCommitted = true;
    callOrder.push("commit");
    return result;
  },
};

const confirmationCalls: Array<{ afterCommit: boolean; input: unknown }> = [];
const sendSmsOptInConfirmationMock = mock(async (input: unknown) => {
  confirmationCalls.push({ afterCommit: transactionCommitted, input });
  callOrder.push("confirmation");
  return "sent" as const;
});

const realPrisma = await import("@/lib/prisma");
const realConfirmation = await import("@/lib/sms/optInConfirmation");
mock.module("@/lib/prisma", () => ({ ...realPrisma, default: prismaMock }));
mock.module("@/lib/sms/optInConfirmation", () => ({
  ...realConfirmation,
  sendSmsOptInConfirmation: sendSmsOptInConfirmationMock,
}));

const { InvalidPhoneError } = await import("@/lib/leads/personRecord");
const { POST } = await import("@/app/api/account/setup/route");

afterAll(() => {
  mock.module("@/lib/prisma", () => realPrisma);
  mock.module("@/lib/sms/optInConfirmation", () => realConfirmation);
  mock.restore();
});

beforeEach(() => {
  state = initialState();
  contactWriteError = null;
  transactionCommitted = false;
  callOrder.length = 0;
  confirmationCalls.length = 0;
  sendSmsOptInConfirmationMock.mockClear();
});

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/account/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function contact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "contact-1",
    email: EMAIL,
    name: "Student",
    phone: "+14155552671",
    birthday: null,
    phoneConsentAt: null,
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: null,
    smsOptOutAt: null,
    doNotCall: false,
    userId: USER_ID,
    linkSource: "auto_email",
    source: "existing",
    tags: "[]",
    status: "WON",
    ...overrides,
  };
}

describe("POST /api/account/setup SMS consent", () => {
  it("SC-18: unticked consent ignores the phone and writes no Contact", async () => {
    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+14155552671",
        smsTransactionalConsent: false,
      })
    );

    expect(response.status).toBe(200);
    expect(state.users[0]?.password).not.toBe(OLD_PASSWORD);
    expect(state.tokens).toHaveLength(0);
    expect(state.contacts).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(confirmationCalls).toHaveLength(0);
  });

  it("SC-19: ticked consent requires a valid phone and leaves valid-token state unchanged", async () => {
    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "not-a-phone",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter a valid mobile number to get class reminders by text.",
    });
    expect(state.users[0]?.password).toBe(OLD_PASSWORD);
    expect(state.tokens).toHaveLength(1);
    expect(state.contacts).toHaveLength(0);
  });

  it("SC-19: valid consent creates a number-bound transactional opt-in with account-setup source", async () => {
    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+1 (415) 555-2671",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(200);
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({
      phone: "+14155552671",
      smsMarketingConsentAt: null,
      phoneConsentAt: null,
      source: "account-setup",
    });
    expect(state.contacts[0]?.smsTransactionalConsentAt).toBeInstanceOf(Date);
    expect(state.events).toHaveLength(1);
    expect(JSON.parse(state.events[0]?.metadata ?? "{}")).toMatchObject({
      action: "granted",
      kind: "sms_transactional",
      source: "account-setup",
      actorUserId: USER_ID,
    });
    expect(confirmationCalls).toHaveLength(1);
    expect(confirmationCalls[0]?.afterCommit).toBe(true);
    expect(callOrder.slice(-2)).toEqual(["commit", "confirmation"]);
  });

  it("SC-19: same-number opt-in preserves existing marketing and call consent timestamps", async () => {
    state.contacts.push(
      contact({
        smsMarketingConsentAt: CONSENT_AT,
        phoneConsentAt: CONSENT_AT,
      })
    );

    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+1 415 555 2671",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(200);
    expect(state.contacts[0]?.smsMarketingConsentAt).toEqual(CONSENT_AT);
    expect(state.contacts[0]?.phoneConsentAt).toEqual(CONSENT_AT);
    expect(state.contacts[0]?.smsTransactionalConsentAt).toBeInstanceOf(Date);
  });

  it("SC-19: already-granted same-number consent sends no second confirmation", async () => {
    state.contacts.push(
      contact({
        smsTransactionalConsentAt: CONSENT_AT,
      })
    );

    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+1 415 555 2671",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(200);
    expect(state.contacts[0]?.smsTransactionalConsentAt).toEqual(CONSENT_AT);
    expect(confirmationCalls).toHaveLength(0);
  });

  it("SC-19: changing the number does not carry old-number marketing or call consent", async () => {
    state.contacts.push(
      contact({
        smsMarketingConsentAt: CONSENT_AT,
        phoneConsentAt: CONSENT_AT,
      })
    );

    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+1 212 555 0123",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(200);
    expect(state.contacts[0]).toMatchObject({
      phone: "+12125550123",
      smsMarketingConsentAt: null,
      phoneConsentAt: null,
    });
    expect(state.contacts[0]?.smsTransactionalConsentAt).toBeInstanceOf(Date);
  });

  it("SC-20: invalid token wins over an invalid phone and causes zero writes", async () => {
    const response = await POST(
      request({
        token: "unknown-token",
        password: "Valid1!password",
        phone: "not-a-phone",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "This setup link is invalid or has expired.",
    });
    expect(state.users[0]?.password).toBe(OLD_PASSWORD);
    expect(state.tokens).toHaveLength(1);
    expect(state.contacts).toHaveLength(0);
  });

  it("SC-20: expired token and missing user each cause zero writes", async () => {
    state.tokens[0]!.expires = new Date("2000-01-01T00:00:00.000Z");
    const expired = await POST(
      request({ token: TOKEN, password: "Valid1!password", smsTransactionalConsent: false })
    );
    expect(expired.status).toBe(400);
    expect(state.users[0]?.password).toBe(OLD_PASSWORD);
    expect(state.tokens).toHaveLength(1);

    state = initialState();
    state.users = [];
    const missingUser = await POST(
      request({ token: TOKEN, password: "Valid1!password", smsTransactionalConsent: false })
    );
    expect(missingUser.status).toBe(400);
    expect(state.tokens).toHaveLength(1);
    expect(state.contacts).toHaveLength(0);
  });

  it("SC-20: a contact write failure rolls back password, token, consent, and confirmation", async () => {
    contactWriteError = new Error("forced contact write failure");

    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+14155552671",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(500);
    expect(state.users[0]?.password).toBe(OLD_PASSWORD);
    expect(state.tokens).toHaveLength(1);
    expect(state.contacts).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(confirmationCalls).toHaveLength(0);
  });

  it("SC-20: InvalidPhoneError from the consent write rolls back and returns 400", async () => {
    contactWriteError = new InvalidPhoneError();

    const response = await POST(
      request({
        token: TOKEN,
        password: "Valid1!password",
        phone: "+14155552671",
        smsTransactionalConsent: true,
      })
    );

    expect(response.status).toBe(400);
    expect(state.users[0]?.password).toBe(OLD_PASSWORD);
    expect(state.tokens).toHaveLength(1);
    expect(confirmationCalls).toHaveLength(0);
  });
});
