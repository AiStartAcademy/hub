#!/usr/bin/env bun
// Runs every unit test file in its own `bun test` process.
//
// bun's mock.module() replacements are process-wide, so a partial mock in one file can leak into
// files that run after it. Which files run after which depends on directory order, which differs
// between macOS and Linux. Running files in separate processes makes results order-independent.
// CI uses this; `bun test tests/unit` stays the fast local loop.
//
// Usage: bun scripts/test-isolated.ts [dir=tests/unit] [--concurrency N]

import { cpus } from "node:os";

const args = process.argv.slice(2);
const concIdx = args.indexOf("--concurrency");
const concurrency = concIdx >= 0 ? Number(args[concIdx + 1]) : Math.max(2, cpus().length);
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--concurrency") ?? "tests/unit";

const files = [...new Bun.Glob(`${dir}/**/*.test.{ts,tsx}`).scanSync(".")].sort();
const failures: { file: string; output: string }[] = [];
let pass = 0;
let fail = 0;

async function runFile(file: string) {
  const proc = Bun.spawn(["bun", "test", `./${file}`], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const text = out + err;
  pass += Number(text.match(/^\s*(\d+) pass/m)?.[1] ?? 0);
  fail += Number(text.match(/^\s*(\d+) fail/m)?.[1] ?? 0);
  if (code !== 0) failures.push({ file, output: text });
}

const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) await runFile(file);
  }),
);

for (const f of failures) {
  console.log(`\n── ${f.file} ──\n${f.output.trim()}`);
}
console.log(`\n${files.length} files · ${pass} pass · ${fail} fail · ${failures.length} failing files`);
process.exit(failures.length ? 1 : 0);
