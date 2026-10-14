import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type SessionState = { user: { id: string } } | null;
type PersonContact = import("@/lib/leads/personRecord").PersonContact;

const USER_ID = "communication-user";
const NOW = new Date("2026-10-06T12:00:00.000Z");
const OLD_OPT_OUT = new Date("2026-09-01T12:00:00.000Z");
const PHONE = "+14155551234";

let session: SessionState = { user: { id: USER_ID } };
let personContact: PersonContact | null = null;

const authMock = mock(async () => session);
const contactFindFirstMock = mock(async () => personContact);
const contactFindUniqueMock = mock(async () => null);
const contactUpdateMock = mock(
  async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    personContact = { ...(personContact as PersonContact), ...data, id: where.id };
    return personContact;
  }
);
const contactCreateMock = mock(
  async ({ data }: { data: Record<string, unknown> }) => {
    personContact = {
      ...makeContact({ phone: null }),
      ...data,
      id: "created-contact",
    } as PersonContact;
    return personContact;
  }
);
const contactEventCreateMock = mock(async () => ({}));
const enrollmentCountMock = mock(async () => 0);
const paymentCountMock = mock(async () => 0);
const userFindUniqueMock = mock(async () => ({
  id: USER_ID,
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "STUDENT",
  image: null,
  timezone: "UTC",
  birthday: null,
  bio: null,
  emailVerified: NOW,
}));
const userUpdateMock = mock(async () => ({}));

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({ ...actualAuth, auth: authMock }));

const actualPrisma = await import("@/lib/prisma");
const fakePrismaClient = {
  user: { findUnique: userFindUniqueMock, update: userUpdateMock },
  contact: {
    findFirst: contactFindFirstMock,
    findUnique: contactFindUniqueMock,
    update: contactUpdateMock,
    create: contactCreateMock,
  },
  contactEvent: { create: contactEventCreateMock },
  enrollment: { count: enrollmentCountMock },
  payment: { count: paymentCountMock },
};
const prismaMockFactory = () => ({ ...actualPrisma, default: fakePrismaClient });
mock.module("@/lib/prisma", prismaMockFactory);

const {
  COMMUNICATION_PREFERENCE_COPY,
  communicationPreferencesFromContact,
  planCommunicationPreferenceRequest,
  planEmailPreferenceWrite,
  SMS_STOPPED_NOTE,
} = await import("@/lib/communicationPreferences");
const { GET, PATCH } = await import("@/app/api/me/route");

function makeContact(overrides: Partial<PersonContact> = {}): PersonContact {
  return {
    id: "contact-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    phone: PHONE,
    birthday: null,
    unsubscribedAt: null,
    courseEmailOptOutAt: null,
    phoneConsentAt: null,
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: null,
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

function lastContactWrite(): Record<string, unknown> | undefined {
  const update = contactUpdateMock.mock.calls.at(-1)?.[0] as
    | { data: Record<string, unknown> }
    | undefined;
  const create = contactCreateMock.mock.calls.at(-1)?.[0] as
    | { data: Record<string, unknown> }
    | undefined;
  return update?.data ?? create?.data;
}

beforeEach(() => {
  mock.module("@/lib/prisma", prismaMockFactory);
  session = { user: { id: USER_ID } };
  personContact = makeContact();
  authMock.mockClear();
  contactFindFirstMock.mockClear();
  contactFindUniqueMock.mockClear();
  contactUpdateMock.mockClear();
  contactCreateMock.mockClear();
  contactEventCreateMock.mockClear();
  enrollmentCountMock.mockClear();
  paymentCountMock.mockClear();
  userFindUniqueMock.mockClear();
  userUpdateMock.mockClear();
});

afterAll(() => {
  mock.module("@/lib/prisma", () => ({ ...actualPrisma }));
  mock.module("@/lib/auth", () => ({ ...actualAuth }));
  mock.restore();
});

describe("SC-23: communication preference planning", () => {
  it("SC-23: defaults email on and texts off without a Contact", () => {
    expect(communicationPreferencesFromContact(null)).toEqual({
      marketingEmail: true,
      courseEmail: true,
      marketingSms: false,
      courseSms: false,
    });
  });

  it("SC-23: derives all four switches from their independent fields", () => {
    expect(
      communicationPreferencesFromContact(
        makeContact({
          unsubscribedAt: OLD_OPT_OUT,
          smsMarketingConsentAt: NOW,
        })
      )
    ).toEqual({
      marketingEmail: false,
      courseEmail: true,
      marketingSms: true,
      courseSms: false,
    });
  });

  it("SC-23: plans exactly the marketing-email field", () => {
    expect(planEmailPreferenceWrite("marketingEmail", false, NOW, null)).toEqual({
      unsubscribedAt: NOW,
    });
    expect(planEmailPreferenceWrite("marketingEmail", true, NOW, OLD_OPT_OUT)).toEqual({
      unsubscribedAt: null,
    });
  });

  it("SC-23: plans exactly the course-email field", () => {
    expect(planEmailPreferenceWrite("courseEmail", false, NOW, null)).toEqual({
      courseEmailOptOutAt: NOW,
    });
    expect(planEmailPreferenceWrite("courseEmail", true, NOW, OLD_OPT_OUT)).toEqual({
      courseEmailOptOutAt: null,
    });
  });

  it("SC-23: preserves an existing opt-out timestamp when already off", () => {
    expect(planEmailPreferenceWrite("marketingEmail", false, NOW, OLD_OPT_OUT)).toEqual({});
    expect(planEmailPreferenceWrite("courseEmail", false, NOW, OLD_OPT_OUT)).toEqual({});
  });

  it("SC-23: email switches send only their own key", () => {
    const context = { savedPhone: null, enteredPhone: "", smsOptOutAt: null };
    expect(planCommunicationPreferenceRequest("marketingEmail", false, context)).toEqual({
      ok: true,
      body: { marketingEmail: false },
    });
    expect(planCommunicationPreferenceRequest("courseEmail", true, context)).toEqual({
      ok: true,
      body: { courseEmail: true },
    });
  });

  it("SC-23: SMS switches send only their own consent key against the saved phone", () => {
    const context = { savedPhone: PHONE, enteredPhone: PHONE, smsOptOutAt: null };
    expect(planCommunicationPreferenceRequest("marketingSms", true, context)).toEqual({
      ok: true,
      body: { smsMarketingConsent: true },
    });
    expect(planCommunicationPreferenceRequest("courseSms", false, context)).toEqual({
      ok: true,
      body: { smsTransactionalConsent: false },
    });
  });

  it("SC-23: a first SMS grant binds the entered number in E.164", () => {
    expect(
      planCommunicationPreferenceRequest("courseSms", true, {
        savedPhone: null,
        enteredPhone: "(415) 555-1234",
        smsOptOutAt: null,
      })
    ).toEqual({
      ok: true,
      body: { phone: PHONE, smsTransactionalConsent: true },
    });
  });

  it("SC-23: rejects an SMS grant without a valid phone", () => {
    for (const enteredPhone of ["", "12", "not a phone"]) {
      expect(
        planCommunicationPreferenceRequest("marketingSms", true, {
          savedPhone: null,
          enteredPhone,
          smsOptOutAt: null,
        })
      ).toEqual({ ok: false, error: "Add a valid mobile number before turning on texts." });
    }
  });

  it("SC-23: rejects an SMS grant while an unsaved phone edit is pending", () => {
    expect(
      planCommunicationPreferenceRequest("marketingSms", true, {
        savedPhone: PHONE,
        enteredPhone: "+14155559999",
        smsOptOutAt: null,
      })
    ).toEqual({
      ok: false,
      error: "Save your new phone number first, then turn on texts.",
    });
  });

  it("SC-23: SMS switches are locked after STOP and never touch smsOptOutAt", () => {
    const context = { savedPhone: PHONE, enteredPhone: PHONE, smsOptOutAt: NOW.toISOString() };
    for (const key of ["marketingSms", "courseSms"] as const) {
      for (const enabled of [true, false]) {
        expect(planCommunicationPreferenceRequest(key, enabled, context)).toEqual({
          ok: false,
          error: SMS_STOPPED_NOTE,
        });
      }
    }
    expect(SMS_STOPPED_NOTE).toBe("You replied STOP. Text START to resubscribe.");
  });

  it("SC-23: exports labels and descriptions for all four switches", () => {
    expect(COMMUNICATION_PREFERENCE_COPY).toEqual({
      marketingEmail: {
        label: "Marketing emails",
        description: expect.any(String),
      },
      courseEmail: {
        label: "Course update emails",
        description: "Schedule changes and reminders for cohorts you're enrolled in.",
      },
      marketingSms: {
        label: "Marketing texts",
        description: expect.any(String),
      },
      courseSms: {
        label: "Course update texts",
        description: expect.any(String),
      },
    });
  });
});

describe("SC-23: GET and PATCH /api/me communication preferences", () => {
  it("SC-23: GET returns the two email switch values", async () => {
    personContact = makeContact({ unsubscribedAt: OLD_OPT_OUT });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      marketingEmail: false,
      courseEmail: true,
    });
  });

  it("SC-23: marketingEmail false writes only unsubscribedAt", async () => {
    const response = await PATCH(patchRequest({ marketingEmail: false }));

    expect(response.status).toBe(200);
    expect(lastContactWrite()).toEqual({ unsubscribedAt: expect.any(Date) });
  });

  it("SC-23: courseEmail true writes only courseEmailOptOutAt null", async () => {
    personContact = makeContact({ courseEmailOptOutAt: OLD_OPT_OUT });

    const response = await PATCH(patchRequest({ courseEmail: true }));

    expect(response.status).toBe(200);
    expect(lastContactWrite()).toEqual({ courseEmailOptOutAt: null });
  });

  it("SC-23: turning email off creates a settings Contact when none exists", async () => {
    personContact = null;

    const response = await PATCH(patchRequest({ marketingEmail: false }));

    expect(response.status).toBe(200);
    expect(contactCreateMock).toHaveBeenCalledTimes(1);
    expect(lastContactWrite()).toMatchObject({
      source: "settings",
      unsubscribedAt: expect.any(Date),
    });
  });

  it("SC-23: turning email on without a Contact is a no-op", async () => {
    personContact = null;

    const response = await PATCH(patchRequest({ courseEmail: true }));

    expect(response.status).toBe(200);
    expect(contactCreateMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
  });

  it("SC-23: marketing SMS changes only smsMarketingConsentAt", async () => {
    const response = await PATCH(patchRequest({ smsMarketingConsent: true }));

    expect(response.status).toBe(200);
    expect(lastContactWrite()).toEqual({ smsMarketingConsentAt: expect.any(Date) });
    expect(lastContactWrite()).not.toHaveProperty("phoneConsentAt");
    expect(lastContactWrite()).not.toHaveProperty("smsOptOutAt");
  });

  it("SC-23: course SMS changes only smsTransactionalConsentAt", async () => {
    personContact = makeContact({ smsTransactionalConsentAt: NOW });

    const response = await PATCH(patchRequest({ smsTransactionalConsent: false }));

    expect(response.status).toBe(200);
    expect(lastContactWrite()).toEqual({ smsTransactionalConsentAt: null });
    expect(lastContactWrite()).not.toHaveProperty("phoneConsentAt");
    expect(lastContactWrite()).not.toHaveProperty("smsOptOutAt");
  });

  it("SC-23: turning marketing SMS off leaves smsOptOutAt and the other consents alone", async () => {
    personContact = makeContact({
      phoneConsentAt: OLD_OPT_OUT,
      smsMarketingConsentAt: OLD_OPT_OUT,
      smsTransactionalConsentAt: OLD_OPT_OUT,
      smsOptOutAt: OLD_OPT_OUT,
    });

    const response = await PATCH(patchRequest({ smsMarketingConsent: false }));

    expect(response.status).toBe(200);
    expect(lastContactWrite()).toEqual({ smsMarketingConsentAt: null });
    expect(personContact).toMatchObject({
      phoneConsentAt: OLD_OPT_OUT,
      smsTransactionalConsentAt: OLD_OPT_OUT,
      smsOptOutAt: OLD_OPT_OUT,
    });
  });

  it("SC-23: the settings Save payload (phone + call consent) leaves SMS consents alone", async () => {
    personContact = makeContact({
      smsMarketingConsentAt: OLD_OPT_OUT,
      smsTransactionalConsentAt: OLD_OPT_OUT,
    });

    const response = await PATCH(patchRequest({ phone: PHONE, callConsent: true }));

    expect(response.status).toBe(200);
    expect(lastContactWrite()).toEqual({ phoneConsentAt: expect.any(Date) });
  });

  it("SC-23: rejects an SMS grant without a resulting phone and does not write", async () => {
    personContact = makeContact({ phone: null });

    const response = await PATCH(patchRequest({ smsMarketingConsent: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Add a mobile number before turning on texts.",
    });
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
  });

  it("SC-23: rejects non-boolean preference keys", async () => {
    for (const body of [
      { marketingEmail: "false" },
      { courseEmail: 1 },
      { smsMarketingConsent: null },
      { smsTransactionalConsent: "true" },
    ]) {
      const response = await PATCH(patchRequest(body));
      expect(response.status).toBe(400);
    }
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
  });

  it("SC-23: rejects unauthenticated preference writes", async () => {
    session = null;

    const response = await PATCH(patchRequest({ marketingEmail: false }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(contactFindFirstMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(contactCreateMock).not.toHaveBeenCalled();
  });
});
