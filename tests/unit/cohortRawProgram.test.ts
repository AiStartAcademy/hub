import { describe, expect, it } from "bun:test";
import {
  buildProgramsRelation,
  canSetRawProgram,
  resolveRawProgramUpdate,
  type RawProgramDb,
} from "@/lib/cohortRawProgram";

// Criterion 1: PUT/PATCH /api/cohorts/[id] accepts rawProgramId. The decision logic is a
// pure helper over an injected db, so no mock.module (which leaks process-wide) is needed.

type Calls = { writes: number };

function fakeDb(opts: {
  programs?: string[];
  cohorts?: Array<{ id: string; title: string; rawProgramId: string | null }>;
}): RawProgramDb & { calls: Calls } {
  const programs = opts.programs ?? [];
  const cohorts = opts.cohorts ?? [];
  const calls: Calls = { writes: 0 };
  return {
    calls,
    program: {
      findUnique: async ({ where }) => (programs.includes(where.id) ? { id: where.id } : null),
    },
    cohort: {
      findFirst: async ({ where }) =>
        cohorts.find((c) => c.rawProgramId === where.rawProgramId && c.id !== where.NOT.id) ?? null,
    },
  };
}

const admin = { role: "ADMIN" };
const teamMember = { role: "TEAM_MEMBER" };
const instructor = { role: "INSTRUCTOR" };

describe("SC-1 rawProgramId on cohort update", () => {
  it("SC-1a: omitted rawProgramId is a no-op for any manager, including instructors", async () => {
    const result = await resolveRawProgramUpdate(fakeDb({}), { cohortId: "c1", input: undefined, user: instructor });
    expect(result).toEqual({ ok: true, rawProgramId: undefined, connectProgramId: null });
  });

  it("SC-1b: a string sets rawProgramId and connects the program (ADMIN)", async () => {
    const db = fakeDb({ programs: ["p1"] });
    const result = await resolveRawProgramUpdate(db, { cohortId: "c1", input: "p1", user: admin });
    expect(result).toEqual({ ok: true, rawProgramId: "p1", connectProgramId: "p1" });
  });

  it("SC-1c: TEAM_MEMBER may also set it", async () => {
    const result = await resolveRawProgramUpdate(fakeDb({ programs: ["p1"] }), {
      cohortId: "c1",
      input: "  p1 ",
      user: teamMember,
    });
    expect(result).toEqual({ ok: true, rawProgramId: "p1", connectProgramId: "p1" });
  });

  it("SC-1d: null clears it without connecting anything", async () => {
    const result = await resolveRawProgramUpdate(fakeDb({}), { cohortId: "c1", input: null, user: admin });
    expect(result).toEqual({ ok: true, rawProgramId: null, connectProgramId: null });
  });

  it("SC-1e: instructor-only users get 403 for both set and clear", async () => {
    for (const input of ["p1", null]) {
      const result = await resolveRawProgramUpdate(fakeDb({ programs: ["p1"] }), { cohortId: "c1", input, user: instructor });
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
    expect(canSetRawProgram({ roles: ["INSTRUCTOR", "ADMIN"] })).toBe(true);
    expect(canSetRawProgram(instructor)).toBe(false);
    expect(canSetRawProgram(undefined)).toBe(false);
  });

  it("SC-1f: 409 with a clear message when another cohort already owns the program", async () => {
    const db = fakeDb({
      programs: ["p1"],
      cohorts: [{ id: "other", title: "10-Day Intensive (Aug 10)", rawProgramId: "p1" }],
    });
    const result = await resolveRawProgramUpdate(db, { cohortId: "c1", input: "p1", user: admin });
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) {
      expect(result.error).toContain("10-Day Intensive (Aug 10)");
      expect(result.error).toContain("p1");
    }
  });

  it("SC-1g: re-setting the cohort's own current rawProgramId is not a conflict", async () => {
    const db = fakeDb({ programs: ["p1"], cohorts: [{ id: "c1", title: "Self", rawProgramId: "p1" }] });
    const result = await resolveRawProgramUpdate(db, { cohortId: "c1", input: "p1", user: admin });
    expect(result).toEqual({ ok: true, rawProgramId: "p1", connectProgramId: "p1" });
  });

  it("SC-1h: 404 when the program does not exist", async () => {
    const result = await resolveRawProgramUpdate(fakeDb({}), { cohortId: "c1", input: "missing", user: admin });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("SC-1i: 400 for a non-string, non-null value or an empty string", async () => {
    for (const input of [42, {}, "", "   "]) {
      const result = await resolveRawProgramUpdate(fakeDb({ programs: ["p1"] }), { cohortId: "c1", input, user: admin });
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("SC-1j: programs relation connects the raw program, or appends it to an explicit programIds set", () => {
    expect(buildProgramsRelation(undefined, null)).toBeUndefined();
    expect(buildProgramsRelation(undefined, "p1")).toEqual({ connect: [{ id: "p1" }] });
    expect(buildProgramsRelation(["a", "b"], null)).toEqual({ set: [{ id: "a" }, { id: "b" }] });
    expect(buildProgramsRelation(["a", "p1"], "p1")).toEqual({ set: [{ id: "a" }, { id: "p1" }] });
    expect(buildProgramsRelation(["a"], "p1")).toEqual({ set: [{ id: "a" }, { id: "p1" }] });
  });
});
