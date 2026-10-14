import { describe, expect, test } from "bun:test";

import { demoOnboardingQuiz } from "@/lib/demoOnboardingQuiz";
import {
  normalizeRedirectUrl,
  normalizeSlug,
  parseAndValidateAnswers,
} from "@/lib/onboarding-security";

describe("demo onboarding quiz", () => {
  test("builds a stable, brand-neutral four-question ai-path form", () => {
    const quiz = demoOnboardingQuiz();
    const elements = quiz.steps.flatMap((step) => step.elements);
    const ids = [
      ...quiz.steps.map((step) => step.id),
      ...elements.map((element) => element.id),
      ...elements.flatMap((element) => element.options.map((option) => option.id)),
    ];

    expect(normalizeSlug(quiz.slug)).toBe("ai-path");
    expect(elements).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(demoOnboardingQuiz()).toEqual(quiz);
    const serialized = JSON.stringify(quiz).toLowerCase();
    expect(serialized).not.toContain(["ai", "start", "academy"].join(" "));
    expect(serialized).not.toContain(["ai", "sa"].join(""));
  });

  test("uses the engine's supported field types and answer validator", () => {
    const quiz = demoOnboardingQuiz();
    const elements = quiz.steps.flatMap((step) => step.elements);
    const answers = Object.fromEntries(
      elements.map((element) => [
        element.id,
        element.type === "text_multi" ? "A weekly reporting workflow" : element.options[0]!.id,
      ]),
    );

    expect(
      parseAndValidateAnswers(
        JSON.stringify({ answers }),
        elements.map(({ id, type, required, options }) => ({ id, type, required, options })),
      ),
    ).toEqual({ answers });
  });

  test("provides valid result routing with a safe fallback", () => {
    const quiz = demoOnboardingQuiz();
    const routingElement = quiz.steps
      .flatMap((step) => step.elements)
      .find((element) => element.id === quiz.routingElementId);

    expect(routingElement?.type).toBe("single_choice");
    expect(routingElement?.options.length).toBeGreaterThan(1);
    for (const option of routingElement?.options ?? []) {
      expect(normalizeRedirectUrl(option.redirectUrl)).toBe(option.redirectUrl);
    }
    expect(normalizeRedirectUrl(quiz.defaultRedirectUrl)).toBe(quiz.defaultRedirectUrl);
  });
});
