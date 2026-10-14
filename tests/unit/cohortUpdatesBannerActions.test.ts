import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type SessionState = { user: { id: string } } | null;

const USER_ID = "session-user";
const OWN_CONTACT_ID = "own-contact";
const FOREIGN_CONTACT_ID = "foreign-contact";

let session: SessionState = { user: { id: USER_ID } };
let resolvedContact: { id: string } | null = { id: OWN_CONTACT_ID };

const authMock = mock(async () => session);
const resolvePersonContactMock = mock(async (userId: string) => {
  void userId;
  return resolvedContact;
});
const setPersonPhoneMock = mock(async () => ({ contactId: OWN_CONTACT_ID }));
const contactUpdateMock = mock(async (args: unknown) => args);
const revalidatePathMock = mock((path: string, type?: "page" | "layout") => {
  void path;
  void type;
});

const actualAuth = { ...(await import("@/lib/auth")) };
mock.module("@/lib/auth", () => ({ ...actualAuth, auth: authMock }));

const actualPersonRecord = { ...(await import("@/lib/leads/personRecord")) };
mock.module("@/lib/leads/personRecord", () => ({
  ...actualPersonRecord,
  resolvePersonContact: resolvePersonContactMock,
  setPersonPhone: setPersonPhoneMock,
}));

const actualPrisma = { ...(await import("@/lib/prisma")) };
mock.module("@/lib/prisma", () => ({
  ...actualPrisma,
  default: { contact: { update: contactUpdateMock } },
}));

const actualCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...actualCache,
  revalidatePath: revalidatePathMock,
}));

const { addTransactionalSms, dismissCohortBanner, enableCourseEmails } = await import(
  "@/app/(dashboard)/cohorts/[id]/bannerActions"
);

beforeEach(() => {
  session = { user: { id: USER_ID } };
  resolvedContact = { id: OWN_CONTACT_ID };
  authMock.mockClear();
  resolvePersonContactMock.mockClear();
  setPersonPhoneMock.mockClear();
  contactUpdateMock.mockClear();
  revalidatePathMock.mockClear();
});

afterAll(() => {
  mock.module("@/lib/auth", () => ({ ...actualAuth }));
  mock.module("@/lib/leads/personRecord", () => ({ ...actualPersonRecord }));
  mock.module("@/lib/prisma", () => ({ ...actualPrisma }));
  mock.module("next/cache", () => ({ ...actualCache }));
  mock.restore();
});

describe("cohort updates banner server actions", () => {
  it("SC-22: rejects every unauthenticated action before resolving or writing a Contact", async () => {
    session = null;

    expect(await enableCourseEmails()).toEqual({ ok: false, error: "Not signed in." });
    expect(await addTransactionalSms("+14155551234", true)).toEqual({
      ok: false,
      error: "Not signed in.",
    });
    expect(await dismissCohortBanner()).toEqual({ ok: false, error: "Not signed in." });
    expect(resolvePersonContactMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(setPersonPhoneMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("SC-22: enables course emails only on the signed-in user's resolved Contact", async () => {
    expect(await enableCourseEmails()).toEqual({ ok: true, persisted: true });

    expect(resolvePersonContactMock).toHaveBeenCalledWith(USER_ID);
    expect(contactUpdateMock).toHaveBeenCalledWith({
      where: { id: OWN_CONTACT_ID },
      data: { courseEmailOptOutAt: null },
    });
    expect(contactUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FOREIGN_CONTACT_ID } })
    );
    const data = (contactUpdateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ courseEmailOptOutAt: null });
    expect(data).not.toHaveProperty("unsubscribedAt");
    expect(revalidatePathMock).toHaveBeenCalledWith("/cohorts/[id]", "page");
  });

  it("SC-22: treats enabling course emails without a Contact as a no-op", async () => {
    resolvedContact = null;

    expect(await enableCourseEmails()).toEqual({ ok: true, persisted: false });
    expect(contactUpdateMock).not.toHaveBeenCalled();
  });

  it("SC-22: validates explicit transactional consent and phone before any write", async () => {
    expect(await addTransactionalSms("+14155551234", false)).toEqual({
      ok: false,
      error: "Agree to receive course update texts before continuing.",
    });
    expect(await addTransactionalSms("not a phone", true)).toEqual({
      ok: false,
      error: "Enter a valid phone number.",
    });

    expect(resolvePersonContactMock).not.toHaveBeenCalled();
    expect(setPersonPhoneMock).not.toHaveBeenCalled();
    expect(contactUpdateMock).not.toHaveBeenCalled();
  });

  it("SC-22: adds transactional SMS through setPersonPhone for the session user only", async () => {
    expect(await addTransactionalSms("(415) 555-1234", true)).toEqual({
      ok: true,
      persisted: true,
    });

    // Ownership is carried by the session userId; setPersonPhone resolves the Contact.
    expect(setPersonPhoneMock).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        phone: "+14155551234",
        smsMarketingConsent: false,
        smsTransactionalConsent: true,
        callConsent: false,
        actor: "self",
      },
      {
        source: "cohort-banner",
        preserveSmsMarketingAndCallConsent: true,
      }
    );
    expect(
      (setPersonPhoneMock.mock.calls[0]?.[0] as { userId: string }).userId
    ).not.toBe(FOREIGN_CONTACT_ID);
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/cohorts/[id]", "page");
  });

  it("SC-22: allows setPersonPhone to create the signed-in user's missing Contact", async () => {
    resolvedContact = null;

    expect(await addTransactionalSms("+14155551234", true)).toEqual({
      ok: true,
      persisted: true,
    });
    expect(setPersonPhoneMock).toHaveBeenCalledTimes(1);
    expect(setPersonPhoneMock.mock.calls[0]?.[0]).toMatchObject({ userId: USER_ID });
  });

  it("SC-22: dismisses only the signed-in user's resolved Contact with a Date", async () => {
    expect(await dismissCohortBanner()).toEqual({ ok: true, persisted: true });

    expect(resolvePersonContactMock).toHaveBeenCalledWith(USER_ID);
    expect(contactUpdateMock).toHaveBeenCalledTimes(1);
    const write = contactUpdateMock.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { cohortBannerDismissedAt: Date };
    };
    expect(write.where).toEqual({ id: OWN_CONTACT_ID });
    expect(write.where.id).not.toBe(FOREIGN_CONTACT_ID);
    expect(write.data.cohortBannerDismissedAt).toBeInstanceOf(Date);
    expect(revalidatePathMock).toHaveBeenCalledWith("/cohorts/[id]", "page");
  });

  it("SC-22: reports an unpersisted dismissal when the user has no Contact", async () => {
    resolvedContact = null;

    expect(await dismissCohortBanner()).toEqual({ ok: true, persisted: false });
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("SC-22: propagates unexpected Contact write failures", async () => {
    contactUpdateMock.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    expect(enableCourseEmails()).rejects.toThrow("database unavailable");
  });
});
