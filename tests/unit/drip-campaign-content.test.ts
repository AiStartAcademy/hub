import { describe, expect, test } from "bun:test";

import { renderScholarshipCopy } from "@/lib/drip/campaigns";

describe("seed drip campaign content", () => {
  test("omits scholarship copy when no scholarships are offered", () => {
    const sentence = "We hold two full scholarships per cohort.";

    expect(renderScholarshipCopy(0, sentence)).toBe("");
    expect(renderScholarshipCopy(undefined, sentence)).toBe("");
    expect(renderScholarshipCopy(2, sentence)).toBe(sentence);
    expect(renderScholarshipCopy(0, sentence)).not.toContain("scholarships per cohort");
  });
});
