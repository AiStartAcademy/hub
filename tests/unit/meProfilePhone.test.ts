import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

type SessionState = { user: { id: string } } | null;
type PersonContact = import("@/lib/leads/personRecord").PersonContact;

const USER_ID = "session-user";
const FOREIGN_USER_ID = "foreign-user";
const CONSENT_AT = new Date("2026-09-01T12:00:00.000Z");
const STOP_AT = new Date("2026-09-02T12:00:00.000Z");

let session: SessionState = { user: { id: USER_ID } };
/** The Contact that prisma.contact.findFirst resolves for the session user. */
let personContact: PersonContact | null = null;
/** Injected failure for the next contact write, to exercise the 500 path. */
let contactWriteError: Error | null = null;

const authMock = mock(async () => session);

const contactFindFirstMock = mock(async (_args: unknown) => {
  void _args;
  return personContact;
});
const contactFindUniqueMock = mock(async (_args: unknown) => {
  void _args;
  return null;
});
const contactCreateMock = mock(
  async ({ data }: { data: Record<string, unknown> }) => {
    if (contactWriteError) throw contactWriteError;
    return {
      ...makeContact({ phone: null, ...NO_CONSENT }),
      ...data,
      id: "contact-created",
    };
  }
);
const contactUpdateMock = mock(
  async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    if (contactWriteError) throw contactWriteError;
    return { ...(personContact as PersonContact), ...data, id: where.id };
  }
);
const contactEventCreateMock = mock(async (_args: unknown) => {
  void _args;
  return {};
});
const enrollmentCountMock = mock(async (_args: unknown) => {
  void _args;
  return 0;
});
const paymentCountMock = mock(async (_args: unknown) => {
  void _args;
  return 0;
});

const userFindUniqueMock = mock(async () => ({
  id: USER_ID,
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "STUDENT",
  image: null,
  timezone: "UTC",
  birthday: null,
  bio: null,
  emailVerified: CONSENT_AT,
}));
const userUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({
  id: USER_ID,
  name: data.name ?? "Ada Lovelace",
  email: "ada@example.com",
  image: data.image ?? null,
  timezone: data.timezone ?? "UTC",
  birthday: data.birthday ?? null,
  bio: data.bio ?? null,
}));

// bun's mock.module() is process-wide and PERSISTS for the rest of the run, and
// other suites snapshot destructured exports at load time — so an override here
// can never be handed back. Only "@/lib/auth" and "@/lib/prisma" are mocked, the
// two modules every route suite in this repo already replaces and re-registers
// per test. "@/lib/leads/personRecord" and "@/lib/logger" are deliberately NOT
// mocked: personPhoneConsent.test.ts exercises the real setPersonPhone and other
// suites assert on the real logger, so this file drives the REAL person-record
// helpers through the fake client below and spies on the logger per test instead.
const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: authMock,
}));

const actualPrisma = await import("@/lib/prisma");
const fakePrismaClient = {
  user: {
    findUnique: userFindUniqueMock,
    update: userUpdateMock,
  },
  contact: {
    findFirst: contactFindFirstMock,
    findUnique: contactFindUniqueMock,
    create: contactCreateMock,
    update: contactUpdateMock,
  },
  contactEvent: {
    create: contactEventCreateMock,
  },
  enrollment: { count: enrollmentCountMock },
  payment: { count: paymentCountMock },
};
const prismaMockFactory = () => ({ ...actualPrisma, default: fakePrismaClient });
mock.module("@/lib/prisma", prismaMockFactory);

const actualPersonRecord = await import("@/lib/leads/personRecord");
const { logger } = await import("@/lib/logger");
const { GET, PATCH } = await import("@/app/api/me/route");

const NO_CONSENT = {
  phoneConsentAt: null,
  smsMarketingConsentAt: null,
  smsTransactionalConsentAt: null,
} as const;
const ALL_CONSENT = {
  smsMarketingConsent: true,
  smsTransactionalConsent: true,
  callConsent: true,
} as const;
const WITHDRAW_ALL_CONSENT = {
  smsMarketingConsent: false,
  smsTransactionalConsent: false,
  callConsent: false,
} as const;

function makeContact(overrides: Partial<PersonContact> = {}): PersonContact {
  return {
    id: "contact-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    phone: "+14155551234",
    birthday: null,
    phoneConsentAt: CONSENT_AT,
    smsMarketingConsentAt: CONSENT_AT,
    smsTransactionalConsentAt: CONSENT_AT,
    smsOptOutAt: null,
    doNotCall: false,
    userId: USER_ID,
    linkSource: "auto_email",
    ...overrides,
  };
}

function patchRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let loggerErrorSpy: ReturnType<typeof spyOn>;
let loggerInfoSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  // Re-registered per test so a suite that ran earlier cannot leave its own
  // client installed for this one.
  mock.module("@/lib/prisma", prismaMockFactory);
  session = { user: { id: USER_ID } };
  personContact = null;
  contactWriteError = null;
  loggerErrorSpy = spyOn(logger, "error").mockImplementation(() => undefined);
  loggerInfoSpy = spyOn(logger, "info").mockImplementation(() => undefined);
  authMock.mockClear();
  contactFindFirstMock.mockClear();
  contactFindUniqueMock.mockClear();
  contactCreateMock.mockClear();
  contactUpdateMock.mockClear();
  contactEventCreateMock.mockClear();
  enrollmentCountMock.mockClear();
  paymentCountMock.mockClear();
  userFindUniqueMock.mockClear();
  userUpdateMock.mockClear();
});

afterEach(() => {
  // Restore the shared logger so no assertion in a later file sees these spies.
  loggerErrorSpy.mockRestore();
  loggerInfoSpy.mockRestore();
});

afterAll(() => {
  mock.module("@/lib/prisma", () => ({ ...actualPrisma }));
  mock.module("@/lib/auth", () => ({ ...actualAuth }));
  mock.restore();
});

/** The phone written by the last contact create or update, as stored. */
function lastWrittenPhone(): unknown {
  const call =
    contactUpdateMock.mock.calls.at(-1)?.[0] ?? contactCreateMock.mock.calls.at(-1)?.[0];
  return (call as { data?: Record<string, unknown> } | undefined)?.data?.phone;
}

function lastConsentEventMetadata(): Record<string, unknown> | null {
  const call = contactEventCreateMock.mock.calls.at(-1)?.[0] as
    | { data: { metadata: string } }
    | undefined;
  return call ? (JSON.parse(call.data.metadata) as Record<string, unknown>) : null;
}

describe("GET /api/me phone state", () => {
  it("SC-24: returns the linked Contact phone and consent state", async () => {
    personContact = makeContact();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      phone: "+14155551234",
      phoneConsentAt: CONSENT_AT.toISOString(),
      smsOptOutAt: null,
      doNotCall: false,
      smsable: true,
    });
    expect(contactFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  it("SC-25: returns empty state without creating or updating anything when no Contact is linked", async () => {
    personContact = null;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      phone: null,
      phoneConsentAt: null,
      smsOptOutAt: null,
      doNotCall: false,
      smsable: false,
    });
    expect(contactCreateMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactEventCreateMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("returns honest no-consent, consented, STOP'd, and DNC states", async () => {
    const cases = [
      {
        contact: makeContact({ ...NO_CONSENT }),
        expected: { smsable: false, phoneConsentAt: null, smsOptOutAt: null, doNotCall: false },
      },
      {
        contact: makeContact(),
        expected: {
          smsable: true,
          phoneConsentAt: CONSENT_AT.toISOString(),
          smsOptOutAt: null,
          doNotCall: false,
        },
      },
      {
        contact: makeContact({ smsOptOutAt: STOP_AT }),
        expected: {
          smsable: false,
          phoneConsentAt: CONSENT_AT.toISOString(),
          smsOptOutAt: STOP_AT.toISOString(),
          doNotCall: false,
        },
      },
      {
        contact: makeContact({ doNotCall: true }),
        expected: {
          smsable: true,
          phoneConsentAt: CONSENT_AT.toISOString(),
          smsOptOutAt: null,
          doNotCall: true,
        },
      },
    ];

    for (const testCase of cases) {
      personContact = testCase.contact;
      const response = await GET();
      expect(await response.json()).toMatchObject(testCase.expected);
    }
  });

  it("SC-28: rejects an unauthenticated read without resolving or returning phone data", async () => {
    session = null;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(body).not.toHaveProperty("phone");
    expect(contactFindFirstMock).not.toHaveBeenCalled();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/me phone state", () => {
  it("SC-26: sends a valid phone and consent through setPersonPhone as self", async () => {
    personContact = makeContact({ phone: null, ...NO_CONSENT });

    const response = await PATCH(
      patchRequest({ phone: "(415) 555-1234", ...ALL_CONSENT })
    );

    expect(response.status).toBe(200);
    // The real setPersonPhone normalized the number and stamped consent, and the
    // audit row proves actor "self" reached it.
    expect(lastWrittenPhone()).toBe("+14155551234");
    expect(contactUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact-1" },
        data: expect.objectContaining({ phone: "+14155551234" }),
      })
    );
    expect(lastConsentEventMetadata()).toMatchObject({
      action: "granted",
      source: "self",
      actorUserId: USER_ID,
    });
    expect(await response.json()).toMatchObject({
      phone: "+14155551234",
      smsOptOutAt: null,
      doNotCall: false,
      smsable: true,
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("supports phone-only PATCH: consent choices are kept but re-stamped for the new number", async () => {
    personContact = makeContact();

    const response = await PATCH(patchRequest({ phone: "+1 650 555 0100" }));

    expect(response.status).toBe(200);
    expect(lastWrittenPhone()).toBe("+16505550100");
    // Consent was already granted and must not be re-stamped or withdrawn.
    expect(contactUpdateMock.mock.calls.at(-1)?.[0]).toMatchObject({
      data: { phone: "+16505550100" },
    });
    // Consent belongs to a number: the choices stay ticked, but their evidence
    // is dated to the moment the new number was saved, never the old number.
    const phoneOnlyData = (
      contactUpdateMock.mock.calls.at(-1)?.[0] as { data: Record<string, Date> }
    ).data;
    for (const key of [
      "phoneConsentAt",
      "smsMarketingConsentAt",
      "smsTransactionalConsentAt",
    ] as const) {
      expect(phoneOnlyData[key]).toBeInstanceOf(Date);
      expect(phoneOnlyData[key].getTime()).toBeGreaterThan(CONSENT_AT.getTime());
    }
  });

  it("supports consent-only PATCH while preserving the stored phone", async () => {
    personContact = makeContact({ ...NO_CONSENT });

    // Only the marketing-text box is sent: the other two consents must not move.
    const response = await PATCH(patchRequest({ smsMarketingConsent: true }));

    expect(response.status).toBe(200);
    // No phone in the body: the stored number is reused, and only consent moves.
    expect(
      (contactUpdateMock.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data
    ).toEqual({ smsMarketingConsentAt: expect.any(Date) });
    expect(lastConsentEventMetadata()).toMatchObject({ action: "granted", source: "self" });
  });

  it("supports clearing a phone with an empty string", async () => {
    personContact = makeContact();

    const response = await PATCH(patchRequest({ phone: "", ...WITHDRAW_ALL_CONSENT }));

    expect(response.status).toBe(200);
    expect(
      (contactUpdateMock.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data
    ).toEqual({ phone: null, ...NO_CONSENT });
    expect(await response.json()).toMatchObject({
      phone: null,
      phoneConsentAt: null,
      smsable: false,
    });
  });

  it("keeps existing User-field-only updates working without touching phone state", async () => {
    const response = await PATCH(
      patchRequest({
        name: "Ada Byron",
        image: "data:image/png;base64,abc",
        timezone: "America/Los_Angeles",
        birthday: "1815-12-10",
        bio: "Mathematician",
      })
    );

    expect(response.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        timezone: true,
        birthday: true,
        bio: true,
      },
      data: {
        name: "Ada Byron",
        image: "data:image/png;base64,abc",
        timezone: "America/Los_Angeles",
        birthday: "1815-12-10",
        bio: "Mathematician",
      },
    });
    expect(contactFindFirstMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
  });

  it("keeps the existing 400 response when no fields are supplied", async () => {
    const response = await PATCH(patchRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No fields to update" });
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
  });

  it("SC-27: maps InvalidPhoneError to a safe 400 without logging the submitted value", async () => {
    personContact = makeContact();
    const submittedPhone = "not-a-phone-8675309";

    const response = await PATCH(
      patchRequest({ phone: submittedPhone, ...ALL_CONSENT })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Enter a valid phone number." });
    expect(JSON.stringify(body)).not.toContain(submittedPhone);
    // An unparseable number must not reach storage, and must never be logged.
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(loggerInfoSpy.mock.calls)).not.toContain(submittedPhone);
  });

  it("maps an INVALID_PHONE code to the same safe 400 when instanceof is unavailable", async () => {
    personContact = makeContact();
    contactWriteError = Object.assign(new Error("invalid"), { code: "INVALID_PHONE" });
    const submittedPhone = "+14155559999";

    const response = await PATCH(
      patchRequest({ phone: submittedPhone, ...ALL_CONSENT })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Enter a valid phone number." });
    expect(JSON.stringify(body)).not.toContain(submittedPhone);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("returns the existing 500 shape and logging for non-phone errors", async () => {
    personContact = makeContact({ phone: null, ...NO_CONSENT });
    contactWriteError = new Error("Storage unavailable");

    const response = await PATCH(
      patchRequest({ phone: "+14155551234", ...ALL_CONSENT })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to update profile: Storage unavailable",
    });
    expect(loggerErrorSpy).toHaveBeenCalledTimes(2);
  });

  it("SC-28: rejects an unauthenticated write before reading its body or phone state", async () => {
    session = null;

    const response = await PATCH(
      patchRequest({ phone: "+14155551234", ...ALL_CONSENT })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(contactFindFirstMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("SC-29: ignores a foreign body userId and scopes reads and writes to the session user", async () => {
    personContact = makeContact({ ...NO_CONSENT });

    const response = await PATCH(
      patchRequest({
        userId: FOREIGN_USER_ID,
        phone: "+14155551234",
        ...ALL_CONSENT,
      })
    );

    expect(response.status).toBe(200);
    // Every read and write is keyed on the session user, never the body value.
    for (const call of contactFindFirstMock.mock.calls) {
      expect(call[0]).toMatchObject({ where: { userId: USER_ID } });
    }
    expect(lastConsentEventMetadata()).toMatchObject({ actorUserId: USER_ID });
    expect(JSON.stringify(contactFindFirstMock.mock.calls)).not.toContain(FOREIGN_USER_ID);
    expect(JSON.stringify(contactUpdateMock.mock.calls)).not.toContain(FOREIGN_USER_ID);

    personContact = makeContact();
    await PATCH(patchRequest({ userId: FOREIGN_USER_ID, phone: "+16505550100" }));
    expect(contactFindFirstMock.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { userId: USER_ID },
    });
    expect(JSON.stringify(contactEventCreateMock.mock.calls)).not.toContain(FOREIGN_USER_ID);
  });
});

it("SC-27 guard: the real InvalidPhoneError still carries the INVALID_PHONE code", () => {
  expect(new actualPersonRecord.InvalidPhoneError().code).toBe("INVALID_PHONE");
});
