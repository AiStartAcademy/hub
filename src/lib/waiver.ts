import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { renderBrandTokens } from "@/lib/brandTokens";

export const WAIVER_VERSION = "2026-08-v1";

const WAIVER_PATH = path.join(process.cwd(), "src/content/legal/visitor-waiver.md");

// DRAFT — pending legal review.
const VISITOR_WAIVER_MARKDOWN = renderBrandTokens(readFileSync(WAIVER_PATH, "utf8"), WAIVER_PATH);

export function getVisitorWaiverMarkdown(): string {
  return VISITOR_WAIVER_MARKDOWN;
}
