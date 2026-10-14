import { describe, expect, it } from "bun:test";

import { renderTypedSignatureSvg } from "@/lib/signatureSvg";

describe("renderTypedSignatureSvg", () => {
  it("renders deterministic SVG output for the same input", () => {
    const signature = renderTypedSignatureSvg("Morgan Lee");

    expect(signature).toBe(renderTypedSignatureSvg("Morgan Lee"));
    expect(signature).toContain('font-family="&quot;Dancing Script&quot;, &quot;Snell Roundhand&quot;, &quot;Savoye LET&quot;, &quot;Brush Script MT&quot;, cursive"');
    expect(signature).toContain('font-style="italic"');
  });

  it("escapes XML-sensitive characters in the typed name", () => {
    const signature = renderTypedSignatureSvg(`Morgan & <Lee> "O'Neil"`);

    expect(signature).toContain("Morgan &amp; &lt;Lee&gt; &quot;O&#39;Neil&quot;");
    expect(signature).not.toContain(`Morgan & <Lee> "O'Neil"`);
  });

  it("rejects blank or too-long names", () => {
    expect(() => renderTypedSignatureSvg("   ")).toThrow(
      "Typed signature name must not be empty",
    );
    expect(() => renderTypedSignatureSvg("a".repeat(121))).toThrow(
      "Typed signature name must be 120 characters or fewer",
    );
  });

  it("grows the SVG width for longer names", () => {
    const shortSignature = renderTypedSignatureSvg("Ada");
    const longSignature = renderTypedSignatureSvg("Alexandria Catherine Montgomery");

    expect(shortSignature).toContain('width="320"');
    expect(longSignature).toContain('width="684"');
  });
});
