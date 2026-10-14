import { describe, expect, it } from "bun:test";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(slugify("A  --  B")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  !Hello!  ")).toBe("hello");
  });

  it("caps length at 80 characters", () => {
    expect(slugify("a".repeat(200))).toHaveLength(80);
  });

  it("falls back to 'cohort' when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("cohort");
    expect(slugify("")).toBe("cohort");
  });
});
