import { describe, expect, it } from "bun:test";
import { resolvePublicSlugIntent, type PublicSlugInput } from "@/lib/publicSlugIntent";

/** A slug-less, private instructor — the common starting state. */
function base(over: Partial<PublicSlugInput> = {}): PublicSlugInput {
  return {
    publicSlugProvided: false,
    storedVisibility: "PRIVATE",
    currentSlug: null,
    name: "Jordan Avery Example",
    email: "instructor@example.com",
    ...over,
  };
}

describe("resolvePublicSlugIntent — leaving the column alone", () => {
  it("does nothing when the request touches neither handle nor visibility", () => {
    expect(resolvePublicSlugIntent(base())).toEqual({ action: "leave" });
  });

  // The regression that motivated extracting this function: keying off the STORED
  // visibility meant an unrelated headline edit wrote a slug the preview never showed.
  it("does NOT generate a handle for an already-public user on an unrelated edit", () => {
    const intent = resolvePublicSlugIntent(
      base({ storedVisibility: "PUBLIC", currentSlug: null })
    );
    expect(intent).toEqual({ action: "leave" });
  });

  it("does not disturb a live handle when visibility is raised", () => {
    const intent = resolvePublicSlugIntent(
      base({ requestedVisibility: "PUBLIC", currentSlug: "existing-handle" })
    );
    expect(intent).toEqual({ action: "leave" });
  });

  it("does not generate a handle when visibility is lowered to PRIVATE", () => {
    const intent = resolvePublicSlugIntent(
      base({ storedVisibility: "PUBLIC", requestedVisibility: "PRIVATE" })
    );
    expect(intent).toEqual({ action: "leave" });
  });
});

describe("resolvePublicSlugIntent — auto-generating on publish", () => {
  it("generates from the name when this request makes the profile PUBLIC", () => {
    expect(resolvePublicSlugIntent(base({ requestedVisibility: "PUBLIC" }))).toEqual({
      action: "set",
      base: "Jordan Avery Example",
    });
  });

  // UNLISTED is publicly reachable too; the first version generated only for PUBLIC,
  // leaving UNLISTED profiles marked reachable at no address.
  it("generates for UNLISTED as well as PUBLIC", () => {
    expect(resolvePublicSlugIntent(base({ requestedVisibility: "UNLISTED" }))).toEqual({
      action: "set",
      base: "Jordan Avery Example",
    });
  });

  // slugify()'s fallback is the literal "cohort" — right for cohorts, absurd for a person.
  it("falls back to the email local-part when the name has no URL-safe characters", () => {
    const intent = resolvePublicSlugIntent(
      base({ requestedVisibility: "PUBLIC", name: "Преподаватель" })
    );
    expect(intent).toEqual({ action: "set", base: "instructor" });
  });

  it("refuses rather than inventing a handle when neither name nor email is usable", () => {
    const intent = resolvePublicSlugIntent(
      base({ requestedVisibility: "PUBLIC", name: "!!!", email: "!!!@example.com" })
    );
    expect(intent.action).toBe("refuse");
  });

  it("uses the email when the name is missing entirely", () => {
    expect(
      resolvePublicSlugIntent(base({ requestedVisibility: "PUBLIC", name: null }))
    ).toEqual({ action: "set", base: "instructor" });
  });
});

describe("resolvePublicSlugIntent — explicit handles", () => {
  it("sets the requested handle", () => {
    const intent = resolvePublicSlugIntent(
      base({ publicSlugProvided: true, publicSlug: "jordan-example" })
    );
    expect(intent).toEqual({ action: "set", base: "jordan-example" });
  });

  it("overrides an auto-generated handle when both are in play", () => {
    const intent = resolvePublicSlugIntent(
      base({
        publicSlugProvided: true,
        publicSlug: "jordan",
        requestedVisibility: "PUBLIC",
      })
    );
    expect(intent).toEqual({ action: "set", base: "jordan" });
  });

  it("trims surrounding whitespace", () => {
    const intent = resolvePublicSlugIntent(
      base({ publicSlugProvided: true, publicSlug: "  jordan-example  " })
    );
    expect(intent).toEqual({ action: "set", base: "jordan-example" });
  });

  it("refuses an empty or whitespace-only handle", () => {
    expect(
      resolvePublicSlugIntent(base({ publicSlugProvided: true, publicSlug: "" })).action
    ).toBe("refuse");
    expect(
      resolvePublicSlugIntent(base({ publicSlugProvided: true, publicSlug: "   " })).action
    ).toBe("refuse");
  });

  it("refuses a handle with no URL-safe characters instead of slugging it to 'cohort'", () => {
    const intent = resolvePublicSlugIntent(
      base({ publicSlugProvided: true, publicSlug: "!!!" })
    );
    expect(intent.action).toBe("refuse");
    if (intent.action === "refuse") expect(intent.reason).toContain("URL-safe");
  });
});

describe("resolvePublicSlugIntent — clearing a handle", () => {
  it("clears when the profile is and stays private", () => {
    const intent = resolvePublicSlugIntent(
      base({ publicSlugProvided: true, publicSlug: null, currentSlug: "jordan-example" })
    );
    expect(intent).toEqual({ action: "clear" });
  });

  it("refuses to clear while the profile is stored PUBLIC", () => {
    const intent = resolvePublicSlugIntent(
      base({
        publicSlugProvided: true,
        publicSlug: null,
        storedVisibility: "PUBLIC",
        currentSlug: "jordan-example",
      })
    );
    expect(intent.action).toBe("refuse");
  });

  it("refuses to clear while the same request is raising visibility to UNLISTED", () => {
    const intent = resolvePublicSlugIntent(
      base({
        publicSlugProvided: true,
        publicSlug: null,
        requestedVisibility: "UNLISTED",
        currentSlug: "jordan-example",
      })
    );
    expect(intent.action).toBe("refuse");
  });

  it("allows clearing when the same request also drops visibility to PRIVATE", () => {
    const intent = resolvePublicSlugIntent(
      base({
        publicSlugProvided: true,
        publicSlug: null,
        storedVisibility: "PUBLIC",
        requestedVisibility: "PRIVATE",
        currentSlug: "jordan-example",
      })
    );
    expect(intent).toEqual({ action: "clear" });
  });
});
