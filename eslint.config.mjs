import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output anywhere in the tree, not just at the root. Agent worktrees
    // under .claude/worktrees/ each carry their own .next/, and alternate dist
    // dirs (NEXT_DIST_DIR=.next-verify and friends) are used to run a second
    // dev server without clobbering the first. Without these, `eslint .` walks
    // tens of thousands of generated chunks and dies with a heap OOM.
    "**/.next/**",
    "**/.next-*/**",
    ".claude/**",
    // Generated and vendored assets are not maintained as application source.
    "src/generated/**",
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
