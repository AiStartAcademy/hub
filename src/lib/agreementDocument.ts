import { SIGNATURE_BLOCK_MARKER } from "@/lib/agreementTemplates";

export function splitAgreementMarkdownAtSignatureBlock(
  contentMd: string,
): readonly [string, string] {
  const segments = contentMd.split(SIGNATURE_BLOCK_MARKER);

  if (segments.length !== 2) {
    throw new Error(
      `Agreement must contain exactly one ${SIGNATURE_BLOCK_MARKER} marker; found ${segments.length - 1}`,
    );
  }

  return [segments[0], segments[1]] as const;
}
