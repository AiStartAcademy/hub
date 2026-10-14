import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const {
  parseAgenda,
  parseFaq,
  parseGallery,
  parseHosts,
  parsePricingTiers,
  groupAgendaByDay,
  serializeGallery,
  serializeHosts,
  serializePricingTiers,
  youTubeEmbedUrl,
  youTubeIdFromUrl,
  normalizeVideoUrl,
} = await import("@/lib/venueEventContent");

describe("parsers tolerate junk", () => {
  it("returns [] for malformed JSON, non-arrays, null and undefined", () => {
    for (const parse of [parseGallery, parseAgenda, parseHosts, parsePricingTiers, parseFaq]) {
      expect(parse("{not json")).toEqual([]);
      expect(parse('{"a":1}')).toEqual([]);
      expect(parse(null)).toEqual([]);
      expect(parse(undefined)).toEqual([]);
      expect(parse("")).toEqual([]);
      expect(parse(42)).toEqual([]);
    }
  });

  it("accepts an already-parsed array as well as a JSON string", () => {
    expect(parseGallery([{ url: "https://x.test/a.jpg" }])).toEqual([
      { url: "https://x.test/a.jpg" },
    ]);
    expect(parseGallery('[{"url":"https://x.test/a.jpg"}]')).toEqual([
      { url: "https://x.test/a.jpg" },
    ]);
  });

  it("drops entries missing their required field but keeps the valid ones", () => {
    expect(parseGallery([{ alt: "no url" }, { url: "https://x.test/a.jpg" }])).toHaveLength(1);
    expect(parseAgenda([{ note: "no title" }, { title: "Kickoff" }])).toHaveLength(1);
    expect(parseHosts([{ role: "no name" }, { name: "Lex" }])).toHaveLength(1);
    expect(parseFaq([{ q: "no answer" }, { q: "Q", a: "A" }])).toHaveLength(1);
  });
});

describe("url validation", () => {
  it("rejects javascript: and data: URLs so they can't reach href or img src", () => {
    expect(parseGallery([{ url: "javascript:alert(1)" }])).toEqual([]);
    expect(parseGallery([{ url: "data:image/png;base64,AAA" }])).toEqual([]);
    expect(parseHosts([{ name: "X", photoUrl: "javascript:alert(1)" }])[0].photoUrl).toBeUndefined();
  });

  it("accepts https and site-relative URLs", () => {
    expect(parseGallery([{ url: "/api/media/previews/a.jpg" }])[0].url).toBe(
      "/api/media/previews/a.jpg"
    );
    expect(parseGallery([{ url: "https://x.test/a.jpg" }])[0].url).toBe("https://x.test/a.jpg");
  });
});

describe("pricing tiers", () => {
  it("requires a numeric priceCents and rounds/clamps it", () => {
    expect(parsePricingTiers([{ label: "Early", priceCents: "595" }])).toEqual([]);
    expect(parsePricingTiers([{ label: "Early", priceCents: 59500.4 }])[0].priceCents).toBe(59500);
    expect(parsePricingTiers([{ label: "Free", priceCents: -5 }])[0].priceCents).toBe(0);
  });

  it("keeps a zero-price tier — free is a real price, not a missing one", () => {
    expect(parsePricingTiers([{ label: "Community", priceCents: 0 }])).toHaveLength(1);
  });
});

describe("serializers", () => {
  it("return null when nothing valid survives, so the column clears", () => {
    expect(serializeGallery([{ alt: "no url" }])).toBeNull();
    expect(serializeHosts([])).toBeNull();
    expect(serializePricingTiers("garbage")).toBeNull();
  });

  it("round-trip through the parser is stable", () => {
    const tiers = [{ label: "Early bird", priceCents: 59500, note: "Until Aug 31" }];
    const serialized = serializePricingTiers(tiers);
    expect(parsePricingTiers(serialized)).toEqual(tiers);
  });

  it("drops undefined keys rather than emitting nulls", () => {
    expect(serializeGallery([{ url: "https://x.test/a.jpg" }])).toBe(
      '[{"url":"https://x.test/a.jpg"}]'
    );
  });
});

describe("groupAgendaByDay", () => {
  it("splits a two-day agenda into two groups in authored order", () => {
    const groups = groupAgendaByDay(
      parseAgenda([
        { date: "2026-09-12", title: "Story" },
        { date: "2026-09-12", title: "Shoot" },
        { date: "2026-09-13", title: "Edit" },
        { date: "2026-09-13", title: "Screening", isPublic: true },
      ])
    );
    expect(groups.map((group) => group.date)).toEqual(["2026-09-12", "2026-09-13"]);
    expect(groups[1].items[1].isPublic).toBe(true);
  });

  it("keeps undated items in a single group", () => {
    const groups = groupAgendaByDay(parseAgenda([{ title: "Doors" }, { title: "Quiz" }]));
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBeUndefined();
  });
});

describe("youTubeIdFromUrl", () => {
  it("extracts the id from every shape people actually paste", () => {
    for (const input of [
      "https://www.youtube.com/watch?v=_TsOoo3Dbrk",
      "https://youtu.be/_TsOoo3Dbrk",
      "https://www.youtube.com/shorts/_TsOoo3Dbrk",
      "https://www.youtube.com/embed/_TsOoo3Dbrk",
      "https://www.youtube.com/live/_TsOoo3Dbrk",
      "https://m.youtube.com/watch?v=_TsOoo3Dbrk&t=90s",
      "_TsOoo3Dbrk",
    ]) {
      expect(youTubeIdFromUrl(input)).toBe("_TsOoo3Dbrk");
    }
  });

  it("returns null for non-YouTube and malformed URLs", () => {
    expect(youTubeIdFromUrl("https://vimeo.com/12345")).toBeNull();
    expect(youTubeIdFromUrl("https://evil.test/watch?v=_TsOoo3Dbrk")).toBeNull();
    expect(youTubeIdFromUrl("not a url")).toBeNull();
    expect(youTubeIdFromUrl(null)).toBeNull();
  });

  it("normalizeVideoUrl refuses anything the player can't embed", () => {
    // The stored value must always match what renders, so a URL that would
    // never produce an iframe is rejected at the write boundary rather than
    // silently persisted.
    expect(() => normalizeVideoUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeVideoUrl("data:text/html,<script>")).toThrow();
    expect(() => normalizeVideoUrl("https://vimeo.com/12345")).toThrow();
    expect(() => normalizeVideoUrl("https://evil.test/watch?v=_TsOoo3Dbrk")).toThrow();
  });

  it("normalizeVideoUrl passes YouTube through and treats empty as a clear", () => {
    expect(normalizeVideoUrl("https://youtu.be/_TsOoo3Dbrk")).toBe(
      "https://youtu.be/_TsOoo3Dbrk"
    );
    expect(normalizeVideoUrl(null)).toBeNull();
    expect(normalizeVideoUrl(undefined)).toBeNull();
    expect(normalizeVideoUrl("   ")).toBeNull();
  });

  it("builds a nocookie embed URL", () => {
    expect(youTubeEmbedUrl("https://youtu.be/_TsOoo3Dbrk")).toBe(
      "https://www.youtube-nocookie.com/embed/_TsOoo3Dbrk"
    );
    expect(youTubeEmbedUrl("https://vimeo.com/1")).toBeNull();
  });
});
