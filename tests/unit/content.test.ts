import { describe, expect, it } from "bun:test";
import {
  deriveUrl,
  isValidTemplate,
  parseJsonFields,
  serializeJsonFields,
} from "@/lib/content";

describe("isValidTemplate", () => {
  it("accepts the default template for a known type", () => {
    expect(isValidTemplate("BLOG", "default")).toBe(true);
    expect(isValidTemplate("LANDING", "default")).toBe(true);
  });

  it("rejects unknown templates", () => {
    expect(isValidTemplate("BLOG", "fancy")).toBe(false);
  });

  it("rejects unknown content types", () => {
    expect(isValidTemplate("PODCAST", "default")).toBe(false);
  });
});

describe("deriveUrl", () => {
  it("nests blog posts under /blog/", () => {
    expect(deriveUrl("BLOG", "hello-world")).toBe("/blog/hello-world/");
  });

  it("puts landing pages at the root", () => {
    expect(deriveUrl("LANDING", "pricing")).toBe("/pricing/");
  });

  it("strips leading and trailing slashes from the slug", () => {
    expect(deriveUrl("BLOG", "/hello/")).toBe("/blog/hello/");
  });
});

describe("serializeJsonFields / parseJsonFields", () => {
  it("serializes object-valued JSON fields to strings", () => {
    const out = serializeJsonFields({ sections: [{ a: 1 }], title: "x" });
    expect(out.sections).toBe('[{"a":1}]');
    expect(out.title).toBe("x");
  });

  it("leaves already-string fields untouched", () => {
    const out = serializeJsonFields({ faq: '["kept"]' });
    expect(out.faq).toBe('["kept"]');
  });

  it("round-trips through parseJsonFields", () => {
    const original = { sections: [{ a: 1 }], videos: ["v1"] };
    const stored = serializeJsonFields(original);
    expect(parseJsonFields(stored)).toEqual(original);
  });

  it("leaves invalid JSON strings as-is on parse", () => {
    const out = parseJsonFields({ sources: "not-json" });
    expect(out.sources).toBe("not-json");
  });
});
