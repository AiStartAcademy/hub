import { describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

mock.module("server-only", () => ({}));

const { LEGAL_DOCS, LEGAL_DOC_KEYS, getLegalDocMarkdown, isLegalDocKey, requiredDocsFor } =
  await import("@/lib/legalDocs");
const { WAIVER_VERSION } = await import("@/lib/waiver");
const { renderLegalMarkdown } = await import("@/lib/legalMarkdown");

describe("legal document registry", () => {
  it("has readable markdown behind every key", () => {
    for (const key of LEGAL_DOC_KEYS) {
      expect(getLegalDocMarkdown(key).length).toBeGreaterThan(500);
    }
  });

  it("gives every document a version", () => {
    for (const key of LEGAL_DOC_KEYS) {
      expect(LEGAL_DOCS[key].version).toMatch(/^\d{4}-\d{2}-v\d+$/);
    }
  });

  it("keeps the waiver version in lockstep with the venue waiver gates", () => {
    // Two sources for this string would let the student gate and the venue-event gate
    // disagree about which waiver text is in force.
    expect(LEGAL_DOCS.waiver.version).toBe(WAIVER_VERSION);
  });

  it("rejects unknown keys", () => {
    expect(isLegalDocKey("tos")).toBe(true);
    expect(isLegalDocKey("../../etc/passwd")).toBe(false);
    expect(isLegalDocKey(undefined)).toBe(false);
  });

  it("SC-3 keeps venue jurisdiction prose in brand tokens", () => {
    const legalDir = path.join(import.meta.dir, "..", "..", "src", "content", "legal");
    for (const file of ["terms-of-service.md", "visitor-waiver.md"]) {
      const source = readFileSync(path.join(legalDir, file), "utf8");
      expect(source).not.toContain("California law");
      expect(source).not.toContain("San Francisco County");
    }
  });
});

describe("requiredDocsFor", () => {
  it("omits the visitor waiver for online-only students", () => {
    const docs = requiredDocsFor({ inPerson: false });
    expect(docs).not.toContain("waiver");
    expect(docs).toContain("tos");
    expect(docs).toContain("recording");
    expect(docs.length).toBe(LEGAL_DOC_KEYS.length - 1);
  });

  it("requires the visitor waiver once any cohort meets in person", () => {
    expect(requiredDocsFor({ inPerson: true })).toContain("waiver");
    expect(requiredDocsFor({ inPerson: true }).length).toBe(LEGAL_DOC_KEYS.length);
  });
});

describe("renderLegalMarkdown", () => {
  it("escapes markup rather than emitting it", () => {
    const html = renderLegalMarkdown("Hello <script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings, both list kinds, rules, bold and italic", () => {
    const html = renderLegalMarkdown(
      ["## Heading", "", "- one", "- two", "", "1. first", "2. second", "", "---", "", "**b** and *i*"].join(
        "\n"
      )
    );
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<hr />");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
  });

  it("strips the DRAFT provenance comments from the source files", () => {
    const html = renderLegalMarkdown(getLegalDocMarkdown("tos"));
    expect(html).not.toContain("DRAFT — pending legal review");
    expect(html).not.toContain("&lt;!--");
  });

  it("does not mangle bold into nested italics", () => {
    expect(renderLegalMarkdown("**bold**")).toBe("<p><strong>bold</strong></p>");
  });
});
