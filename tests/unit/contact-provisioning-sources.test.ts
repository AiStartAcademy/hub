import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const ROOT = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(`${ROOT}/${path}`, "utf8");
}

// A source-text contract test, deliberately. `ensureContactForUser` requires
// `source`, so the type checker already proves every caller passes *something*;
// what needs guarding is that each caller passes its OWN value rather than
// borrowing another's — which is the exact defect this change fixes. The
// broadcast and certificate values are additionally asserted behaviorally in
// broadcast-audience.test.ts and certificate-notify.test.ts; the cohort-reminder
// path has no prisma-mocked test of its own, and this file covers it without
// adding a fourth mock.module (which leaks process-wide in bun).
describe("contact provisioning source contracts", () => {
  it("SC-2: every ensureContactForUser caller supplies its own explicit source", async () => {
    const [anchor, audience, certificate] = await Promise.all([
      source("src/lib/drip/cohortAnchor.ts"),
      source("src/lib/drip/audience.ts"),
      source("src/lib/drip/certificateNotify.ts"),
    ]);

    expect(anchor).toContain('source: "cohort-enrollment"');
    expect(audience).toContain('const BROADCAST_AUDIENCE_SOURCE = "broadcast-audience"');
    expect(audience).toContain("source: BROADCAST_AUDIENCE_SOURCE");
    expect(certificate).toContain('const CERTIFICATE_NOTIFY_SOURCE = "certificate-notify"');
    expect(certificate).toContain("source: CERTIFICATE_NOTIFY_SOURCE");
  });
});
