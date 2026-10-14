import { describe, expect, it } from "bun:test";

import type { SelfPacedPageContent } from "@/config/content";
import { getSelfPacedSectionVisibility } from "@/lib/selfPacedSections";

type OptionalSections = Pick<
  SelfPacedPageContent,
  "stories" | "testimonial" | "stats" | "faq"
>;

describe("self-paced optional section visibility", () => {
  it("SC-1 hides stories, testimonial, stats, and FAQ when their content is empty", () => {
    const sections: OptionalSections = {
      stories: [],
      testimonial: null,
      stats: [],
      faq: [],
    };

    expect(getSelfPacedSectionVisibility(sections)).toEqual({
      stories: false,
      testimonial: false,
      stats: false,
      faq: false,
    });
  });

  it("SC-1 shows stories, testimonial, stats, and FAQ when their content exists", () => {
    const sections: OptionalSections = {
      stories: [{ text: "A learner shipped an automation." }],
      testimonial: { quote: "It worked.", attribution: "A learner" },
      stats: [{ value: "10", label: "projects shipped" }],
      faq: [{ question: "When can I start?", answer: "Any time." }],
    };

    expect(getSelfPacedSectionVisibility(sections)).toEqual({
      stories: true,
      testimonial: true,
      stats: true,
      faq: true,
    });
  });
});
