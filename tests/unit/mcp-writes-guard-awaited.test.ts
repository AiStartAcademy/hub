import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(entryPath);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
    })
  );
  return files.flat();
}

describe("MCP write guards", () => {
  it("awaits every mcpWritesEnabled call under src", async () => {
    const callNeedle = ["mcpWrites", "Enabled()"].join("");
    const definitionNeedle = `function ${callNeedle}`;
    const awaitedNeedle = `await ${callNeedle}`;
    const files = await listSourceFiles(path.join(process.cwd(), "src"));
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      source.split("\n").forEach((line, index) => {
        const code = line.split("//", 1)[0];
        if (
          code.includes(callNeedle) &&
          !code.includes(definitionNeedle) &&
          !code.includes(awaitedNeedle)
        ) {
          violations.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
