import { beforeEach, describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

type Row = Record<string, unknown>;

const COURSE_TRIGGERS = [
  "COHORT_SCHEDULE",
  "COHORT_MESSAGE",
  "CERTIFICATE_ISSUED",
] as const;

let contactRecord: Row | null;

const contactFindUnique = mock(async (_args: Row) => contactRecord);
const contactUpdate = mock(async (args: Row) => ({
  ...(contactRecord ?? {}),
  ...((args.data ?? {}) as Row),
}));
const enrollmentUpdateMany = mock(async (_args: Row) => ({ count: 1 }));
const dripSendFindFirst = mock(async (_args: Row) => null);
const emailEventCreate = mock(async (_args: Row) => ({ id: "event-1" }));

const prismaMock = {
  contact: {
    findUnique: contactFindUnique,
    update: contactUpdate,
  },
  dripEnrollment: {
    updateMany: enrollmentUpdateMany,
  },
  dripSend: {
    findFirst: dripSendFindFirst,
  },
  emailEvent: {
    create: emailEventCreate,
  },
  $transaction: async (operation: unknown) => {
    if (typeof operation === "function") return operation(prismaMock);
    return Promise.all(operation as Array<Promise<unknown>>);
  },
};

mock.module("@/lib/prisma", () => ({ default: prismaMock }));

beforeEach(() => {
  contactRecord = {
    id: "contact-1",
    email: "learner@example.com",
    unsubscribedAt: null,
    courseEmailOptOutAt: null,
  };
  contactFindUnique.mockClear();
  contactUpdate.mockClear();
  enrollmentUpdateMany.mockClear();
  dripSendFindFirst.mockClear();
  emailEventCreate.mockClear();
});

describe("email scope", () => {
  it("SC-3: resolves the opt-out reason and campaign scope independently", async () => {
    const { emailScopeForCampaignTrigger, emailScopeReason } = await import(
      "@/lib/drip/emailScope"
    );
    const unsubscribedAt = new Date("2026-10-01T00:00:00.000Z");
    const courseEmailOptOutAt = new Date("2026-10-02T00:00:00.000Z");

    expect(
      emailScopeReason({ unsubscribedAt: null, courseEmailOptOutAt: null }, "marketing")
    ).toBeNull();
    expect(
      emailScopeReason({ unsubscribedAt: null, courseEmailOptOutAt: null }, "course")
    ).toBeNull();
    expect(
      emailScopeReason({ unsubscribedAt, courseEmailOptOutAt: null }, "marketing")
    ).toBe("unsubscribed");
    expect(
      emailScopeReason({ unsubscribedAt, courseEmailOptOutAt: null }, "course")
    ).toBeNull();
    expect(
      emailScopeReason({ unsubscribedAt: null, courseEmailOptOutAt }, "marketing")
    ).toBeNull();
    expect(
      emailScopeReason({ unsubscribedAt: null, courseEmailOptOutAt }, "course")
    ).toBe("course_email_opt_out");
    expect(emailScopeReason({ unsubscribedAt, courseEmailOptOutAt }, "marketing")).toBe(
      "unsubscribed"
    );
    expect(emailScopeReason({ unsubscribedAt, courseEmailOptOutAt }, "course")).toBe(
      "course_email_opt_out"
    );

    for (const trigger of COURSE_TRIGGERS) {
      expect(emailScopeForCampaignTrigger(trigger)).toBe("course");
    }
    for (const trigger of ["LEAD_SEGMENT", "BROADCAST", "MANUAL", ""]) {
      expect(emailScopeForCampaignTrigger(trigger)).toBe("marketing");
    }
  });
});

describe("scope-aware unsubscribe", () => {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    ""
  );

  it("SC-14: builds scoped footer URLs while preserving the marketing URL", async () => {
    const { courseUnsubscribeUrl, unsubscribeUrl } = await import("@/lib/drip/engine");

    expect(courseUnsubscribeUrl("a+b/c")).toBe(
      `${appUrl}/unsubscribe?token=a%2Bb%2Fc&scope=course`
    );
    expect(unsubscribeUrl("a+b/c")).toBe(`${appUrl}/unsubscribe?token=a%2Bb%2Fc`);
  });

  it("SC-14: scopes one-click headers only for course mail", async () => {
    const { unsubscribeHeaders } = await import("@/lib/drip/engine");
    const token = "a+b/c";
    const replyTo = brand.email.contact;
    const marketingHeaders = {
      "List-Unsubscribe": `<mailto:${replyTo}?subject=unsubscribe>, <${appUrl}/api/unsubscribe?token=a%2Bb%2Fc>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };

    const implicitMarketing = unsubscribeHeaders(token, replyTo);
    const explicitMarketing = unsubscribeHeaders(token, replyTo, "marketing");
    expect(implicitMarketing).toEqual(marketingHeaders);
    expect(explicitMarketing).toEqual(marketingHeaders);
    expect(JSON.stringify(explicitMarketing)).toBe(JSON.stringify(implicitMarketing));
    expect(unsubscribeHeaders(token, replyTo, "course")).toEqual({
      "List-Unsubscribe": `<mailto:${replyTo}?subject=unsubscribe>, <${appUrl}/api/unsubscribe?token=a%2Bb%2Fc&scope=course>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("SC-14: selects the footer URL from the campaign email scope", async () => {
    const { courseUnsubscribeUrl, emailUnsubscribeUrlForScope, unsubscribeUrl } = await import(
      "@/lib/drip/engine"
    );

    expect(emailUnsubscribeUrlForScope("a+b/c", "course")).toBe(
      courseUnsubscribeUrl("a+b/c")
    );
    expect(emailUnsubscribeUrlForScope("a+b/c", "marketing")).toBe(
      unsubscribeUrl("a+b/c")
    );
  });

  it("SC-14: course unsubscribe writes only the course opt-out and exits no enrollment", async () => {
    const { unsubscribeByToken } = await import("@/lib/drip/engine");

    const result = await unsubscribeByToken("course-token", "course");

    expect(result).toMatchObject({ ok: true, alreadyDone: false });
    const optOutWrite = contactUpdate.mock.calls.find(
      ([args]) => "courseEmailOptOutAt" in (((args as Row).data ?? {}) as Row)
    );
    expect(optOutWrite).toBeDefined();
    const optOutData = (((optOutWrite?.[0] as Row).data ?? {}) as Row);
    expect(optOutData.courseEmailOptOutAt).toBeInstanceOf(Date);
    expect("unsubscribedAt" in optOutData).toBe(false);
    // Course enrollments stay ACTIVE: the engine skips their EMAIL steps, and
    // their SMS steps still go to people with transactional SMS consent.
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
  });

  it("SC-14: repeated course unsubscribe is idempotent and writes nothing", async () => {
    const { unsubscribeByToken } = await import("@/lib/drip/engine");
    contactRecord = {
      ...contactRecord,
      courseEmailOptOutAt: new Date("2026-10-02T00:00:00.000Z"),
    };

    const result = await unsubscribeByToken("course-token", "course");

    expect(result).toMatchObject({ ok: true, alreadyDone: true });
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
    expect(dripSendFindFirst).not.toHaveBeenCalled();
    expect(emailEventCreate).not.toHaveBeenCalled();
  });

  it("SC-14: marketing opt-out does not make a course unsubscribe already done", async () => {
    const { unsubscribeByToken } = await import("@/lib/drip/engine");
    contactRecord = {
      ...contactRecord,
      unsubscribedAt: new Date("2026-10-01T00:00:00.000Z"),
      courseEmailOptOutAt: null,
    };

    const result = await unsubscribeByToken("course-token", "course");

    expect(result).toMatchObject({ ok: true, alreadyDone: false });
    expect(contactUpdate.mock.calls.some(([args]) =>
      "courseEmailOptOutAt" in (((args as Row).data ?? {}) as Row)
    )).toBe(true);
  });

  it("SC-14: default marketing unsubscribe preserves its write and exits only marketing campaigns", async () => {
    const { unsubscribeByToken } = await import("@/lib/drip/engine");

    const result = await unsubscribeByToken("marketing-token");

    expect(result).toMatchObject({ ok: true, alreadyDone: false });
    const optOutWrite = contactUpdate.mock.calls.find(
      ([args]) => "unsubscribedAt" in (((args as Row).data ?? {}) as Row)
    );
    expect(optOutWrite).toBeDefined();
    const optOutData = (((optOutWrite?.[0] as Row).data ?? {}) as Row);
    expect(optOutData.unsubscribedAt).toBeInstanceOf(Date);
    expect("courseEmailOptOutAt" in optOutData).toBe(false);
    expect(enrollmentUpdateMany).toHaveBeenCalledWith({
      where: {
        contactId: "contact-1",
        status: "ACTIVE",
        campaign: { trigger: { notIn: [...COURSE_TRIGGERS] } },
      },
      data: {
        status: "EXITED",
        exitedAt: expect.any(Date),
        exitReason: "unsubscribed",
        nextRunAt: null,
      },
    });
  });
});
