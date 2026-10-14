#!/usr/bin/env bun
// Runs every unit test file in its own `bun test` process.
//
// bun's mock.module() replacements are process-wide, so a partial mock in one file can leak into
// files that run after it. Which files run after which depends on directory order, which differs
// between macOS and Linux. Running files in separate processes makes results order-independent.
// CI uses this; `bun test tests/unit` stays the fast local loop.
//
// Usage: bun scripts/test-isolated.ts [dir=tests/unit] [--concurrency N]
// Node built-ins only, so `tsc` type-checks it without Bun type definitions.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const concIdx = args.indexOf("--concurrency");
const concurrency = concIdx >= 0 ? Number(args[concIdx + 1]) : Math.max(2, cpus().length);
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--concurrency") ?? "tests/unit";

function listTests(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : listTests(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function runFile(file: string): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["test", `./${file}`], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, text }));
  });
}

const files = listTests(dir).sort();
const failures: { file: string; output: string }[] = [];
let pass = 0;
let fail = 0;

const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const { code, text } = await runFile(file);
      pass += Number(text.match(/^\s*(\d+) pass/m)?.[1] ?? 0);
      fail += Number(text.match(/^\s*(\d+) fail/m)?.[1] ?? 0);
      if (code !== 0) failures.push({ file, output: text });
    }
  }),
);

for (const f of failures) {
  console.log(`\n── ${f.file} ──\n${f.output.trim()}`);
}
console.log(`\n${files.length} files · ${pass} pass · ${fail} fail · ${failures.length} failing files`);
process.exit(failures.length ? 1 : 0);
