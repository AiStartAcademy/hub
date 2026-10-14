import { describe, expect, it } from "bun:test";
import { sanitizeEmailHtml } from "@/lib/outreach/sanitizeHtml";

describe("sanitizeEmailHtml", () => {
  it("removes executable and embedded document elements with their contents", () => {
    const html = sanitizeEmailHtml(
      "<p>Keep</p><script>alert(1)</script><style>p{display:none}</style>" +
        '<iframe src="https://evil.test">frame text</iframe><p>Safe</p>'
    );

    expect(html).toBe("<p>Keep</p><p>Safe</p>");
  });

  it("strips event-handler attributes", () => {
    const html = sanitizeEmailHtml(
      '<p onclick="alert(1)">Hello <img src="https://example.com/x.png" ONERROR="alert(2)" /></p>'
    );

    expect(html).toContain("<p>Hello ");
    expect(html).toContain('src="https://example.com/x.png"');
    expect(html.toLowerCase()).not.toContain("onclick");
    expect(html.toLowerCase()).not.toContain("onerror");
  });

  it("strips javascript hrefs regardless of case or embedded whitespace", () => {
    const html = sanitizeEmailHtml(
      '<a href="JaVaScRiPt:alert(1)">mixed</a>' +
        '<a href="java\nscript:alert(2)">newline</a>' +
        '<a href="java\tscript:alert(3)">tab</a>'
    );

    expect(html).not.toMatch(/href=/i);
    expect(html).toContain(">mixed</a>");
    expect(html).toContain(">newline</a>");
    expect(html).toContain(">tab</a>");
  });

  it("preserves text nested in unknown tags", () => {
    expect(sanitizeEmailHtml("<custom-box>Keep <mystery>this text</mystery></custom-box>"))
      .toBe("Keep this text");
  });

  it("passes allowlisted markup and safe attributes through", () => {
    const input =
      '<p><strong>Bold</strong> and <em>emphasis</em><br />' +
      '<a href="https://example.com/path" title="Read">link</a></p>' +
      '<ul><li>One</li></ul>';
    const html = sanitizeEmailHtml(input);

    expect(html).toContain("<p><strong>Bold</strong> and <em>emphasis</em><br />");
    expect(html).toContain(
      '<a href="https://example.com/path" title="Read" rel="noopener noreferrer">link</a>'
    );
    expect(html).toContain("<ul><li>One</li></ul>");
  });
});
