import { brand } from "@/config/brand";
import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

const AISA_SIGNATURE_RELATIVE_PATH = brand.assets.signatureImage;
const AISA_SIGNATURE_FILE_PATH = path.join(process.cwd(), AISA_SIGNATURE_RELATIVE_PATH);

function loadAisaSignatureDataUri(filePath: string): string {
  try {
    const fileBuffer = readFileSync(filePath);
    return `data:image/png;base64,${fileBuffer.toString("base64")}`;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${brand.shortName} signature asset is missing or unreadable at ${filePath}: ${errorMessage}`,
    );
  }
}

// Privacy invariant: this signature never lives under /public and is never
// exposed by a static route; it is only inlined into token-gated pages and email.
const AISA_SIGNATURE_DATA_URI = loadAisaSignatureDataUri(AISA_SIGNATURE_FILE_PATH);

export function getAisaSignatureDataUri(): string {
  return AISA_SIGNATURE_DATA_URI;
}
