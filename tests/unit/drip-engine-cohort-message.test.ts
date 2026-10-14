import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

type Row = Record<string, unknown>;

const NOW = new Date("2026-10-06T18:00:00.000Z");

let campaignRecord: Row | null;
let contactRecord: Row | null;
let dueEnrollments: Row[];
let cohortCampaigns: Row[];
let cohortRecord: Row | null;
let certificateCampaign: Row | null;
let certificateRecords: Row[];

const campaignFindUnique = mock(async (_args: Row) => campaignRecord);
const campaignFindMany = mock(async (_args: Row) => cohortCampaigns);
const campaignFindFirst = mock(async (_args: Row) => certificateCampaign);
const contactFindUnique = mock(async (_args: Row) => contactRecord);
const contactUpsert = mock(async (_args: Row) => contactRecord);
const enrollmentFindFirst = mock(async (_args: Row) => null);
const enrollmentFindUnique = mock(async (_args: Row) => null);
const enrollmentFindMany = mock(async (_args: Row) => dueEnrollments);
const enrollmentCreate = mock(async (args: Row) => ({
  id: "enrollment-created",
  ...((args.data ?? {}) as Row),
}));
const enrollmentUpdate = mock(async (args: Row) => args);
const cohortFindUnique = mock(async (_args: Row) => cohortRecord);
const certificateFindMany = mock(async (_args: Row) => certificateRecords);
const certificateUpdate = mock(async (args: Row) => args);
const sendCreate = mock(async (_args: Row) => ({ id: "send-1" }));
const sendUpdate = mock(async (args: Row) => args);
const sendUpdateMany = mock(async (args: Row) => args);
const sendMailMock = mock(async (_args: Row) => ({ messageId: "m-1" }));
const sendContactSmsMock = mock(async (_args: Row) => ({ ok: true }));

const prismaMock = {
  dripCampaign: {
    findUnique: campaignFindUnique,
    findMany: campaignFindMany,
    findFirst: campaignFindFirst,
  },
  contact: {
    findUnique: contactFindUnique,
    upsert: contactUpsert,
    update: async (args: Row) => args,
  },
  dripSend: {
    create: sendCreate,
    update: sendUpdate,
    updateMany: sendUpdateMany,
    findFirst: async () => null,
  },
  emailEvent: { create: async (args: Row) => args },
  secret: { findUnique: async () => null },
  dripEnrollment: {
    findFirst: enrollmentFindFirst,
    findUnique: enrollmentFindUnique,
    findMany: enrollmentFindMany,
    create: enrollmentCreate,
    update: enrollmentUpdate,
  },
  cohort: {
    findUnique: cohortFindUnique,
  },
  certificate: {
    findMany: certificateFindMany,
    update: certificateUpdate,
  },
  $transaction: async (operation: unknown) => {
    if (typeof operation === "function") {
      return operation(prismaMock);
    }
    return Promise.all(operation as Array<Promise<unknown>>);
  },
};

mock.module("@/lib/prisma", () => ({ default: prismaMock }));
const realMail = await import("@/lib/mail");
const realSmsSend = await import("@/lib/sms/send");
mock.module("@/lib/mail", () => ({ ...realMail, sendMail: sendMailMock }));
mock.module("@/lib/sms/send", () => ({ ...realSmsSend, sendContactSms: sendContactSmsMock }));
afterAll(() => {
  mock.module("@/lib/mail", () => realMail);
  mock.module("@/lib/sms/send", () => realSmsSend);
});

function activeCampaign(trigger: string): Row {
  return {
    id: `campaign-${trigger.toLowerCase()}`,
    name: trigger,
    slug: trigger.toLowerCase(),
    status: "ACTIVE",
    trigger,
    exitOnStatuses: "[]",
    timezone: "UTC",
    sendWindowStartHour: 0,
    sendWindowEndHour: 24,
    skipWeekends: false,
    steps: [{ order: 1, delayHours: 0 }],
  };
}

function contact(overrides: Row = {}): Row {
  return {
    id: "contact-1",
    email: "learner@example.com",
    name: "Learner",
    status: "NEW",
    tags: "[]",
    unsubscribedAt: null,
    courseEmailOptOutAt: null,
    ...overrides,
  };
}

function dueEnrollment(trigger: string, contactOverrides: Row): Row {
  return {
    id: `due-${trigger.toLowerCase()}`,
    cohortId: null,
    enrolledAt: NOW,
    lastStepOrder: 0,
    nextRunAt: NOW,
    contact: contact(contactOverrides),
    campaign: { ...activeCampaign(trigger), steps: [] },
  };
}

function resetMocks(): void {
  campaignRecord = null;
  contactRecord = contact();
  dueEnrollments = [];
  cohortCampaigns = [];
  cohortRecord = null;
  certificateCampaign = null;
  certificateRecords = [];

  campaignFindUnique.mockClear();
  campaignFindMany.mockClear();
  campaignFindFirst.mockClear();
  contactFindUnique.mockClear();
  contactUpsert.mockClear();
  enrollmentFindFirst.mockClear();
  enrollmentFindUnique.mockClear();
  enrollmentFindMany.mockClear();
  enrollmentCreate.mockClear();
  enrollmentUpdate.mockClear();
  cohortFindUnique.mockClear();
  certificateFindMany.mockClear();
  certificateUpdate.mockClear();
  sendCreate.mockClear();
  sendUpdate.mockClear();
  sendUpdateMany.mockClear();
  sendMailMock.mockClear();
  sendContactSmsMock.mockClear();
}

beforeEach(resetMocks);

describe("drip engine email scopes", () => {
  it("SC-8: enrollContact gates course and marketing campaigns on their own opt-out", async () => {
    const { enrollContact } = await import("@/lib/drip/engine");

    // A course email opt-out never blocks enrollment: the engine skips only the
    // EMAIL steps, so a student with transactional SMS consent still gets texts.
    for (const trigger of ["COHORT_MESSAGE", "COHORT_SCHEDULE"]) {
      campaignRecord = activeCampaign(trigger);
      contactRecord = contact({ courseEmailOptOutAt: NOW });
      enrollmentCreate.mockClear();

      expect(await enrollContact(String(campaignRecord.id), "contact-1", { now: NOW })).toEqual({
        ok: true,
        enrollmentId: "enrollment-created",
      });
      expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    }

    campaignRecord = activeCampaign("COHORT_MESSAGE");
    contactRecord = contact({ unsubscribedAt: NOW });
    enrollmentCreate.mockClear();
    expect(await enrollContact(String(campaignRecord.id), "contact-1", { now: NOW })).toEqual({
      ok: true,
      enrollmentId: "enrollment-created",
    });
    expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    expect(enrollmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: campaignRecord.id,
        contactId: "contact-1",
        status: "ACTIVE",
        enrolledAt: NOW,
        nextRunAt: expect.any(Date),
      }),
      select: { id: true },
    });

    campaignRecord = activeCampaign("LEAD_SEGMENT");
    contactRecord = contact({ unsubscribedAt: NOW });
    enrollmentCreate.mockClear();
    expect(await enrollContact(String(campaignRecord.id), "contact-1")).toEqual({
      ok: false,
      reason: "Contact unsubscribed",
    });
    expect(enrollmentCreate).not.toHaveBeenCalled();

    campaignRecord = activeCampaign("LEAD_SEGMENT");
    contactRecord = contact({ courseEmailOptOutAt: NOW });
    enrollmentCreate.mockClear();
    expect(await enrollContact(String(campaignRecord.id), "contact-1", { now: NOW })).toEqual({
      ok: true,
      enrollmentId: "enrollment-created",
    });
    expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    expect(enrollmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: campaignRecord.id,
        contactId: "contact-1",
        status: "ACTIVE",
      }),
      select: { id: true },
    });
  });

  it("SC-8: runDueSteps exits only on the marketing opt-out; course opt-out never exits", async () => {
    const { runDueSteps } = await import("@/lib/drip/engine");

    const run = async (trigger: string, contactOverrides: Row): Promise<Row> => {
      enrollmentUpdate.mockClear();
      dueEnrollments = [dueEnrollment(trigger, contactOverrides)];
      await runDueSteps(NOW, 1);
      expect(enrollmentUpdate).toHaveBeenCalledTimes(1);
      return ((enrollmentUpdate.mock.calls[0]?.[0] as Row).data ?? {}) as Row;
    };

    const courseOptOut = await run("COHORT_MESSAGE", { courseEmailOptOutAt: NOW });
    expect(courseOptOut).toMatchObject({ status: "COMPLETED" });
    expect(courseOptOut.exitReason).toBeUndefined();

    const courseWithMarketingOptOut = await run("COHORT_MESSAGE", { unsubscribedAt: NOW });
    expect(courseWithMarketingOptOut).toMatchObject({ status: "COMPLETED" });
    expect(courseWithMarketingOptOut.exitReason).toBeUndefined();

    expect(await run("LEAD_SEGMENT", { unsubscribedAt: NOW })).toMatchObject({
      status: "EXITED",
      exitReason: "unsubscribed",
    });

    const marketingWithCourseOptOut = await run("LEAD_SEGMENT", {
      courseEmailOptOutAt: NOW,
    });
    expect(marketingWithCourseOptOut).toMatchObject({ status: "COMPLETED" });
    expect(marketingWithCourseOptOut.exitReason).toBeUndefined();
  });

  it("SC-8: cohort reminder enrollment ignores both email opt-outs (steps are gated at send time)", async () => {
    const { enrollInCohortReminderCampaigns } = await import("@/lib/drip/cohortAnchor");
    cohortCampaigns = [
      {
        id: "cohort-reminders",
        steps: [{ order: 1, anchor: "ENROLLMENT", offsetMinutes: 0, delayHours: 0 }],
      },
    ];
    cohortRecord = {
      id: "cohort-1",
      slug: "fall-2026",
      title: "Fall 2026",
      status: "ENROLLMENT",
      deliveryMode: "ONLINE",
      location: null,
      zoomLink: null,
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      startTime: "10:00 AM",
      timezone: "UTC",
      sessions: [],
    };

    contactRecord = contact({ courseEmailOptOutAt: NOW });
    expect(
      await enrollInCohortReminderCampaigns("learner@example.com", "Learner", "cohort-1", {
        now: NOW,
      })
    ).toBe(true);
    expect(enrollmentCreate).toHaveBeenCalledTimes(1);

    contactRecord = contact({ unsubscribedAt: NOW });
    enrollmentCreate.mockClear();
    expect(
      await enrollInCohortReminderCampaigns("learner@example.com", "Learner", "cohort-1", {
        now: NOW,
      })
    ).toBe(true);
    expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    expect(enrollmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: "cohort-reminders",
        contactId: "contact-1",
        cohortId: "cohort-1",
        status: "ACTIVE",
      }),
    });
  });

  it("SC-8: certificate notification enrolls course opt-outs (email skipped, SMS eligible) and marketing opt-outs", async () => {
    const { enrollCertificateNotifications } = await import(
      "@/lib/drip/certificateNotify"
    );
    certificateCampaign = { id: "certificate-campaign" };
    cohortRecord = { id: "cohort-1", slug: "fall-2026" };
    certificateRecords = [
      {
        id: "certificate-1",
        cohortId: "cohort-1",
        notifiedAt: null,
        isRevoked: false,
        user: { email: "learner@example.com", name: "Learner" },
      },
    ];

    contactRecord = contact({ courseEmailOptOutAt: NOW });
    expect(await enrollCertificateNotifications("cohort-1", { now: NOW })).toMatchObject({
      ok: true,
      queued: 1,
      unsubscribed: 1,
    });
    expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    expect(certificateUpdate).toHaveBeenCalledTimes(1);

    contactRecord = contact({ unsubscribedAt: NOW });
    enrollmentCreate.mockClear();
    certificateUpdate.mockClear();
    expect(await enrollCertificateNotifications("cohort-1", { now: NOW })).toMatchObject({
      ok: true,
      queued: 1,
      unsubscribed: 0,
    });
    expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    expect(enrollmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: "certificate-campaign",
        contactId: "contact-1",
        cohortId: "cohort-1",
        status: "ACTIVE",
      }),
    });
    expect(certificateUpdate).toHaveBeenCalledWith({
      where: { id: "certificate-1" },
      data: { notifiedAt: NOW },
    });
  });
});

describe("cohort message trigger", () => {
  it("SC-9: COHORT_MESSAGE is a transactional campaign trigger", async () => {
    const { smsPurposeForCampaignTrigger } = await import("@/lib/drip/engine");
    const constants = await import("@/lib/drip/constants");

    expect(smsPurposeForCampaignTrigger("COHORT_MESSAGE")).toBe("transactional");
    expect(constants.COHORT_MESSAGE_TRIGGER).toBe("COHORT_MESSAGE");
    expect(constants.CAMPAIGN_TRIGGERS).toContain("COHORT_MESSAGE");
  });
});

describe("cohort message delivery", () => {
  // 07:00Z = midnight in Los Angeles: outside any SMS window, inside the all-day email window.
  const MIDNIGHT_LA = new Date("2026-10-06T07:00:00.000Z");
  const COHORT = {
    id: "cohort-1",
    slug: "fall-2026",
    title: "Fall 2026",
    status: "IN_PROGRESS",
    deliveryMode: "ONLINE",
    location: null,
    zoomLink: "https://zoom.us/j/123",
    startDate: null,
    startTime: null,
    timezone: "America/Los_Angeles",
    sessions: [],
  };
  const EMAIL_STEP = {
    id: "step-email",
    order: 1,
    delayHours: 0,
    anchor: "ENROLLMENT",
    offsetMinutes: 0,
    channel: "EMAIL",
    subject: "Update for {cohortName}",
    body: "<p>Hi {firstName}, room B tonight.</p>",
    ctaLabel: null,
    ctaUrl: null,
  };
  const SMS_STEP = {
    ...EMAIL_STEP,
    id: "step-sms",
    order: 2,
    channel: "SMS",
    subject: "SMS",
    body: "Hi {firstName}, room B tonight.",
  };

  function messageEnrollment(lastStepOrder: number, contactOverrides: Row = {}): Row {
    return {
      id: "due-message",
      cohortId: "cohort-1",
      enrolledAt: MIDNIGHT_LA,
      lastStepOrder,
      nextRunAt: MIDNIGHT_LA,
      contact: contact({
        name: "Ann Lee",
        unsubscribeToken: "tok-1",
        phone: "+14155550100",
        smsMarketingConsentAt: null,
        smsTransactionalConsentAt: NOW,
        smsOptOutAt: null,
        ...contactOverrides,
      }),
      campaign: {
        ...activeCampaign("COHORT_MESSAGE"),
        timezone: "America/Los_Angeles",
        steps: [EMAIL_STEP, SMS_STEP],
      },
    };
  }

  function lastEnrollmentData(): Row {
    const call = enrollmentUpdate.mock.calls.at(-1)?.[0] as Row | undefined;
    return (call?.data ?? {}) as Row;
  }

  it("SC-8: a course email opt-out skips only the EMAIL step and moves on to SMS", async () => {
    const { runDueSteps } = await import("@/lib/drip/engine");
    cohortRecord = COHORT;
    dueEnrollments = [messageEnrollment(0, { courseEmailOptOutAt: NOW })];

    await runDueSteps(MIDNIGHT_LA, 5);

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(sendCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stepId: "step-email",
        status: "SKIPPED",
        error: "course_email_opt_out",
      }),
      select: { id: true },
    });
    expect(lastEnrollmentData()).toMatchObject({ lastStepOrder: 1 });
    expect(lastEnrollmentData().status).toBeUndefined();
  });

  it("SC-9: the SMS step goes out on transactional consent even with course email off", async () => {
    const { runDueSteps } = await import("@/lib/drip/engine");
    cohortRecord = COHORT;
    const noon = new Date("2026-10-06T19:00:00.000Z");
    dueEnrollments = [
      { ...messageEnrollment(1, { courseEmailOptOutAt: NOW }), nextRunAt: noon },
    ];

    await runDueSteps(noon, 5);

    expect(sendContactSmsMock).toHaveBeenCalledTimes(1);
    expect(sendContactSmsMock.mock.calls[0]?.[0]).toMatchObject({
      contactId: "contact-1",
      purpose: "transactional",
      body: `${brand.smsSenderPrefix}Hi Ann, room B tonight. Reply STOP to opt out.`,
      dripSendId: "send-1",
    });
  });

  it("SC-9: without transactional consent the SMS step is SKIPPED with the reason, never force-sent", async () => {
    const { runDueSteps } = await import("@/lib/drip/engine");
    cohortRecord = COHORT;
    const noon = new Date("2026-10-06T19:00:00.000Z");
    dueEnrollments = [
      {
        ...messageEnrollment(1, {
          smsMarketingConsentAt: NOW,
          smsTransactionalConsentAt: null,
        }),
        nextRunAt: noon,
      },
    ];

    await runDueSteps(noon, 5);

    expect(sendContactSmsMock).not.toHaveBeenCalled();
    expect(sendUpdate).toHaveBeenCalledWith({
      where: { id: "send-1" },
      data: { status: "SKIPPED", error: "no_sms_transactional_consent" },
    });
  });

  it("SC-10: email sends at midnight (all-day window) with course footer and course merge fields", async () => {
    const { runDueSteps, campaignUsesAllDaySendWindow } = await import("@/lib/drip/engine");
    expect(campaignUsesAllDaySendWindow("COHORT_MESSAGE")).toBe(true);
    cohortRecord = COHORT;
    dueEnrollments = [messageEnrollment(0, { unsubscribedAt: NOW })];

    await runDueSteps(MIDNIGHT_LA, 5);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0]?.[0] as Row;
    expect(mail.subject).toBe("Update for Fall 2026");
    expect(String(mail.html)).toContain("Hi Ann, room B tonight.");
    expect(String(mail.html)).toContain(
      `You're receiving this because you're enrolled in Fall 2026 at ${brand.wordmark}.`
    );
    expect(String(mail.html)).toContain("Stop course update emails");
    expect(String((mail.headers as Row)["List-Unsubscribe"])).toContain("scope=course");
    // The following SMS step is scheduled into the SMS window, never at midnight.
    const next = lastEnrollmentData();
    expect(next.lastStepOrder).toBe(1);
    expect((next.nextRunAt as Date).toISOString()).toBe("2026-10-06T16:00:00.000Z");
  });

  it("SC-10: an SMS step due at night is deferred to the SMS window, never sent early", async () => {
    const { runDueSteps } = await import("@/lib/drip/engine");
    cohortRecord = COHORT;
    dueEnrollments = [messageEnrollment(1)];

    await runDueSteps(MIDNIGHT_LA, 5);

    expect(sendCreate).not.toHaveBeenCalled();
    expect(sendContactSmsMock).not.toHaveBeenCalled();
    expect(lastEnrollmentData()).toEqual({
      nextRunAt: new Date("2026-10-06T16:00:00.000Z"),
    });
  });
});
