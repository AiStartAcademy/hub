import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { splitAgreementMarkdownAtSignatureBlock } = await import("@/lib/agreementDocument");
const { SIGNATURE_BLOCK_MARKER } = await import("@/lib/agreementTemplates");

describe("splitAgreementMarkdownAtSignatureBlock", () => {
  it("splits agreement markdown into the content before and after the signature block", () => {
    expect(
      splitAgreementMarkdownAtSignatureBlock(
        `Intro paragraph\n\n${SIGNATURE_BLOCK_MARKER}\n\nClosing paragraph`,
      ),
    ).toEqual(["Intro paragraph\n\n", "\n\nClosing paragraph"]);
  });

  it("throws when the agreement is missing the signature block marker", () => {
    expect(() => splitAgreementMarkdownAtSignatureBlock("No signature marker here")).toThrow(
      `Agreement must contain exactly one ${SIGNATURE_BLOCK_MARKER} marker; found 0`,
    );
  });

  it("throws when the agreement contains more than one signature block marker", () => {
    expect(() =>
      splitAgreementMarkdownAtSignatureBlock(
        `${SIGNATURE_BLOCK_MARKER}\nBody\n${SIGNATURE_BLOCK_MARKER}`,
      ),
    ).toThrow(
      `Agreement must contain exactly one ${SIGNATURE_BLOCK_MARKER} marker; found 2`,
    );
  });
});
