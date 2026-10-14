import { describe, expect, it } from "bun:test";
import {
  deriveStepSlug,
  firstBlockingStep,
  normalizeStepSlug,
  parse,
  reconcileHistory,
  resolveEntryStep,
  seedHistory,
  serialize,
  type OnboardingStepParamForm,
} from "@/app/onboarding/[slug]/onboardingStepParams";

const form: OnboardingStepParamForm = {
  id: "form-1",
  steps: [
    {
      id: "intro",
      formId: "form-1",
      slug: "welcome",
      order: 0,
      elements: [{ id: "name", required: true }],
    },
    {
      id: "goals",
      formId: "form-1",
      slug: "2",
      order: 1,
      elements: [
        { id: "optional-context", required: false },
        { id: "goal", required: true },
      ],
    },
    {
      id: "contact",
      formId: "form-1",
      slug: "contact-details",
      order: 2,
      elements: [{ id: "email", required: true }],
    },
  ],
};

describe("onboarding step params", () => {
  it("SC3.1: resolves a form-owned slug before a 1-based numeric position and falls back safely", () => {
    expect(resolveEntryStep(form, "contact-details")?.id).toBe("contact");
    expect(resolveEntryStep(form, "2")?.id).toBe("goals");
    expect(resolveEntryStep(form, "3")?.id).toBe("contact");
    expect(resolveEntryStep(form, "missing")?.id).toBe("intro");
    expect(resolveEntryStep(form, "")?.id).toBe("intro");
    expect(resolveEntryStep(form, "0")?.id).toBe("intro");
    expect(resolveEntryStep(form, "../../admin")?.id).toBe("intro");
    expect(resolveEntryStep(form, "x".repeat(1_000))?.id).toBe("intro");
    expect(resolveEntryStep({ ...form, steps: [] }, "1")).toBeNull();
  });

  it("SC3.2: seeds history with the linear prefix of form-owned step ids, excluding the target", () => {
    expect(seedHistory(form, form.steps[2])).toEqual(["intro", "goals"]);
    expect(seedHistory(form, form.steps[0])).toEqual([]);
    expect(
      seedHistory(form, {
        id: "foreign",
        formId: "form-2",
        slug: "foreign",
        order: 0,
        elements: [],
      })
    ).toEqual([]);
  });

  it("SC3.3: finds the earliest skipped step with an unanswered required element", () => {
    expect(firstBlockingStep(form, form.steps[2], {})).toBe(form.steps[0]);
    expect(firstBlockingStep(form, form.steps[2], { name: "Ada" })).toBe(form.steps[1]);
    expect(
      firstBlockingStep(form, form.steps[2], { name: "Ada", goal: ["learn"] })
    ).toBeNull();
    expect(
      firstBlockingStep(form, form.steps[2], { name: "   ", goal: [] })
    ).toBe(form.steps[0]);
    expect(firstBlockingStep(form, form.steps[0], {})).toBeNull();
  });

  it("SC3.4: derives stable URL-safe slugs with per-form suffixes and a fallback", () => {
    expect(deriveStepSlug("  Pick Your AI Goal!  ", [])).toBe("pick-your-ai-goal");
    expect(deriveStepSlug("Pick Your AI Goal!", ["pick-your-ai-goal"])).toBe(
      "pick-your-ai-goal-2"
    );
    expect(
      deriveStepSlug("Pick Your AI Goal!", ["pick-your-ai-goal", "pick-your-ai-goal-2"])
    ).toBe("pick-your-ai-goal-3");
    expect(deriveStepSlug("Same Title", [])).toBe(deriveStepSlug("Same Title", []));
    expect(deriveStepSlug("🚀🚀", [])).toBe("step");
    expect(deriveStepSlug("日本語", ["step"])).toBe("step-2");
  });

  it("normalizes admin-entered step slugs and caps them at 80 characters", () => {
    expect(normalizeStepSlug("  Pick Your AI Goal!  ")).toBe("pick-your-ai-goal");
    expect(normalizeStepSlug("Déjà___Vu")).toBe("deja-vu");
    expect(normalizeStepSlug("---Already---Kebab---")).toBe("already-kebab");
    expect(normalizeStepSlug("x".repeat(100))).toBe("x".repeat(80));
    expect(normalizeStepSlug("   ")).toBeNull();
    expect(normalizeStepSlug("🚀🚀")).toBeNull();
  });

  it("SC4.1: round-trips validated step state and omits empty or unsafe state", () => {
    const serialized = serialize({ step: "contact-details" });
    expect(serialized.toString()).toBe("step=contact-details");
    expect(parse(serialized)).toEqual({ step: "contact-details" });
    expect(serialize({}).toString()).toBe("");
    expect(parse(new URLSearchParams("step=../../admin"))).toEqual({});
    expect(parse(new URLSearchParams(`step=${"x".repeat(1_000)}`))).toEqual({});
    expect(parse(new URLSearchParams("step=welcome&step=contact-details"))).toEqual({});
  });

  it("SC4.2: pops history for browser back and pushes other incoming steps", () => {
    expect(reconcileHistory(["intro", "goals"], "goals")).toEqual(["intro"]);
    expect(reconcileHistory(["intro", "goals"], "contact")).toEqual([
      "intro",
      "goals",
      "contact",
    ]);
    expect(reconcileHistory([], "intro")).toEqual(["intro"]);
  });
});

describe("submitBlockingStep", () => {
  it("SC3.6: deep-linked sessions are walked back at submit time to the first step with an unanswered required element", async () => {
    const { submitBlockingStep } = await import("@/app/onboarding/[slug]/onboardingStepParams");
    const form = {
      id: "form-1",
      steps: [
        { id: "s1", formId: "form-1", slug: "about", order: 0, elements: [{ id: "name", required: true }] },
        { id: "s2", formId: "form-1", slug: "goals", order: 1, elements: [{ id: "goal", required: false }] },
        { id: "s3", formId: "form-1", slug: "contact", order: 2, elements: [{ id: "email", required: true }] },
      ],
    };
    expect(submitBlockingStep(form, {})?.id).toBe("s1");
    expect(submitBlockingStep(form, { name: "Ada" })?.id).toBe("s3");
    expect(submitBlockingStep(form, { name: "Ada", email: "a@b.co" })).toBeNull();
  });
});

describe("stepParamFor", () => {
  it("SC4.3: the param written for a step resolves back to that same step (round-trip), including non-contiguous order values and slugless steps", async () => {
    const { stepParamFor, resolveEntryStep } = await import(
      "@/app/onboarding/[slug]/onboardingStepParams"
    );
    // Orders are 0-based here and non-contiguous after builder edits — the
    // param must be a position, never the raw order value.
    const form = {
      id: "form-1",
      steps: [
        { id: "s1", formId: "form-1", slug: null, order: 0, elements: [] },
        { id: "s2", formId: "form-1", slug: null, order: 7, elements: [] },
        { id: "s3", formId: "form-1", slug: "contact", order: 9, elements: [] },
      ],
    };
    for (const step of form.steps) {
      expect(resolveEntryStep(form, stepParamFor(form, step))?.id).toBe(step.id);
    }
    expect(stepParamFor(form, form.steps[0])).toBe("1");
    expect(stepParamFor(form, form.steps[1])).toBe("2");
    expect(stepParamFor(form, form.steps[2])).toBe("contact");
  });
});
