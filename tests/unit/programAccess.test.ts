import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const {
  ACCESS_MODES,
  GATED_SELLABLE_MODES,
  SELF_ENROLL_MODES,
  accessRouteFor,
  decideAccess,
  isSelfEnrollMode,
} = await import("@/lib/programAccess");

/** Signed in, holding nothing. Individual facts are flipped on per case. */
const NO_GRANTS = {
  isAuthenticated: true,
  hasCohortGrant: false,
  hasDirectGrant: false,
  meetsMemberTier: false,
} as const;

// The invariant these tests defend: being signed in is not an entitlement.
// Before this was enforced, any logged-in user could self-grant a
// ProgramEnrollment on a cohort-gated program and read paid content for free.

describe("isSelfEnrollMode", () => {
  it("allows self-enroll only for the free-by-design modes", () => {
    expect(isSelfEnrollMode("public")).toBe(true);
    expect(isSelfEnrollMode("auth")).toBe(true);
  });

  it("refuses every mode that requires a real grant", () => {
    // cohort = paid/assigned seat, member = active subscription,
    // direct = staff-issued ProgramAccess. None are self-serve.
    expect(isSelfEnrollMode("cohort")).toBe(false);
    expect(isSelfEnrollMode("direct")).toBe(false);
    expect(isSelfEnrollMode("member")).toBe(false);
  });

  it("fails closed on an unknown mode", () => {
    // A typo'd or future accessMode must never accidentally become self-serve.
    expect(isSelfEnrollMode("")).toBe(false);
    expect(isSelfEnrollMode("nonsense")).toBe(false);
    expect(isSelfEnrollMode("COHORT")).toBe(false);
  });

  it("keeps SELF_ENROLL_MODES a strict subset of ACCESS_MODES", () => {
    for (const mode of SELF_ENROLL_MODES) {
      expect(ACCESS_MODES).toContain(mode);
    }
    expect(SELF_ENROLL_MODES.length).toBeLessThan(ACCESS_MODES.length);
  });
});

describe("accessRouteFor", () => {
  it("sends guests to sign in first, whatever the mode", () => {
    for (const mode of ACCESS_MODES) {
      expect(accessRouteFor(mode, false)).toBe("sign-in");
    }
  });

  it("routes a signed-in user to how they actually get access", () => {
    expect(accessRouteFor("cohort", true)).toBe("buy-cohort-seat");
    expect(accessRouteFor("member", true)).toBe("membership");
    expect(accessRouteFor("direct", true)).toBe("request-access");
  });

  it("only offers the self-enroll button where the server would permit it", () => {
    // This pairing is the point: the CTA must never promise something
    // enrollInProgram will refuse.
    for (const mode of ACCESS_MODES) {
      const offersSelfEnroll = accessRouteFor(mode, true) === "self-enroll";
      expect(offersSelfEnroll).toBe(isSelfEnrollMode(mode));
    }
  });

  it("lets every guest buy a sellable gated program without signing in first", () => {
    for (const mode of GATED_SELLABLE_MODES) {
      expect(accessRouteFor(mode, false, { sellable: true })).toBe("buy-course");
    }
  });

  it("sends every signed-in gated viewer to the sellable course funnel", () => {
    for (const mode of GATED_SELLABLE_MODES) {
      expect(accessRouteFor(mode, true, { sellable: true })).toBe("buy-course");
    }
  });

  it("keeps the sellable allowlist equal to every non-free access mode", () => {
    const gatedModes = ACCESS_MODES.filter(
      (mode) => !SELF_ENROLL_MODES.includes(mode)
    );
    expect(GATED_SELLABLE_MODES).toEqual(gatedModes);
  });

  it("preserves every existing route when sellability is false or omitted", () => {
    for (const mode of ACCESS_MODES) {
      for (const isAuthenticated of [false, true]) {
        const existingRoute = accessRouteFor(mode, isAuthenticated);
        expect(
          accessRouteFor(mode, isAuthenticated, { sellable: false })
        ).toBe(existingRoute);
        expect(accessRouteFor(mode, isAuthenticated, {})).toBe(existingRoute);
      }
    }
  });

  it("keeps free-by-design modes off the paid funnel even when marked sellable", () => {
    for (const mode of SELF_ENROLL_MODES) {
      expect(accessRouteFor(mode, false, { sellable: true })).toBe("sign-in");
      expect(accessRouteFor(mode, true, { sellable: true })).toBe("self-enroll");
    }
  });

  it("keeps unknown modes off the paid funnel even when marked sellable", () => {
    for (const mode of ["nonsense", "MEMBER"]) {
      expect(accessRouteFor(mode, false, { sellable: true })).toBe("sign-in");
      expect(accessRouteFor(mode, true, { sellable: true })).toBe(
        "buy-cohort-seat"
      );
    }
  });
});

// The invariant these defend: access sources are ADDITIVE. A real grant always
// counts; accessMode only widens the audience on top of it. Modes form a
// permissiveness ladder — cohort ⊂ direct ⊂ member — so no mode can take access
// away from someone who was granted it.
describe("decideAccess", () => {
  it("lets a cohort student into a members-only course", () => {
    // THE REGRESSION GUARD. `member` used to check the membership snapshot and
    // nothing else, so a course that was both a paid recordings product and a
    // cohort's curriculum locked out every cohort student without a
    // subscription — page, lesson, and signed media bytes alike.
    expect(
      decideAccess({ ...NO_GRANTS, mode: "member", hasCohortGrant: true })
    ).toBe(true);
  });

  it("honours a staff-issued grant as a comp into a members-only course", () => {
    // The escape hatch: comping one person in is a ProgramAccess row, never
    // re-moding the whole course.
    expect(
      decideAccess({ ...NO_GRANTS, mode: "member", hasDirectGrant: true })
    ).toBe(true);
  });

  it("still admits paying members who hold no grant", () => {
    expect(
      decideAccess({ ...NO_GRANTS, mode: "member", meetsMemberTier: true })
    ).toBe(true);
  });

  it("refuses a signed-in user holding nothing, whatever the gated mode", () => {
    for (const mode of ["cohort", "direct", "member"]) {
      expect(decideAccess({ ...NO_GRANTS, mode })).toBe(false);
    }
  });

  it("keeps cohort mode strict — a direct grant does not open it", () => {
    // "Cohort only" is the strictest rung and must stay that way.
    expect(
      decideAccess({ ...NO_GRANTS, mode: "cohort", hasDirectGrant: true })
    ).toBe(false);
    expect(
      decideAccess({ ...NO_GRANTS, mode: "cohort", meetsMemberTier: true })
    ).toBe(false);
    expect(
      decideAccess({ ...NO_GRANTS, mode: "cohort", hasCohortGrant: true })
    ).toBe(true);
  });

  it("admits either grant under direct mode, but not a membership", () => {
    expect(
      decideAccess({ ...NO_GRANTS, mode: "direct", hasCohortGrant: true })
    ).toBe(true);
    expect(
      decideAccess({ ...NO_GRANTS, mode: "direct", hasDirectGrant: true })
    ).toBe(true);
    expect(
      decideAccess({ ...NO_GRANTS, mode: "direct", meetsMemberTier: true })
    ).toBe(false);
  });

  it("gates auth mode on being signed in, and nothing else", () => {
    expect(decideAccess({ ...NO_GRANTS, mode: "auth" })).toBe(true);
    expect(
      decideAccess({ ...NO_GRANTS, mode: "auth", isAuthenticated: false })
    ).toBe(false);
  });

  it("lets guests into public content only", () => {
    const guest = { ...NO_GRANTS, isAuthenticated: false };
    expect(decideAccess({ ...guest, mode: "public" })).toBe(true);
    for (const mode of ["auth", "cohort", "direct", "member"]) {
      expect(decideAccess({ ...guest, mode })).toBe(false);
    }
  });

  it("fails closed on an unknown mode, even with every grant held", () => {
    // A typo'd or future accessMode must never accidentally grant access.
    for (const mode of ["", "nonsense", "MEMBER", "Cohort"]) {
      expect(
        decideAccess({
          mode,
          isAuthenticated: true,
          hasCohortGrant: true,
          hasDirectGrant: true,
          meetsMemberTier: true,
        })
      ).toBe(false);
    }
  });

  it("keeps the ladder monotonic: cohort ⊆ direct ⊆ member", () => {
    // Exhaustive over the 8 grant combinations — widening a course's mode must
    // never revoke access someone already had.
    for (const hasCohortGrant of [false, true]) {
      for (const hasDirectGrant of [false, true]) {
        for (const meetsMemberTier of [false, true]) {
          const facts = {
            isAuthenticated: true,
            hasCohortGrant,
            hasDirectGrant,
            meetsMemberTier,
          };
          const cohort = decideAccess({ ...facts, mode: "cohort" });
          const direct = decideAccess({ ...facts, mode: "direct" });
          const member = decideAccess({ ...facts, mode: "member" });
          if (cohort) expect(direct).toBe(true);
          if (direct) expect(member).toBe(true);
        }
      }
    }
  });
});
