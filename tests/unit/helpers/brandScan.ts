// Shared file scanner for the brand-leak tests.
//
// brand-config.test.ts scans for terms derived from the CURRENT brand (so it is
// meaningful in any fork); brand-aisa.test.ts scans for the upstream academy's
// literal terms. Both walk the same file set defined here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");

/** Directories scanned recursively, repo-relative. */
export const SCANNED_DIRS = [
  "src",
  "certificate-templates",
  "scripts/call-transcripts",
  "tests/unit",
] as const;

/** Individual files scanned, repo-relative. */
export const SCANNED_FILES = [
  "prisma/schema.prisma",
  "scripts/seed-drip-campaigns.ts",
  "Dockerfile",
  "docker-compose.yml",
] as const;

/**
 * Files allowed to name the brand: the brand module itself and the private
 * parity test that pins the upstream values (excluded from public exports).
 */
export const SCAN_EXCLUDED_FILES = new Set<string>([
  "src/config/brand.ts",
  "src/config/content.ts",
  "tests/unit/brand-aisa.test.ts",
  "tests/unit/drip-campaign-content-aisa.test.ts",
]);

/** Generated code is not authored here and is regenerated from the schema. */
export const SCAN_EXCLUDED_DIRS = ["src/generated", "node_modules"] as const;

function isExcludedDir(relativePath: string): boolean {
  return SCAN_EXCLUDED_DIRS.some(
    (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`),
  );
}

function walk(relativeDir: string, out: string[]): void {
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (!isExcludedDir(relativePath)) walk(relativePath, out);
    } else if (entry.isFile()) {
      out.push(relativePath);
    }
  }
}

/** Every repo-relative file the brand scan covers, sorted. Throws if a listed path is missing. */
export function listScannedFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) walk(dir, files);
  for (const file of SCANNED_FILES) {
    if (!statSync(path.join(REPO_ROOT, file)).isFile()) {
      throw new Error(`brand scan: ${file} is not a file`);
    }
    files.push(file);
  }
  return files.filter((file) => !SCAN_EXCLUDED_FILES.has(file)).sort();
}

export interface BrandLeak {
  file: string;
  line: number;
  term: string;
  text: string;
}

/**
 * Case-insensitive search for each term in every scanned text file.
 * Binary files (any NUL byte) are skipped: they cannot carry copy.
 */
export function findBrandLeaks(terms: readonly string[]): BrandLeak[] {
  const needles = terms.map((term) => term.trim()).filter((term) => term.length > 0);
  if (needles.length === 0) throw new Error("brand scan: no terms to search for");
  const lowered = needles.map((term) => term.toLowerCase());
  const leaks: BrandLeak[] = [];

  for (const file of listScannedFiles()) {
    const buffer = readFileSync(path.join(REPO_ROOT, file));
    if (buffer.includes(0)) continue;
    const lines = buffer.toString("utf8").split("\n");
    lines.forEach((text, index) => {
      const haystack = text.toLowerCase();
      lowered.forEach((needle, termIndex) => {
        if (haystack.includes(needle)) {
          leaks.push({ file, line: index + 1, term: needles[termIndex], text: text.trim().slice(0, 160) });
        }
      });
    });
  }
  return leaks;
}

export function formatLeaks(leaks: readonly BrandLeak[]): string {
  return leaks.map((leak) => `${leak.file}:${leak.line} [${leak.term}] ${leak.text}`).join("\n");
}
