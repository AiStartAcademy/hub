import { describe, expect, it } from "bun:test";
import { plainTextToEmailHtml } from "@/lib/cohortMessages/render";

describe("cohort message plain-text email HTML", () => {
  it("plain-text→HTML: escapes HTML-sensitive characters exactly once", () => {
    expect(plainTextToEmailHtml(`& < > " '`)).toBe(
      "<p>&amp; &lt; &gt; &quot; &#39;</p>"
    );
  });

  it("plain-text→HTML: normalizes CRLF, preserves single line breaks, and splits blank-line paragraphs", () => {
    expect(
      plainTextToEmailHtml("\r\n \r\nFirst line\r\nsecond line\r\n\t\r\n\r\nThird\r\n \r\n")
    ).toBe("<p>First line<br>second line</p><p>Third</p>");
  });

  it("plain-text→HTML: autolinks only HTTP(S) URLs and excludes trailing punctuation", () => {
    expect(
      plainTextToEmailHtml(
        "Visit http://example.com/a. Then https://example.org/b), https://example.net/c!? Try https://example.edu/d; or https://example.io/e: javascript:alert(1) javascript:http://evil.example ftp://example.com."
      )
    ).toBe(
      '<p>Visit <a href="http://example.com/a">http://example.com/a</a>. Then <a href="https://example.org/b">https://example.org/b</a>), <a href="https://example.net/c">https://example.net/c</a>!? Try <a href="https://example.edu/d">https://example.edu/d</a>; or <a href="https://example.io/e">https://example.io/e</a>: javascript:alert(1) javascript:http://evil.example ftp://example.com.</p>'
    );
  });

  it("plain-text→HTML: keeps escaped ampersands valid in URL text and href without double-escaping", () => {
    expect(plainTextToEmailHtml("https://example.com/search?a=one&b=two")).toBe(
      '<p><a href="https://example.com/search?a=one&amp;b=two">https://example.com/search?a=one&amp;b=two</a></p>'
    );
  });

  it("plain-text→HTML: returns an empty string for empty or whitespace-only input", () => {
    expect(plainTextToEmailHtml("")).toBe("");
    expect(plainTextToEmailHtml(" \t\r\n\r\n  ")).toBe("");
  });
});
