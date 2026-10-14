// tests/unit/session-link.test.ts
// SC4 — per-session join links: which URL a student actually sees, what counts
// as a safe custom link, and how a recording reaches the sessions that borrowed
// this session's meeting.

import { describe, expect, it, mock } from "bun:test";

type UpdateManyArgs = {
  where: { linkedSessionId: string; recordingLink: null };
  data: { recordingLink: string };
};

const updateManyCalls: UpdateManyArgs[] = [];

mock.module("@/lib/prisma", () => ({
  default: {
    cohortSession: {
      updateMany: async (args: UpdateManyArgs) => {
        updateManyCalls.push(args);
        return { count: 2 };
      },
    },
  },
}));

const { resolveJoinLink, isHttpUrl, propagateRecordingLink } = await import(
  "@/lib/sessionLink"
);

describe("resolveJoinLink", () => {
  it("SC4.1: the session's own meetingLink wins over the cohort link", () => {
    expect(
      resolveJoinLink({
        meetingLink: "https://zoom.us/j/session",
        cohort: { zoomLink: "https://zoom.us/j/cohort" },
      })
    ).toBe("https://zoom.us/j/session");
  });

  it("SC4.2: falls back to the cohort link when the session has none", () => {
    expect(
      resolveJoinLink({
        meetingLink: null,
        cohort: { zoomLink: "https://zoom.us/j/cohort" },
      })
    ).toBe("https://zoom.us/j/cohort");
  });

  it("SC4.3: null when neither the session nor the cohort has a link", () => {
    expect(resolveJoinLink({ meetingLink: null, cohort: { zoomLink: null } })).toBeNull();
    expect(resolveJoinLink({ meetingLink: null, cohort: null })).toBeNull();
  });

  it("SC4.4: a blank stored link is treated as absent, not as an empty href", () => {
    expect(
      resolveJoinLink({ meetingLink: "   ", cohort: { zoomLink: "https://zoom.us/j/cohort" } })
    ).toBe("https://zoom.us/j/cohort");
    expect(resolveJoinLink({ meetingLink: "", cohort: { zoomLink: "  " } })).toBeNull();
  });
});

describe("isHttpUrl", () => {
  it("SC4.5: accepts http and https only", () => {
    expect(isHttpUrl("https://zoom.us/j/123")).toBe(true);
    expect(isHttpUrl("http://localhost:3000/room")).toBe(true);
  });

  it("SC4.6: rejects javascript:, other schemes, bare text and non-strings", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    // eslint-disable-next-line no-script-url
    expect(isHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("zoom.us/j/123")).toBe(false);
    expect(isHttpUrl("ask the instructor")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("   ")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
  });
});

describe("propagateRecordingLink", () => {
  it("SC4.7: fills only linked sessions that have no recording of their own", async () => {
    updateManyCalls.length = 0;
    const count = await propagateRecordingLink("session-1", "/courses/p1/l1");
    expect(count).toBe(2);
    expect(updateManyCalls).toEqual([
      {
        where: { linkedSessionId: "session-1", recordingLink: null },
        data: { recordingLink: "/courses/p1/l1" },
      },
    ]);
  });

  it("SC4.8: an empty recording link is a no-op, never a blanket overwrite", async () => {
    updateManyCalls.length = 0;
    expect(await propagateRecordingLink("session-1", "")).toBe(0);
    expect(await propagateRecordingLink("session-1", "   ")).toBe(0);
    expect(updateManyCalls).toEqual([]);
  });
});
