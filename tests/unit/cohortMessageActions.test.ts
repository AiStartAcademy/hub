import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type SessionState = {
  user: { id: string; role: string; roles: string[] };
} | null;

let session: SessionState = null;

const realAuth = { ...(await import("@/lib/auth")) };
mock.module("@/lib/auth", () => ({ ...realAuth, auth: async () => session }));

const realSend = { ...(await import("@/lib/cohortMessages/send")) };
let actionSendMocksActive = true;
const previewMock = mock(
  async (
    input: Parameters<typeof realSend.previewCohortMessage>[0]
  ): ReturnType<typeof realSend.previewCohortMessage> =>
    actionSendMocksActive
      ? {
          ok: true,
          total: 3,
          email: 3,
          sms: 2,
          smsEnabled: true,
          emailMissing: [],
          smsMissing: [{ name: "No Phone", reason: "Missing phone" }],
        }
      : realSend.previewCohortMessage(input)
);
const sendMock = mock(
  async (
    input: Parameters<typeof realSend.sendCohortMessage>[0]
  ): ReturnType<typeof realSend.sendCohortMessage> =>
    actionSendMocksActive
      ? {
          ok: true,
          campaignId: "campaign-1",
          enrolled: 3,
          duplicate: false,
        }
      : realSend.sendCohortMessage(input)
);
mock.module("@/lib/cohortMessages/send", () => ({
  ...realSend,
  previewCohortMessage: previewMock,
  sendCohortMessage: sendMock,
}));

const realCache = { ...(await import("next/cache")) };
const revalidatePathMock = mock((path: string) => {
  void path;
});
mock.module("next/cache", () => ({ ...realCache, revalidatePath: revalidatePathMock }));

const { previewCohortMessageAction, sendCohortMessageAction } = await import(
  "@/app/(dashboard)/admin/cohorts/[id]/messages/actions"
);

const validInput = () => ({
  cohortId: "cohort-1",
  subject: "Schedule update",
  emailBody: "Hello & team: https://example.com/path?a=1&b=2\n\nSee you soon.",
  smsBody: "Class starts at {nextSessionDate}",
  sendAt: "2026-10-07T18:30:00.000Z",
  includeInstructors: true,
  logisticsConfirmed: true,
  idempotencyKey: "cohort-1-message-1",
});

beforeEach(() => {
  session = { user: { id: "admin-1", role: "ADMIN", roles: ["ADMIN"] } };
  previewMock.mockClear();
  sendMock.mockClear();
  revalidatePathMock.mockClear();
});

afterAll(() => {
  actionSendMocksActive = false;
  mock.module("@/lib/auth", () => ({ ...realAuth }));
  mock.module("@/lib/cohortMessages/send", () => ({ ...realSend }));
  mock.module("next/cache", () => ({ ...realCache }));
  mock.restore();
});

describe("cohort message server actions", () => {
  it("SC-15: rejects a student before previewing or sending", async () => {
    session = { user: { id: "student-1", role: "STUDENT", roles: ["STUDENT"] } };

    expect(
      await previewCohortMessageAction({ cohortId: "cohort-1", includeInstructors: false })
    ).toEqual({ ok: false, reason: "Unauthorized" });
    expect(await sendCohortMessageAction(validInput())).toEqual({
      ok: false,
      reason: "Unauthorized",
    });
    expect(previewMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("SC-15: rejects an instructor before previewing or sending", async () => {
    session = {
      user: { id: "instructor-1", role: "INSTRUCTOR", roles: ["INSTRUCTOR"] },
    };

    expect(
      await previewCohortMessageAction({ cohortId: "cohort-1", includeInstructors: true })
    ).toEqual({ ok: false, reason: "Unauthorized" });
    expect(await sendCohortMessageAction(validInput())).toEqual({
      ok: false,
      reason: "Unauthorized",
    });
    expect(previewMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("SC-15: rejects a missing session before previewing or sending", async () => {
    session = null;

    expect(
      await previewCohortMessageAction({ cohortId: "cohort-1", includeInstructors: false })
    ).toEqual({ ok: false, reason: "Unauthorized" });
    expect(await sendCohortMessageAction(validInput())).toEqual({
      ok: false,
      reason: "Unauthorized",
    });
    expect(previewMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("SC-15: lets an admin preview through with the validated audience options", async () => {
    const result = await previewCohortMessageAction({
      cohortId: " cohort-1 ",
      includeInstructors: true,
    });

    expect(result).toEqual({
      ok: true,
      total: 3,
      email: 3,
      sms: 2,
      smsEnabled: true,
      emailMissing: [],
      smsMissing: [{ name: "No Phone", reason: "Missing phone" }],
    });
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledWith({
      cohortId: "cohort-1",
      includeInstructors: true,
    });
  });

  it("SC-15: lets a team member preview through", async () => {
    session = {
      user: { id: "team-1", role: "TEAM_MEMBER", roles: ["TEAM_MEMBER"] },
    };

    expect(
      await previewCohortMessageAction({ cohortId: "cohort-1", includeInstructors: false })
    ).toMatchObject({ ok: true });
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  it("SC-15: sends as the session user with converted HTML and revalidates on success", async () => {
    const result = await sendCohortMessageAction(validInput());

    expect(result).toEqual({
      ok: true,
      campaignId: "campaign-1",
      enrolled: 3,
      duplicate: false,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      cohortId: "cohort-1",
      subject: "Schedule update",
      emailBody:
        '<p>Hello &amp; team: <a href="https://example.com/path?a=1&amp;b=2">https://example.com/path?a=1&amp;b=2</a></p><p>See you soon.</p>',
      smsBody: "Class starts at {nextSessionDate}",
      sendAt: new Date("2026-10-07T18:30:00.000Z"),
      includeInstructors: true,
      logisticsConfirmed: true,
      idempotencyKey: "cohort-1-message-1",
      sentByUserId: "admin-1",
    });
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/cohorts/cohort-1/messages");
  });

  it("SC-15: returns contextual validation errors without calling send", async () => {
    const invalidCases: Array<[unknown, string]> = [
      [null, "Invalid cohort message input"],
      [{ ...validInput(), cohortId: "  " }, "cohortId is required"],
      [{ ...validInput(), subject: "" }, "Subject is required"],
      [{ ...validInput(), emailBody: " \n " }, "Email body is required"],
      [{ ...validInput(), smsBody: 42 }, "smsBody must be a string or null"],
      [{ ...validInput(), sendAt: 42 }, "sendAt must be an ISO date string or null"],
      [{ ...validInput(), sendAt: "not-a-date" }, "sendAt is not a valid date"],
      [{ ...validInput(), includeInstructors: "yes" }, "includeInstructors must be a boolean"],
      [{ ...validInput(), logisticsConfirmed: 1 }, "logisticsConfirmed must be a boolean"],
      [{ ...validInput(), idempotencyKey: "" }, "Missing idempotency key"],
      [
        { ...validInput(), idempotencyKey: "x".repeat(201) },
        "Idempotency key must be 200 characters or fewer",
      ],
    ];

    for (const [input, reason] of invalidCases) {
      expect(await sendCohortMessageAction(input)).toEqual({ ok: false, reason });
    }
    expect(sendMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("SC-15: validates preview input without calling preview", async () => {
    expect(await previewCohortMessageAction(null)).toEqual({
      ok: false,
      reason: "Invalid preview input",
    });
    expect(
      await previewCohortMessageAction({ cohortId: "", includeInstructors: false })
    ).toEqual({ ok: false, reason: "cohortId is required" });
    expect(
      await previewCohortMessageAction({ cohortId: "cohort-1", includeInstructors: "yes" })
    ).toEqual({ ok: false, reason: "includeInstructors must be a boolean" });
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("SC-15: does not revalidate when send returns an error", async () => {
    sendMock.mockImplementationOnce(async () => ({ ok: false, reason: "Cohort not found" }));

    expect(await sendCohortMessageAction(validInput())).toEqual({
      ok: false,
      reason: "Cohort not found",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("SC-15: propagates unexpected preview failures", async () => {
    previewMock.mockImplementationOnce(async () => {
      throw new Error("audience unavailable");
    });

    expect(
      previewCohortMessageAction({ cohortId: "cohort-1", includeInstructors: false })
    ).rejects.toThrow("audience unavailable");
  });

  it("SC-15: propagates unexpected send failures without revalidating", async () => {
    sendMock.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    expect(sendCohortMessageAction(validInput())).rejects.toThrow("database unavailable");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
