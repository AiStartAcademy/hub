import { describe, expect, it } from "bun:test";
import { htmlToText } from "@/lib/mailText";

describe("htmlToText", () => {
  it("SC1.1: renders an anchor as 'label (url)'", () => {
    expect(htmlToText('<p>Click <a href="https://x.com/a">here</a> now</p>')).toBe(
      "Click here (https://x.com/a) now"
    );
  });

  it("SC1.2: does not duplicate the URL when the label already is the URL", () => {
    expect(htmlToText('<a href="https://x.com/a">https://x.com/a</a>')).toBe("https://x.com/a");
  });

  it("SC1.3: keeps a bare anchor with no href as plain text", () => {
    expect(htmlToText("<a>no link</a>")).toBe("no link");
  });

  it("SC1.4: turns list items into their own lines", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li><li>Three</li></ul>")).toBe("One\nTwo\nThree");
  });

  it("SC1.5: breaks lines on br, p, div and headings", () => {
    expect(htmlToText("<h1>Title</h1><p>First</p><div>Second</div>Third<br>Fourth")).toBe(
      "Title\nFirst\nSecond\nThird\nFourth"
    );
  });

  it("SC1.6: decodes named and numeric entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;b&gt; &quot;q&quot; &#39;s&#39;&nbsp;end &#8212;</p>")).toBe(
      'Tom & Jerry <b> "q" \'s\' end —'
    );
  });

  it("SC1.6b: decodes the typographic entities authored campaign bodies carry", () => {
    // Regression: these leaked through as literal "&mdash;" into the text part,
    // which is the sloppy signal the plain-text part exists to avoid.
    expect(
      htmlToText("<p>Oct 5 &ndash; Oct 23 &middot; $150 &mdash; seats&hellip;</p>")
    ).toBe("Oct 5 – Oct 23 · $150 — seats…");
    expect(htmlToText("<p>&ldquo;Lex&rsquo;s take&rdquo; &bull; 20&deg;</p>")).toBe(
      "“Lex’s take” • 20°"
    );
  });

  it("SC1.6c: leaves an unknown entity verbatim rather than guessing", () => {
    expect(htmlToText("<p>a &notareal; b</p>")).toBe("a &notareal; b");
  });

  it("SC1.7: drops style, script and head content entirely", () => {
    const html = `<!DOCTYPE html><html><head><title>T</title><style>body{color:red}</style></head>
      <body><script>alert("x")</script><p>Visible</p></body></html>`;
    expect(htmlToText(html)).toBe("Visible");
  });

  it("SC1.8: collapses runs of whitespace and blank lines, and trims", () => {
    expect(htmlToText("  <p>  a    b  </p>\n\n\n<p></p>\n<p>c</p>   ")).toBe("a b\nc");
  });

  it("SC1.9: returns an empty string for empty or markup-only input", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<div><span></span></div>")).toBe("");
  });

  it("SC1.10: renders a realistic button + fallback-link email to readable text", () => {
    const html = `
      <div><h2>Confirm your email</h2>
      <p>Thanks for registering!</p>
      <a href="https://hub.example.com/verify?token=abc">Verify my email</a>
      <p>Or copy this link:</p>
      <a href="https://hub.example.com/verify?token=abc">https://hub.example.com/verify?token=abc</a>
      </div>`;
    expect(htmlToText(html)).toBe(
      [
        "Confirm your email",
        "Thanks for registering!",
        "Verify my email (https://hub.example.com/verify?token=abc)",
        "Or copy this link:",
        "https://hub.example.com/verify?token=abc",
      ].join("\n")
    );
  });
});
