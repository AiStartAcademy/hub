import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

const NOW = new Date("2026-10-06T18:00:00.000Z");
const SEND_AT = new Date("2026-10-07T16:00:00.000Z");

let cohortRow: Row | null;
let enrollmentRows: Row[];
let contacts: Map<string, Row>;
let campaignsByKey: Map<string, Row>;
let smsFlag: string | null;
let failNextCampaignCreateWithP2002: boolean;
const calls = {
  campaignCreate: [] as Row[],
  enrollmentCreate: [] as Row[],
  enrollmentFindFirst: [] as Row[],
  sendCreate: [] as Row[],
  contactUpsert: [] as Row[],
  contactUpdate: [] as Row[],
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function contactRow(email: string, overrides: Row = {}): Row {
  return {
    id: `contact-${email}`,
    email,
    name: null,
    tags: "[]",
    unsubscribedAt: null,
    courseEmailOptOutAt: null,
    phone: "+14155550100",
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: NOW,
    smsOptOutAt: null,
    ...overrides,
  };
}

function enrollment(id: string, email: string, name: string): Row {
  return { id, status: "active", user: { email, name, role: "STUDENT", roles: "[]" } };
}

const prismaMock = {
  cohort: { findUnique: async () => cohortRow },
  enrollment: {
    findMany: async (args: Row) => (args.cursor ? [] : enrollmentRows),
  },
  contact: {
    findMany: async (args: Row) => {
      const wanted = new Set(
        ((args.where as { email: { in: string[] } }).email.in ?? []).map(normalized)
      );
      return [...contacts.values()].filter((row) => wanted.has(normalized(row.email)));
    },
    findUnique: async (args: Row) =>
      contacts.get(normalized((args.where as { email: string }).email)) ?? null,
    upsert: async (args: Row) => {
      calls.contactUpsert.push(args);
      const email = normalized((args.where as { email: string }).email);
      const created = contacts.get(email) ?? contactRow(email, { id: `created-${email}` });
      contacts.set(email, created);
      return created;
    },
    update: async (args: Row) => {
      calls.contactUpdate.push(args);
      return args;
    },
  },
  dripCampaign: {
    findUnique: async (args: Row) => {
      const where = args.where as { idempotencyKey?: string };
      const row = where.idempotencyKey ? campaignsByKey.get(where.idempotencyKey) : undefined;
      return row ? { ...row, _count: { enrollments: row.enrolledCount } } : null;
    },
    create: async (args: Row) => {
      calls.campaignCreate.push(args);
      const data = args.data as Row;
      if (failNextCampaignCreateWithP2002) {
        failNextCampaignCreateWithP2002 = false;
        // A concurrent request won the race and committed first.
        campaignsByKey.set(String(data.idempotencyKey), {
          id: "campaign-raced",
          idempotencyKey: data.idempotencyKey,
          enrolledCount: 2,
        });
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = { id: `campaign-${calls.campaignCreate.length}`, ...data, enrolledCount: 0 };
      campaignsByKey.set(String(data.idempotencyKey), row);
      return { id: row.id };
    },
  },
  dripEnrollment: {
    create: async (args: Row) => {
      calls.enrollmentCreate.push(args);
      const data = args.data as Row;
      for (const row of campaignsByKey.values()) {
        if (row.id === data.campaignId) row.enrolledCount = Number(row.enrolledCount) + 1;
      }
      return { id: `enrollment-${calls.enrollmentCreate.length}` };
    },
    findFirst: async (args: Row) => {
      calls.enrollmentFindFirst.push(args);
      // The contact is busy in a lead nurture — this must not block a cohort message.
      return { id: "lead-enrollment", campaignId: "nurture", status: "ACTIVE" };
    },
  },
  dripSend: {
    create: async (args: Row) => {
      calls.sendCreate.push(args);
      return { id: "send" };
    },
  },
  secret: {
    findUnique: async (args: Row) => {
      const key = (args.where as { key: string }).key;
      if (key !== "SMS_TRANSACTIONAL_ENABLED" || smsFlag === null) return null;
      return { key, kind: "config", valuePlain: smsFlag };
    },
  },
  $transaction: async (operation: unknown) => {
    if (typeof operation === "function") return operation(prismaMock);
    return Promise.all(operation as Array<Promise<unknown>>);
  },
};

const realPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({ ...realPrisma, default: prismaMock }));
afterAll(() => {
  mock.module("@/lib/prisma", () => realPrisma);
});

const { previewCohortMessage, sendCohortMessage } = await import("@/lib/cohortMessages/send");
const { bustSecretCache } = await import("@/lib/secrets");

function baseInput(overrides: Row = {}) {
  return {
    cohortId: "cohort-1",
    subject: "Room change for {cohortName}",
    emailBody: "<p>Hi {firstName}, class moves to room B.</p>",
    smsBody: "Hi {firstName}, class moves to room B.",
    includeInstructors: false,
    logisticsConfirmed: true,
    idempotencyKey: "key-1",
    sentByUserId: "admin-1",
    now: NOW,
    ...overrides,
  } as Parameters<typeof sendCohortMessage>[0];
}

function stepsOf(createArgs: Row | undefined): Row[] {
  return (((createArgs?.data as Row).steps as Row).create ?? []) as Row[];
}

beforeEach(() => {
  delete process.env.SMS_TRANSACTIONAL_ENABLED;
  bustSecretCache("SMS_TRANSACTIONAL_ENABLED");
  cohortRow = {
    id: "cohort-1",
    slug: "fall-2026",
    title: "Fall 2026",
    zoomLink: "https://zoom.us/j/1",
    timezone: "America/Los_Angeles",
    instructors: [],
    sessions: [],
  };
  enrollmentRows = [
    enrollment("e1", "ann@example.com", "Ann Lee"),
    enrollment("e2", "bob@example.com", "Bob Stone"),
    enrollment("e3", "cat@example.com", "Cat Moss"),
  ];
  contacts = new Map([
    ["ann@example.com", contactRow("ann@example.com")],
    [
      "bob@example.com",
      contactRow("bob@example.com", {
        smsTransactionalConsentAt: null,
        smsMarketingConsentAt: NOW,
      }),
    ],
    ["cat@example.com", contactRow("cat@example.com", { courseEmailOptOutAt: NOW })],
  ]);
  campaignsByKey = new Map();
  smsFlag = "true";
  failNextCampaignCreateWithP2002 = false;
  for (const list of Object.values(calls)) list.length = 0;
});

describe("previewCohortMessage", () => {
  it("SC-5: returns channel counts and named missing recipients without writing anything", async () => {
    enrollmentRows.push(enrollment("e4", "new@example.com", "New Person"));

    const preview = await previewCohortMessage({
      cohortId: "cohort-1",
      includeInstructors: false,
      now: NOW,
    });

    expect(preview).toEqual({
      ok: true,
      total: 4,
      email: 3,
      sms: 2,
      smsEnabled: true,
      emailMissing: [{ name: "Cat Moss", reason: "course_email_opt_out" }],
      smsMissing: [
        { name: "Bob Stone", reason: "no_sms_transactional_consent" },
        { name: "New Person", reason: "no_sms_transactional_consent" },
      ],
    });
    expect(calls.campaignCreate).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.sendCreate).toHaveLength(0);
    expect(calls.contactUpsert).toHaveLength(0);
    expect(calls.contactUpdate).toHaveLength(0);
  });

  it("SC-5: reports an unknown cohort instead of throwing", async () => {
    cohortRow = null;
    expect(
      await previewCohortMessage({ cohortId: "nope", includeInstructors: false, now: NOW })
    ).toEqual({ ok: false, reason: "Cohort not found" });
  });
});

describe("sendCohortMessage", () => {
  it("SC-6: creates one COHORT_MESSAGE campaign with EMAIL + SMS steps and one enrollment per recipient", async () => {
    const result = await sendCohortMessage(baseInput());

    expect(result).toEqual({
      ok: true,
      campaignId: "campaign-1",
      enrolled: 3,
      duplicate: false,
    });
    expect(calls.campaignCreate).toHaveLength(1);
    const data = calls.campaignCreate[0]?.data as Row;
    expect(data).toMatchObject({
      trigger: "COHORT_MESSAGE",
      status: "ACTIVE",
      autoEnroll: false,
      cohortId: "cohort-1",
      exitOnStatuses: "[]",
      idempotencyKey: "key-1",
      segment: JSON.stringify({ cohorts: ["cohort-1"] }),
      sentAt: NOW,
      sendWindowStartHour: 0,
      sendWindowEndHour: 24,
      skipWeekends: false,
    });
    expect(String(data.name)).toBe("Cohort message — Fall 2026 — 2026-10-06");
    expect(String(data.slug)).toMatch(/^cohort-message-fall-2026-/);
    const snapshot = JSON.parse(String(data.audienceSnapshot));
    expect(snapshot).toMatchObject({
      sentByUserId: "admin-1",
      includeInstructors: false,
      total: 3,
      email: 2,
      sms: 2,
      sendAt: null,
    });

    expect(stepsOf(calls.campaignCreate[0])).toEqual([
      expect.objectContaining({
        order: 1,
        channel: "EMAIL",
        delayHours: 0,
        subject: "Room change for {cohortName}",
        body: "<p>Hi {firstName}, class moves to room B.</p>",
      }),
      expect.objectContaining({
        order: 2,
        channel: "SMS",
        delayHours: 0,
        body: "Hi {firstName}, class moves to room B.",
      }),
    ]);

    expect(calls.enrollmentCreate).toHaveLength(3);
    for (const args of calls.enrollmentCreate) {
      expect(args.data).toMatchObject({
        campaignId: "campaign-1",
        cohortId: "cohort-1",
        status: "ACTIVE",
        lastStepOrder: 0,
        enrolledAt: NOW,
        nextRunAt: NOW,
      });
    }
    // Delivery is tick()'s job: nothing is sent here.
    expect(calls.sendCreate).toHaveLength(0);
  });

  it("SC-6: a scheduled send queues every enrollment at sendAt", async () => {
    await sendCohortMessage(baseInput({ sendAt: SEND_AT }));
    for (const args of calls.enrollmentCreate) {
      expect((args.data as Row).nextRunAt).toEqual(SEND_AT);
    }
    const snapshot = JSON.parse(String((calls.campaignCreate[0]?.data as Row).audienceSnapshot));
    expect(snapshot.sendAt).toBe(SEND_AT.toISOString());
  });

  it("SC-6: cohort messages are exempt from the one-active-campaign-per-lead rule", async () => {
    // findFirst reports every contact as busy in a lead nurture; send must not consult it.
    const result = await sendCohortMessage(baseInput());
    expect(result).toMatchObject({ ok: true, enrolled: 3 });
    expect(calls.enrollmentFindFirst).toHaveLength(0);
  });

  it("SC-6: rejects invalid input before writing anything", async () => {
    const cases: Array<[Row, string]> = [
      [{ logisticsConfirmed: false }, "logistics"],
      [{ subject: "   " }, "Subject"],
      [{ emailBody: "" }, "body"],
      [{ idempotencyKey: " " }, "idempotency"],
      [{ smsBody: "Class moved 🎉" }, "GSM-7"],
      [{ smsBody: "x".repeat(400) }, "320"],
      [{ sendAt: new Date("not a date") }, "sendAt"],
    ];
    for (const [overrides, fragment] of cases) {
      const result = await sendCohortMessage(baseInput(overrides));
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.reason).toContain(fragment);
    }
    expect(calls.campaignCreate).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
  });

  it("SC-6: refuses a cohort with no one to message", async () => {
    enrollmentRows = [];
    expect(await sendCohortMessage(baseInput())).toEqual({
      ok: false,
      reason: "Cohort has no recipients",
    });
    expect(calls.campaignCreate).toHaveLength(0);
  });

  it("SC-7: the same idempotency key creates one campaign and one enrollment per contact", async () => {
    const first = await sendCohortMessage(baseInput());
    const second = await sendCohortMessage(baseInput());

    expect(first).toMatchObject({ ok: true, campaignId: "campaign-1", duplicate: false });
    expect(second).toEqual({ ok: true, campaignId: "campaign-1", enrolled: 3, duplicate: true });
    expect(calls.campaignCreate).toHaveLength(1);
    expect(calls.enrollmentCreate).toHaveLength(3);
  });

  it("SC-7: a concurrent duplicate that loses the unique-key race returns the winner", async () => {
    failNextCampaignCreateWithP2002 = true;
    expect(await sendCohortMessage(baseInput())).toEqual({
      ok: true,
      campaignId: "campaign-raced",
      enrolled: 2,
      duplicate: true,
    });
    expect(calls.enrollmentCreate).toHaveLength(0);
  });

  it("SC-11: with SMS_TRANSACTIONAL_ENABLED off, no SMS step is created and the result says so", async () => {
    for (const flag of [null, "false", "", "yes"]) {
      smsFlag = flag;
      bustSecretCache("SMS_TRANSACTIONAL_ENABLED");
      calls.campaignCreate.length = 0;
      const result = await sendCohortMessage(baseInput({ idempotencyKey: `off-${flag}` }));
      expect(result).toMatchObject({ ok: true, smsSkipped: "disabled" });
      expect(stepsOf(calls.campaignCreate[0]).map((step) => step.channel)).toEqual(["EMAIL"]);
    }

    smsFlag = " TRUE ";
    bustSecretCache("SMS_TRANSACTIONAL_ENABLED");
    calls.campaignCreate.length = 0;
    const enabled = await sendCohortMessage(baseInput({ idempotencyKey: "on" }));
    expect(enabled).not.toHaveProperty("smsSkipped");
    expect(stepsOf(calls.campaignCreate[0]).map((step) => step.channel)).toEqual(["EMAIL", "SMS"]);
  });

  it("SC-11: without an SMS body there is no SMS step and nothing to report as skipped", async () => {
    const result = await sendCohortMessage(baseInput({ smsBody: undefined }));
    expect(result).not.toHaveProperty("smsSkipped");
    expect(stepsOf(calls.campaignCreate[0]).map((step) => step.channel)).toEqual(["EMAIL"]);
  });

  it("SC-14: the campaign stores the logistics-only confirmation time", async () => {
    await sendCohortMessage(baseInput());
    expect((calls.campaignCreate[0]?.data as Row).logisticsConfirmedAt).toEqual(NOW);
  });
});

describe("SMS_TRANSACTIONAL_ENABLED registration", () => {
  it("SC-11: the flag is a registered comms config key with a blank .env.example placeholder", async () => {
    const { KNOWN_INTEGRATION_KEYS } = await import(
      "@/app/(dashboard)/admin/integrations/knownKeys"
    );
    const entry = KNOWN_INTEGRATION_KEYS.find((e) => e.key === "SMS_TRANSACTIONAL_ENABLED");
    expect(entry).toMatchObject({ category: "comms", kind: "config", example: "true" });

    const envExample = await Bun.file(`${import.meta.dir}/../../.env.example`).text();
    expect(envExample).toMatch(/^SMS_TRANSACTIONAL_ENABLED=""$/m);
  });
});
