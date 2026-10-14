// tests/unit/session-patch-route.test.ts
// SC5 — PATCH /api/cohorts/[id]/sessions/[sessionId]: a custom join link, a link
// borrowed from another cohort's session (resolved server-side), clearing, the
// tenant guard, and recording propagation to borrowers.

import { beforeEach, describe, expect, it, mock } from "bun:test";

type SessionRow = {
  id: string;
  cohortId: string;
  title: string;
  description: string | null;
  recordingLink: string | null;
  meetingLink: string | null;
  linkedSessionId: string | null;
};

const cohortZoom: Record<string, string | null> = {
  qa: "https://zoom.us/j/qa-cohort",
  sep7: "https://zoom.us/j/sep7-cohort",
  bare: null,
};

const sessions: SessionRow[] = [];

function seed() {
  sessions.length = 0;
  sessions.push(
    { id: "qa-1", cohortId: "qa", title: "Q&A 1", description: null, recordingLink: null, meetingLink: null, linkedSessionId: null },
    { id: "qa-2", cohortId: "qa", title: "Q&A 2", description: null, recordingLink: null, meetingLink: null, linkedSessionId: null },
    { id: "sep7-a", cohortId: "sep7", title: "Day 1", description: null, recordingLink: null, meetingLink: "https://zoom.us/j/sep7-session", linkedSessionId: null },
    { id: "sep7-b", cohortId: "sep7", title: "Day 2", description: null, recordingLink: null, meetingLink: null, linkedSessionId: null },
    { id: "bare-a", cohortId: "bare", title: "No link", description: null, recordingLink: null, meetingLink: null, linkedSessionId: null }
  );
}

const cohortSlugs: Record<string, string> = { qa: "ai-start-academy-q-a", sep7: "evening-sep-7" };

mock.module("@/lib/prisma", () => ({
  default: {
    cohort: {
      findFirst: async ({ where }: { where: { OR: Array<{ id?: string; slug?: string }> } }) => {
        const key = where.OR[0]?.id ?? where.OR[1]?.slug ?? "";
        const id = Object.keys(cohortZoom).find((c) => c === key || cohortSlugs[c] === key);
        return id ? { id } : null;
      },
    },
    cohortSession: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: { cohort?: unknown } }) => {
        const row = sessions.find((s) => s.id === where.id);
        if (!row) return null;
        if (select?.cohort) {
          return { id: row.id, meetingLink: row.meetingLink, cohort: { zoomLink: cohortZoom[row.cohortId] ?? null } };
        }
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; cohortId?: string; linkedSessionId?: string; recordingLink?: null };
        data: Partial<SessionRow>;
      }) => {
        let count = 0;
        for (const row of sessions) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.cohortId !== undefined && row.cohortId !== where.cohortId) continue;
          if (where.linkedSessionId !== undefined && row.linkedSessionId !== where.linkedSessionId) continue;
          if ("recordingLink" in where && row.recordingLink !== where.recordingLink) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
  },
}));

const realAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...realAuth,
  auth: async () => ({ user: { id: "admin", email: "admin@example.com", role: "ADMIN", roles: ["ADMIN"] } }),
}));

const { PATCH } = await import("@/app/api/cohorts/[id]/sessions/[sessionId]/route");

async function patch(cohortId: string, sessionId: string, body: unknown) {
  const res = await PATCH(
    new Request(`https://hub.example/api/cohorts/${cohortId}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: cohortId, sessionId }) }
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { session?: SessionRow } };
}

const row = (id: string) => sessions.find((s) => s.id === id)!;

describe("PATCH /api/cohorts/[id]/sessions/[sessionId]", () => {
  beforeEach(seed);

  it("SC5.0: the cohort segment may be the public slug, not only the cuid", async () => {
    const res = await patch("ai-start-academy-q-a", "qa-1", { meetingLink: "https://zoom.us/j/slug-ok" });
    expect(res.status).toBe(200);
    expect(sessions.find((s) => s.id === "qa-1")?.meetingLink).toBe("https://zoom.us/j/slug-ok");
    const unknown = await patch("no-such-cohort", "qa-1", { meetingLink: "https://zoom.us/j/x" });
    expect(unknown.status).toBe(404);
  });

  it("SC5.1: a custom meetingLink is stored and any linkedSessionId is cleared", async () => {
    row("qa-1").linkedSessionId = "sep7-a";
    const r = await patch("qa", "qa-1", { meetingLink: " https://zoom.us/j/custom " });
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.session?.meetingLink).toBe("https://zoom.us/j/custom");
    expect(r.json.session?.linkedSessionId).toBeNull();
    expect(row("qa-1").meetingLink).toBe("https://zoom.us/j/custom");
  });

  it("SC5.2: a non-http meetingLink is 400 and nothing changes", async () => {
    for (const bad of ["javascript:alert(1)", "zoom.us/j/1", "", 42]) {
      const r = await patch("qa", "qa-1", { meetingLink: bad });
      expect(r.status).toBe(400);
    }
    expect(row("qa-1").meetingLink).toBeNull();
  });

  it("SC5.3: linkedSessionId borrows the source session's own meetingLink", async () => {
    const r = await patch("qa", "qa-1", { linkedSessionId: "sep7-a" });
    expect(r.status).toBe(200);
    expect(r.json.session?.meetingLink).toBe("https://zoom.us/j/sep7-session");
    expect(r.json.session?.linkedSessionId).toBe("sep7-a");
  });

  it("SC5.4: linkedSessionId falls back to the source cohort's zoomLink", async () => {
    const r = await patch("qa", "qa-1", { linkedSessionId: "sep7-b" });
    expect(r.status).toBe(200);
    expect(r.json.session?.meetingLink).toBe("https://zoom.us/j/sep7-cohort");
    expect(r.json.session?.linkedSessionId).toBe("sep7-b");
  });

  it("SC5.5: an unknown source session is 404", async () => {
    const r = await patch("qa", "qa-1", { linkedSessionId: "nope" });
    expect(r.status).toBe(404);
    expect(row("qa-1").linkedSessionId).toBeNull();
  });

  it("SC5.6: a source with no link anywhere is 400", async () => {
    const r = await patch("qa", "qa-1", { linkedSessionId: "bare-a" });
    expect(r.status).toBe(400);
    expect(row("qa-1").meetingLink).toBeNull();
  });

  it("SC5.7: a session cannot link to itself", async () => {
    const r = await patch("qa", "qa-1", { linkedSessionId: "qa-1" });
    expect(r.status).toBe(400);
  });

  it("SC5.8: meetingLink null clears both the link and the provenance", async () => {
    await patch("qa", "qa-1", { linkedSessionId: "sep7-a" });
    const r = await patch("qa", "qa-1", { meetingLink: null });
    expect(r.status).toBe(200);
    expect(row("qa-1").meetingLink).toBeNull();
    expect(row("qa-1").linkedSessionId).toBeNull();
  });

  it("SC5.9: meetingLink and linkedSessionId together are 400", async () => {
    const r = await patch("qa", "qa-1", { meetingLink: "https://x.test", linkedSessionId: "sep7-a" });
    expect(r.status).toBe(400);
  });

  it("SC5.10: the tenant guard still 404s a session from another cohort", async () => {
    const r = await patch("qa", "sep7-a", { meetingLink: "https://zoom.us/j/hijack" });
    expect(r.status).toBe(404);
    expect(row("sep7-a").meetingLink).toBe("https://zoom.us/j/sep7-session");
  });

  it("SC5.11: a recordingLink edit propagates to sessions that borrowed this one", async () => {
    await patch("qa", "qa-1", { linkedSessionId: "sep7-a" });
    await patch("qa", "qa-2", { linkedSessionId: "sep7-a" });
    row("qa-2").recordingLink = "/courses/own/lesson"; // already has its own recording
    const r = await patch("sep7", "sep7-a", { recordingLink: "/courses/raw/lesson-1" });
    expect(r.status).toBe(200);
    expect(row("sep7-a").recordingLink).toBe("/courses/raw/lesson-1");
    expect(row("qa-1").recordingLink).toBe("/courses/raw/lesson-1");
    expect(row("qa-2").recordingLink).toBe("/courses/own/lesson");
    // Clearing a recording must not propagate nulls.
    await patch("sep7", "sep7-a", { recordingLink: "" });
    expect(row("sep7-a").recordingLink).toBeNull();
    expect(row("qa-1").recordingLink).toBe("/courses/raw/lesson-1");
  });
});
