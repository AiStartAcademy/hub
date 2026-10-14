import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  buildHistoryRows,
  canSubmitCohortMessage,
  composerFingerprint,
  historySenderIds,
  insertAtCursor,
  sendConfirmMessage,
  smsCounter,
  wallTimeToIso,
} from "@/lib/cohortMessages/composerState";

const baseFingerprintInput = {
  subject: "Room change",
  emailBody: "Meet in room B",
  smsBody: "Room B today",
  includeInstructors: false,
  sendAt: "",
};

type SubmitInput = Parameters<typeof canSubmitCohortMessage>[0];

const baseSubmitInput: SubmitInput = {
  previewFingerprint: composerFingerprint(baseFingerprintInput),
  currentFingerprint: composerFingerprint(baseFingerprintInput),
  previewOk: true,
  logisticsConfirmed: true,
  pending: false,
  subject: baseFingerprintInput.subject,
  emailBody: baseFingerprintInput.emailBody,
  smsValidation: {
    enabled: true,
    hasText: true,
    ok: true,
    reason: null,
  },
};

describe("cohort message composer state", () => {
  it("SC-16: fingerprints every preview-sensitive composer field deterministically", () => {
    const fingerprint = composerFingerprint(baseFingerprintInput);
    expect(composerFingerprint({ ...baseFingerprintInput })).toBe(fingerprint);

    for (const changed of [
      { subject: "Different subject" },
      { emailBody: "Different email" },
      { smsBody: "Different text" },
      { includeInstructors: true },
      { sendAt: "2026-10-07T09:00" },
    ]) {
      expect(composerFingerprint({ ...baseFingerprintInput, ...changed })).not.toBe(
        fingerprint
      );
    }
  });

  it("SC-16: enables submit only after a current successful preview and logistics confirmation", () => {
    expect(canSubmitCohortMessage(baseSubmitInput)).toEqual({
      enabled: true,
      reason: null,
    });

    const disabledCases: Array<[
      Partial<SubmitInput>,
      string,
    ]> = [
      [{ previewFingerprint: null }, "Preview the audience"],
      [{ currentFingerprint: "stale" }, "changed since preview"],
      [{ previewOk: false }, "Preview must succeed"],
      [{ logisticsConfirmed: false }, "logistics update"],
      [{ pending: true }, "in progress"],
      [{ subject: "  " }, "Subject is required"],
      [{ emailBody: "\n" }, "Email body is required"],
      [
        {
          smsValidation: {
            enabled: true,
            hasText: true,
            ok: false,
            reason: "SMS exceeds 320",
          },
        },
        "SMS exceeds 320",
      ],
      [
        {
          scheduleValidation: {
            ok: false,
            reason: "That local time does not exist",
          },
        },
        "does not exist",
      ],
    ];

    for (const [overrides, reason] of disabledCases) {
      const result = canSubmitCohortMessage({ ...baseSubmitInput, ...overrides });
      expect(result.enabled).toBe(false);
      expect(result.reason).toContain(reason);
    }

    expect(
      canSubmitCohortMessage({
        ...baseSubmitInput,
        smsValidation: {
          enabled: false,
          hasText: true,
          ok: false,
          reason: "ignored while text is off",
        },
      })
    ).toEqual({ enabled: true, reason: null });
  });

  it("SC-16: counts the complete branded SMS template before merge fields", () => {
    const count = smsCounter("Hi {firstName} ^ 🙂");
    expect(count.text).toBe(
      `${brand.smsSenderPrefix}Hi {firstName} ^ 🙂 Reply STOP to opt out.`
    );
    expect(count.length).toBe(brand.smsSenderPrefix.length + 43);
    expect(count.septets).toBe(brand.smsSenderPrefix.length + 43);
    expect(count.max).toBe(320);
    expect(count.nonGsmChars).toEqual(["🙂"]);
    expect(count.ok).toBe(false);

    const tooLong = smsCounter("x".repeat(400));
    expect(tooLong.septets).toBeGreaterThan(320);
    expect(tooLong.reason).toContain("320");
  });

  it("SC-16: inserts merge fields at the selected range and returns the next cursor", () => {
    expect(insertAtCursor("Hello name!", 6, 10, "{firstName}")).toEqual({
      value: "Hello {firstName}!",
      cursor: 17,
    });
    expect(insertAtCursor("Hi", 99, 100, " {cohortName}")).toEqual({
      value: "Hi {cohortName}",
      cursor: 15,
    });
  });

  it("SC-16: maps campaign snapshots, send stats, and sender names into history rows", () => {
    const rows = buildHistoryRows(
      [
        {
          id: "campaign-1",
          sentAt: new Date("2026-10-06T17:00:00.000Z"),
          createdAt: new Date("2026-10-06T16:59:00.000Z"),
          audienceSnapshot: JSON.stringify({
            sentByUserId: "user-1",
            total: 12,
            email: 10,
            sms: 8,
            sendAt: "2026-10-07T16:00:00.000Z",
          }),
        },
      ],
      new Map([["user-1", { name: "Ada Lovelace", email: "ada@example.com" }]]),
      new Map([["campaign-1", { delivered: 9, opened: 4 }]])
    );

    expect(rows).toEqual([
      {
        id: "campaign-1",
        sentAt: "2026-10-06T17:00:00.000Z",
        scheduledFor: "2026-10-07T16:00:00.000Z",
        senderName: "Ada Lovelace",
        emailCount: 10,
        smsCount: 8,
        total: 12,
        delivered: 9,
        opened: 4,
      },
    ]);
    expect(
      historySenderIds([
        {
          id: "campaign-1",
          sentAt: null,
          createdAt: "2026-10-06T16:59:00.000Z",
          audienceSnapshot: JSON.stringify({ sentByUserId: "user-1" }),
        },
        {
          id: "campaign-2",
          sentAt: null,
          createdAt: "2026-10-06T16:59:00.000Z",
          audienceSnapshot: JSON.stringify({ sentByUserId: "user-1" }),
        },
      ])
    ).toEqual(["user-1"]);
  });

  it("SC-16: tolerates malformed campaign history snapshots without throwing", () => {
    expect(
      buildHistoryRows(
        [
          {
            id: "broken",
            sentAt: null,
            createdAt: "2026-10-06T16:59:00.000Z",
            audienceSnapshot: "{not json",
          },
        ],
        new Map(),
        new Map()
      )
    ).toEqual([
      {
        id: "broken",
        sentAt: "2026-10-06T16:59:00.000Z",
        senderName: "Unknown sender",
        emailCount: 0,
        smsCount: 0,
        total: 0,
      },
    ]);
  });

  it("SC-16: converts a cohort wall time to a DST-correct ISO instant", () => {
    expect(wallTimeToIso("2026-10-06T09:30", "America/Los_Angeles")).toEqual({
      ok: true,
      iso: "2026-10-06T16:30:00.000Z",
    });
    expect(wallTimeToIso("2026-01-06T09:30", "PT")).toEqual({
      ok: true,
      iso: "2026-01-06T17:30:00.000Z",
    });
    expect(wallTimeToIso("not-a-date", "America/Los_Angeles")).toEqual({
      ok: false,
      reason: "Choose a valid date and time",
    });
  });
});

describe("sendConfirmMessage", () => {
  it("SC-16: counts who actually receives each channel, not the whole audience", () => {
    expect(sendConfirmMessage({ total: 2, email: 1, sms: 0, smsOn: false })).toBe(
      "Send email to 1 of 2 people now? Text messages are off."
    );
    expect(sendConfirmMessage({ total: 5, email: 4, sms: 3, smsOn: true })).toBe(
      "Send email to 4 and text to 3 of 5 people now?"
    );
  });

  it("SC-16: scheduled sends name the time and timezone", () => {
    expect(
      sendConfirmMessage({
        total: 3,
        email: 3,
        sms: 1,
        smsOn: true,
        schedule: { when: "2026-10-08 18:00", timezone: "America/Los_Angeles" },
      })
    ).toBe("Schedule email to 3 and text to 1 of 3 people for 2026-10-08 18:00 America/Los_Angeles?");
  });
});
