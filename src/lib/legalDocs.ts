// src/lib/legalDocs.ts
//
// Registry of the legal documents a student must accept before reaching course
// content. Generalises the single-document pattern in src/lib/waiver.ts.
//
// Versioning contract: the text lives in src/content/legal/*.md and the version is a
// constant here. Bumping a version re-prompts every user for THAT document only —
// UserConsent rows are unique on (userId, docKey, version), so old acceptances are
// preserved rather than overwritten. Never edit a published document's text without
// bumping its version; the version string is the only record of what someone agreed to.
import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { renderBrandTokens } from "@/lib/brandTokens";
import { WAIVER_VERSION } from "@/lib/waiver";

export type LegalDocKey =
  | "tos"
  | "privacy"
  | "conduct"
  | "recording"
  | "ai-ip"
  | "waiver";

export interface LegalDoc {
  key: LegalDocKey;
  title: string;
  /** One-line plain-English summary shown above the fold on the consent page. */
  summary: string;
  version: string;
  file: string;
  /**
   * "always"   — every student must accept it.
   * "inPerson" — only when the student's cohort meets in person (INPERSON | HYBRID).
   */
  applies: "always" | "inPerson";
}

const LEGAL_DIR = path.join(process.cwd(), "src/content/legal");

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  tos: {
    key: "tos",
    title: "Terms of Service",
    summary:
      "How enrollment works, what your seat includes, refunds and transfers, and what you can do with our materials.",
    version: "2026-08-v1",
    file: "terms-of-service.md",
    applies: "always",
  },
  privacy: {
    key: "privacy",
    title: "Privacy Policy",
    summary:
      "What we collect, who sees it, how long we keep it, and how to access, correct, or delete it.",
    version: "2026-08-v1",
    file: "privacy-policy.md",
    applies: "always",
  },
  conduct: {
    key: "conduct",
    title: "Community and Acceptable Use",
    summary:
      "How we treat each other, and the rule that what a classmate shares about their business stays in the room.",
    version: "2026-08-v1",
    file: "community-conduct.md",
    applies: "always",
  },
  recording: {
    key: "recording",
    title: "Recording and Media Release",
    summary:
      "Sessions are recorded — that part is required. Letting us use your face in public marketing is a separate, optional yes.",
    version: "2026-08-v1",
    file: "recording-media-release.md",
    applies: "always",
  },
  "ai-ip": {
    key: "ai-ip",
    title: "AI Tools, Data, and Intellectual Property",
    summary:
      "You own what you build. Here's what you agree not to paste into an AI tool, and what stays ours.",
    version: "2026-08-v1",
    file: "ai-tools-data-ip.md",
    applies: "always",
  },
  waiver: {
    key: "waiver",
    title: "Visitor Waiver",
    // Version is imported, not restated: the venue-event and free-cohort waiver gates
    // already key off WAIVER_VERSION, and two sources would silently drift.
    summary:
      "Required for in-person cohorts — assumption of risk and release for visits to the SF venue.",
    version: WAIVER_VERSION,
    file: "visitor-waiver.md",
    applies: "inPerson",
  },
};

export const LEGAL_DOC_KEYS = Object.keys(LEGAL_DOCS) as LegalDocKey[];

export function isLegalDocKey(value: unknown): value is LegalDocKey {
  return typeof value === "string" && value in LEGAL_DOCS;
}

// Read once at module load, like waiver.ts — these files ship with the container and
// never change at runtime, so a per-request read would be pure I/O for nothing.
const MARKDOWN_CACHE: Record<LegalDocKey, string> = LEGAL_DOC_KEYS.reduce(
  (acc, key) => {
    acc[key] = renderBrandTokens(
      readFileSync(path.join(LEGAL_DIR, LEGAL_DOCS[key].file), "utf8"),
      LEGAL_DOCS[key].file,
    );
    return acc;
  },
  {} as Record<LegalDocKey, string>
);

export function getLegalDocMarkdown(key: LegalDocKey): string {
  return MARKDOWN_CACHE[key];
}

/**
 * The documents a student in this situation must accept.
 *
 * `inPerson` is true when ANY cohort they're enrolled in meets in person — a student
 * in one online and one hybrid cohort still walks into the building.
 */
export function requiredDocsFor({ inPerson }: { inPerson: boolean }): LegalDocKey[] {
  return LEGAL_DOC_KEYS.filter(
    (key) => LEGAL_DOCS[key].applies === "always" || inPerson
  );
}

/** Current version of every document, for diffing against stored acceptances. */
export function currentVersions(): Record<LegalDocKey, string> {
  return LEGAL_DOC_KEYS.reduce(
    (acc, key) => {
      acc[key] = LEGAL_DOCS[key].version;
      return acc;
    },
    {} as Record<LegalDocKey, string>
  );
}
