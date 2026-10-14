import { describe, expect, it } from "bun:test";

// Pure helpers behind the shared free-seat form. They are the contract the two
// public surfaces (cohorts list card + cohort detail rail) and the register-free
// route agree on, so they are exercised directly instead of through the DOM.
import {
  freeSeatRequestBody,
  freeSeatSuccessCopy,
  isFreeTier,
  validateFreeSeat,
} from "@/components/FreeSeatForm";

describe("isFreeTier", () => {
  it("treats a zero-price tier as free", () => {
    expect(isFreeTier({ price: 0 })).toBe(true);
  });

  it("treats a negative price as free (defensive — never billable)", () => {
    expect(isFreeTier({ price: -1 })).toBe(true);
  });

  it("treats any positive price as paid", () => {
    expect(isFreeTier({ price: 150 })).toBe(false);
  });

  it("is false when no tier is selected", () => {
    expect(isFreeTier(undefined)).toBe(false);
    expect(isFreeTier(null)).toBe(false);
  });
});

describe("freeSeatRequestBody", () => {
  it("sends trimmed name and email for a guest", () => {
    expect(
      freeSeatRequestBody({
        name: "  Ada Lovelace  ",
        email: "  Ada@Example.com ",
        waiverAccepted: false,
        authenticated: false,
      })
    ).toEqual({ name: "Ada Lovelace", email: "Ada@Example.com", waiverAccepted: false });
  });

  it("omits name and email for a signed-in caller (the server uses the session)", () => {
    expect(
      freeSeatRequestBody({
        name: "Ada",
        email: "ada@example.com",
        waiverAccepted: true,
        authenticated: true,
      })
    ).toEqual({ waiverAccepted: true });
  });

  it("includes groupId only when a tier was chosen", () => {
    expect(
      freeSeatRequestBody({
        name: "Ada",
        email: "ada@example.com",
        waiverAccepted: false,
        groupId: "grp_1",
        authenticated: false,
      })
    ).toEqual({ name: "Ada", email: "ada@example.com", waiverAccepted: false, groupId: "grp_1" });

    expect(
      Object.keys(
        freeSeatRequestBody({
          name: "Ada",
          email: "ada@example.com",
          waiverAccepted: false,
          authenticated: false,
        })
      )
    ).not.toContain("groupId");
  });
});

describe("validateFreeSeat", () => {
  const guest = {
    name: "Ada",
    email: "ada@example.com",
    waiverAccepted: false,
    requiresWaiver: false,
    authenticated: false,
  };

  it("passes a complete guest submission", () => {
    expect(validateFreeSeat(guest)).toBeNull();
  });

  it("requires a name", () => {
    expect(validateFreeSeat({ ...guest, name: "   " })).toBe("Please enter your name.");
  });

  it("requires a valid email", () => {
    expect(validateFreeSeat({ ...guest, email: "" })).toBe("Please enter a valid email address.");
    expect(validateFreeSeat({ ...guest, email: "not-an-email" })).toBe(
      "Please enter a valid email address."
    );
  });

  it("requires the waiver when the chosen seat is in person", () => {
    expect(validateFreeSeat({ ...guest, requiresWaiver: true })).toBe(
      "Please accept the visitor waiver to register."
    );
    expect(validateFreeSeat({ ...guest, requiresWaiver: true, waiverAccepted: true })).toBeNull();
  });

  it("ignores name and email for a signed-in caller but still requires the waiver", () => {
    expect(
      validateFreeSeat({
        name: "",
        email: "",
        waiverAccepted: false,
        requiresWaiver: false,
        authenticated: true,
      })
    ).toBeNull();
    expect(
      validateFreeSeat({
        name: "",
        email: "",
        waiverAccepted: false,
        requiresWaiver: true,
        authenticated: true,
      })
    ).toBe("Please accept the visitor waiver to register.");
  });
});

describe("freeSeatSuccessCopy", () => {
  it("points a guest at their inbox for both the join link and the setup link", () => {
    expect(freeSeatSuccessCopy({ authenticated: false })).toEqual({
      message: "✓ You're in — check your email for the join link and your account setup link.",
      joinLink: null,
    });
  });

  it("never leaks a join link to an unverified guest email", () => {
    expect(
      freeSeatSuccessCopy({ authenticated: false, joinLink: "https://zoom.us/j/123" }).joinLink
    ).toBeNull();
  });

  it("shows the join link inline for a signed-in caller", () => {
    expect(freeSeatSuccessCopy({ authenticated: true, joinLink: "https://zoom.us/j/123" })).toEqual({
      message: "✓ You're in.",
      joinLink: "https://zoom.us/j/123",
    });
  });

  it("falls back to the short confirmation when there is no upcoming session link", () => {
    expect(freeSeatSuccessCopy({ authenticated: true })).toEqual({
      message: "✓ You're in.",
      joinLink: null,
    });
  });
});
