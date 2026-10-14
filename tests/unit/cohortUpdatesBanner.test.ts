import { describe, expect, it } from "bun:test";
import {
  COHORT_UPDATES_BANNER_COPY,
  cohortUpdatesBannerState,
} from "@/lib/cohortMessages/bannerState";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

type BannerContact = Parameters<typeof cohortUpdatesBannerState>[0];

function contact(overrides: Partial<NonNullable<BannerContact>> = {}): NonNullable<BannerContact> {
  return {
    phone: "+14155551234",
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: NOW,
    smsOptOutAt: null,
    courseEmailOptOutAt: null,
    cohortBannerDismissedAt: null,
    ...overrides,
  };
}

describe("cohortUpdatesBannerState", () => {
  it("SC-17: prompts independently for course email opt-out and missing transactional SMS consent", () => {
    expect(
      cohortUpdatesBannerState(
        contact({
          courseEmailOptOutAt: new Date("2026-10-01T00:00:00.000Z"),
          smsTransactionalConsentAt: null,
        }),
        { status: "ENROLLMENT" },
        NOW
      )
    ).toEqual({ showEmail: true, showSms: true });

    expect(
      cohortUpdatesBannerState(contact(), { status: "IN_PROGRESS" }, NOW)
    ).toEqual({ showEmail: false, showSms: false });
  });

  it("SC-17: treats a missing Contact as email-on and SMS-without-consent", () => {
    expect(cohortUpdatesBannerState(null, { status: "ENROLLMENT" }, NOW)).toEqual({
      showEmail: false,
      showSms: true,
    });
  });

  it("SC-17: prompts for every transactional SMS failure except a STOP opt-out", () => {
    const cases: Array<[Partial<NonNullable<BannerContact>>, boolean]> = [
      [{ smsTransactionalConsentAt: null }, true],
      [{ phone: null }, true],
      [{ phone: "not a phone" }, true],
      [{ smsOptOutAt: new Date("2026-10-01T00:00:00.000Z") }, false],
      [{}, false],
    ];

    for (const [overrides, showSms] of cases) {
      expect(
        cohortUpdatesBannerState(contact(overrides), { status: "IN_PROGRESS" }, NOW)
      ).toEqual({ showEmail: false, showSms });
    }
  });

  it("SC-17: hides both prompts outside enrollment and in-progress cohorts", () => {
    for (const status of ["DRAFT", "COMPLETE", "ARCHIVED"]) {
      expect(
        cohortUpdatesBannerState(
          contact({
            courseEmailOptOutAt: NOW,
            smsTransactionalConsentAt: null,
          }),
          { status },
          NOW
        )
      ).toEqual({ showEmail: false, showSms: false });
    }
  });

  it("SC-17: suppresses a dismissal for seven days and shows again at the boundary", () => {
    const optedOut = {
      courseEmailOptOutAt: NOW,
      smsTransactionalConsentAt: null,
    } as const;

    expect(
      cohortUpdatesBannerState(
        contact({ ...optedOut, cohortBannerDismissedAt: new Date(NOW.getTime() - 7 * DAY_MS + 1) }),
        { status: "ENROLLMENT" },
        NOW
      )
    ).toEqual({ showEmail: false, showSms: false });
    expect(
      cohortUpdatesBannerState(
        contact({ ...optedOut, cohortBannerDismissedAt: new Date(NOW.getTime() - 7 * DAY_MS) }),
        { status: "ENROLLMENT" },
        NOW
      )
    ).toEqual({ showEmail: true, showSms: true });
    expect(
      cohortUpdatesBannerState(
        contact({ ...optedOut, cohortBannerDismissedAt: new Date(NOW.getTime() - 7 * DAY_MS - 1) }),
        { status: "ENROLLMENT" },
        NOW
      )
    ).toEqual({ showEmail: true, showSms: true });
  });

  it("SC-17: exports the approved banner copy exactly", () => {
    expect(COHORT_UPDATES_BANNER_COPY.body("AI Builders")).toBe(
      "Get updates about AI Builders by email and text so you don't miss schedule changes."
    );
    expect(COHORT_UPDATES_BANNER_COPY.emailButton).toBe("Turn on email updates");
    expect(COHORT_UPDATES_BANNER_COPY.smsButton).toBe("Add my phone");
    expect(COHORT_UPDATES_BANNER_COPY.dismissButton).toBe("Not now");
  });
});
