import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

const contactFindUnique = mock(async (args: { select?: { unsubscribeToken?: boolean } }) =>
  args.select?.unsubscribeToken
    ? { unsubscribeToken: "unsubscribe-token" }
    : {
        id: "contact-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        unsubscribedAt: null,
      }
);
const contactUpdate = mock(async () => ({ unsubscribeToken: "unsubscribe-token" }));
const emailEventCreate = mock(async () => ({ id: "event-1" }));
const emailEventUpdate = mock(async () => ({ id: "event-1" }));
const dripEnrollmentFindMany = mock(async () => [] as Array<Record<string, unknown>>);
const dripEnrollmentUpdate = mock(async () => ({}));
const dripSendCreate = mock(async () => ({ id: "drip-send-1" }));
const dripSendUpdateMany = mock(async () => ({ count: 1 }));

const prismaMock = {
  contact: { findUnique: contactFindUnique, update: contactUpdate },
  emailEvent: { create: emailEventCreate, update: emailEventUpdate },
  dripEnrollment: { findMany: dripEnrollmentFindMany, update: dripEnrollmentUpdate },
  dripSend: { create: dripSendCreate, updateMany: dripSendUpdateMany },
  secret: { findUnique: mock(async () => null) },
};

const sendMail = mock(async () => ({}));

// mock.module is process-wide and modules that already imported @/lib/mail keep
// the mocked bindings, so spread the real module (real escapeHtml) and put it
// back afterwards — an identity escapeHtml here broke escaping tests elsewhere.
const realMail = await import("@/lib/mail");
mock.module("@/lib/prisma", () => ({ default: prismaMock }));
mock.module("@/lib/mail", () => ({
  ...realMail,
  fromHeader: (mailbox?: string) => mailbox ?? `${brand.shortName} <hello@example.com>`,
  sendMail,
}));

const { sendOneOffEmail } = await import("@/lib/outreach/email");
const { runDueSteps } = await import("@/lib/drip/engine");

const oneOffInput = {
  contactId: "contact-1",
  subject: "Hello {{first_name}}",
  html: "<p>Welcome, {{first_name}}.</p>",
  staffId: "staff-1",
};

function dueEmailEnrollment() {
  return {
    id: "enrollment-1",
    cohortId: null,
    enrolledAt: new Date("2026-09-01T12:00:00.000Z"),
    lastStepOrder: 0,
    contact: {
      id: "contact-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: null,
      status: "NEW",
      tags: null,
      unsubscribedAt: null,
    },
    campaign: {
      id: "campaign-1",
      name: "Welcome",
      slug: "welcome",
      status: "ACTIVE",
      trigger: "LEAD_CREATED",
      exitOnStatuses: null,
      sendWindowStartHour: 0,
      sendWindowEndHour: 24,
      timezone: "UTC",
      steps: [
        {
          id: "step-1",
          order: 1,
          channel: "EMAIL",
          subject: "Welcome {{first_name}}",
          body: "<p>Drip body for {{first_name}}</p>",
          ctaText: null,
          ctaUrl: null,
          delayHours: 0,
          anchor: null,
        },
      ],
    },
  };
}

beforeEach(() => {
  contactFindUnique.mockClear();
  contactUpdate.mockClear();
  emailEventCreate.mockClear();
  emailEventUpdate.mockClear();
  dripEnrollmentFindMany.mockClear();
  dripEnrollmentFindMany.mockResolvedValue([]);
  dripEnrollmentUpdate.mockClear();
  dripSendCreate.mockClear();
  dripSendUpdateMany.mockClear();
  sendMail.mockClear();
  sendMail.mockResolvedValue({});
});

afterAll(() => {
  mock.restore();
  mock.module("@/lib/mail", () => realMail);
});

describe("outreach email event bodies", () => {
  it("SC2.7: persists the exact rendered HTML handed to sendMail", async () => {
    const result = await sendOneOffEmail(oneOffInput);

    expect(result).toEqual({ ok: true, emailEventId: "event-1" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sentHtml = sendMail.mock.calls[0]?.[0]?.html;
    expect(sentHtml).toBeString();
    expect(emailEventUpdate).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { subject: "Hello Ada", bodyHtml: sentHtml },
    });
  });

  it("SC2.8: marks the event FAILED with error metadata without throwing", async () => {
    sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    const result = await sendOneOffEmail(oneOffInput);

    expect(result).toEqual({ ok: false, error: "Email could not be sent: SMTP unavailable" });
    expect(emailEventUpdate).toHaveBeenLastCalledWith({
      where: { id: "event-1" },
      data: {
        type: "FAILED",
        subject: "Hello Ada",
        metadata: JSON.stringify({
          kind: "oneoff",
          staffId: "staff-1",
          error: "SMTP unavailable",
        }),
      },
    });
  });

  it("SC2.9: writes bodyHtml for SENT drip events and null when absent", async () => {
    dripEnrollmentFindMany.mockResolvedValue([dueEmailEnrollment()]);
    await runDueSteps(new Date("2026-09-01T12:00:00.000Z"), 1);

    const deliveredHtml = sendMail.mock.calls[0]?.[0]?.html;
    expect(deliveredHtml).toBeString();
    expect(emailEventCreate).toHaveBeenLastCalledWith({
      data: {
        contactId: "contact-1",
        dripSendId: "drip-send-1",
        type: "SENT",
        subject: "Welcome Ada",
        url: null,
        bodyHtml: deliveredHtml,
        metadata: null,
      },
    });

    emailEventCreate.mockClear();
    sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await runDueSteps(new Date("2026-09-01T12:00:00.000Z"), 1);

    expect(emailEventCreate).toHaveBeenLastCalledWith({
      data: {
        contactId: "contact-1",
        dripSendId: "drip-send-1",
        type: "FAILED",
        subject: "Welcome Ada",
        url: null,
        bodyHtml: null,
        metadata: JSON.stringify({ error: "SMTP unavailable" }),
      },
    });
  });
});

describe("nurture mail carries one-click unsubscribe headers", () => {
  it("SC3.1: drip runDueSteps sends List-Unsubscribe + List-Unsubscribe-Post", async () => {
    dripEnrollmentFindMany.mockResolvedValue([dueEmailEnrollment()]);
    await runDueSteps(new Date("2026-09-01T12:00:00.000Z"), 1);

    const headers = sendMail.mock.calls[0]?.[0]?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers!["List-Unsubscribe"]).toContain(
      `mailto:${brand.email.contact}?subject=unsubscribe`
    );
    // The real contact token, not the fake one the campaign test-send uses.
    expect(headers!["List-Unsubscribe"]).toContain("/api/unsubscribe?token=unsubscribe-token");
    expect(headers!["List-Unsubscribe"]).not.toContain("test-send-not-a-real-token");
  });

  it("SC3.2: outreach sendOneOffEmail sends the same headers", async () => {
    const result = await sendOneOffEmail(oneOffInput);

    expect(result).toEqual({ ok: true, emailEventId: "event-1" });
    const headers = sendMail.mock.calls[0]?.[0]?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    expect(headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers!["List-Unsubscribe"]).toContain("/api/unsubscribe?token=unsubscribe-token");
  });
});
