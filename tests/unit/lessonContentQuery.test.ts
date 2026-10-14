import { describe, expect, it } from "bun:test";
import {
  buildLessonListWhere,
  deriveHasContent,
  fillsOnlyEmptyFields,
  parseMissingFilter,
} from "@/lib/lessonContentQuery";

describe("parseMissingFilter", () => {
  it("SC-1: defaults a missing query parameter to the content filter", () => {
    expect(parseMissingFilter(null)).toBe("content");
  });

  it("SC-2: parses the poster filter", () => {
    expect(parseMissingFilter("poster")).toBe("poster");
  });

  it("SC-3: parses the content filter", () => {
    expect(parseMissingFilter("content")).toBe("content");
  });

  it("SC-4: rejects unsupported filters", () => {
    expect(() => parseMissingFilter("bogus")).toThrow(
      'missing must be one of: "poster", "content"'
    );
  });
});

describe("buildLessonListWhere", () => {
  it("SC-5: finds Zoom lessons whose poster URL is null or empty", () => {
    expect(buildLessonListWhere("poster")).toEqual({
      zoomFileId: { not: null },
      OR: [{ posterUrl: null }, { posterUrl: "" }],
    });
  });

  it("SC-6: preserves the Zoom lesson tags-empty content filter", () => {
    expect(buildLessonListWhere("content")).toEqual({
      zoomFileId: { not: null },
      OR: [{ tags: null }, { tags: "" }],
    });
  });
});

describe("fillsOnlyEmptyFields", () => {
  const enriched = {
    name: "Multi-Agent Systems",
    intro: "An intro",
    text: "A transcript",
    tags: "agents, claude",
    timecodes: null,
    posterUrl: null,
    audioUrl: "https://example.com/a.mp3",
    captionsUrl: "",
  };

  it("SC-8: exempts a poster-only write onto a lesson whose poster is empty", () => {
    expect(fillsOnlyEmptyFields({ posterUrl: "https://x/p.png" }, enriched)).toBe(true);
    expect(fillsOnlyEmptyFields({ captionsUrl: "https://x/c.vtt" }, enriched)).toBe(true);
  });

  it("SC-9: refuses a write that would overwrite a field that already has a value", () => {
    expect(fillsOnlyEmptyFields({ posterUrl: "https://x/p.png", tags: "new" }, enriched)).toBe(
      false
    );
    expect(fillsOnlyEmptyFields({ audioUrl: "https://x/a.mp3" }, enriched)).toBe(false);
    expect(fillsOnlyEmptyFields({ name: "Renamed" }, enriched)).toBe(false);
  });

  it("SC-10: treats a whitespace-only current value as empty", () => {
    expect(fillsOnlyEmptyFields({ intro: "new" }, { ...enriched, intro: "   " })).toBe(true);
  });

  it("SC-11: refuses a write that carries no content fields at all", () => {
    expect(fillsOnlyEmptyFields({}, enriched)).toBe(false);
  });
});

describe("deriveHasContent", () => {
  it("SC-7: identifies only non-empty trimmed tags as content", () => {
    expect(deriveHasContent("ai, automation")).toBe(true);
    expect(deriveHasContent(null)).toBe(false);
    expect(deriveHasContent("")).toBe(false);
    expect(deriveHasContent("   ")).toBe(false);
  });
});
