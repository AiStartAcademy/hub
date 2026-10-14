import { describe, expect, it } from "bun:test";
import { matchSessionByInstant, sessionLinkChip } from "@/app/(dashboard)/cohorts/[id]/edit/SessionsPanel";

// The chip is the only place a manager sees where a session's join link comes
// from (own custom URL, borrowed from another cohort's session, the cohort's
// Zoom link, or nothing). Keep its precedence pinned.

describe("sessionLinkChip", () => {
  it("labels a custom link when meetingLink is set without a source session", () => {
    expect(
      sessionLinkChip({ meetingLink: "https://zoom.us/j/1", linkedSessionId: null, cohortZoomLink: "https://zoom.us/j/9", sourceCohortTitle: null })
    ).toEqual({ label: "Custom link", url: "https://zoom.us/j/1" });
  });

  it("names the source cohort for a borrowed link", () => {
    expect(
      sessionLinkChip({ meetingLink: "https://zoom.us/j/2", linkedSessionId: "src", cohortZoomLink: null, sourceCohortTitle: "3-Week Evening Edition" })
    ).toEqual({ label: "From 3-Week Evening Edition", url: "https://zoom.us/j/2" });
  });

  it("falls back to 'Linked' when the source cohort title is unknown", () => {
    expect(
      sessionLinkChip({ meetingLink: "https://zoom.us/j/2", linkedSessionId: "src", cohortZoomLink: null, sourceCohortTitle: null })
    ).toEqual({ label: "Linked", url: "https://zoom.us/j/2" });
  });

  it("uses the cohort link when the session has none of its own", () => {
    expect(
      sessionLinkChip({ meetingLink: null, linkedSessionId: null, cohortZoomLink: "https://zoom.us/j/9", sourceCohortTitle: null })
    ).toEqual({ label: "Cohort link", url: "https://zoom.us/j/9" });
  });

  it("reports no link when neither the session nor the cohort has one", () => {
    expect(
      sessionLinkChip({ meetingLink: null, linkedSessionId: null, cohortZoomLink: null, sourceCohortTitle: null })
    ).toEqual({ label: "No link", url: null });
    expect(
      sessionLinkChip({ meetingLink: "", linkedSessionId: null, cohortZoomLink: "", sourceCohortTitle: null })
    ).toEqual({ label: "No link", url: null });
  });
});

describe("matchSessionByInstant", () => {
  const rows = [
    { id: "a", startTime: "2026-09-09T01:00:00.000Z" },
    { id: "b", startTime: "2026-09-10T01:00:00.000Z" },
    { id: "c", startTime: null },
  ];

  it("returns the session whose startTime is the same instant, regardless of ISO spelling", () => {
    expect(matchSessionByInstant(rows, "2026-09-10T01:00:00.000Z")?.id).toBe("b");
    expect(matchSessionByInstant(rows, "2026-09-09T02:00:00+01:00")?.id).toBe("a");
  });

  it("returns null when no session matches or the target is missing/invalid", () => {
    expect(matchSessionByInstant(rows, "2026-09-11T01:00:00.000Z")).toBeNull();
    expect(matchSessionByInstant(rows, null)).toBeNull();
    expect(matchSessionByInstant(rows, "garbage")).toBeNull();
    expect(matchSessionByInstant([], "2026-09-10T01:00:00.000Z")).toBeNull();
  });
});
