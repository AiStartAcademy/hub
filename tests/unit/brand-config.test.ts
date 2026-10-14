// Brand-neutral guard for the single-file brand config. Passes for ANY brand:
// it checks the module's shape and that no other scanned file repeats the
// current brand's identifying values.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { brand, type Brand } from "@/config/brand";

import {
  findBrandLeaks,
  formatLeaks,
  listScannedFiles,
  REPO_ROOT,
} from "./helpers/brandScan";

function collectStringLeaves(value: unknown, prefix: string, out: Array<[string, unknown]>): void {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectStringLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.push([prefix, value]);
}

describe("brand config", () => {
  // Fields a deployment may leave empty to switch the feature off.
  const OPTIONAL = new Set([
    "urls.telemetryCollector",
    "social.youtubeChannelId",
    "certificate.logoImage",
    "certificate.signatureImage",
    "certificate.signatureText",
  ]);

  test("every required brand field is a non-empty string", () => {
    const leaves: Array<[string, unknown]> = [];
    collectStringLeaves(brand satisfies Brand, "", leaves);
    expect(leaves.length).toBeGreaterThan(40);
    const bad = leaves.filter(
      ([key, value]) => typeof value !== "string" || (value.trim() === "" && !OPTIONAL.has(key)),
    );
    expect(bad).toEqual([]);
  });

  test("urls are absolute https origins or paths without trailing slashes", () => {
    for (const [key, url] of Object.entries(brand.urls)) {
      if (url === "" && OPTIONAL.has(`urls.${key}`)) continue;
      expect(`${key}=${url}`).toMatch(/^[a-zA-Z]+=https:\/\/\S+$/);
    }
    expect(brand.urls.site.endsWith("/")).toBe(false);
    expect(brand.urls.hub.endsWith("/")).toBe(false);
    expect(brand.urls.hub).toBe(`https://${brand.domains.hub}`);
    expect(brand.urls.site).toBe(`https://${brand.domains.site}`);
  });

  test("emails, phone, and asset paths are well-formed", () => {
    for (const [key, email] of Object.entries(brand.email)) {
      if (key === "fromName") continue;
      expect(`${key}=${email}`).toMatch(/^[a-zA-Z]+=[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
    expect(brand.phone.schema).toMatch(/^\+[0-9-]+$/);
    expect(brand.assets.logo.startsWith("/")).toBe(true);
    expect(brand.assets.logoWide.startsWith("/")).toBe(true);
    expect(brand.assets.favicon.startsWith("/")).toBe(true);
    expect(brand.smsSenderPrefix.endsWith(": ")).toBe(true);
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: brand.timezone })).not.toThrow();
  });

  test("brand module has no server-only or node imports (client-safe)", async () => {
    const source = await Bun.file(new URL("../../src/config/brand.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain("process.env");
  });

  test("the scan covers src, content, certificate templates, prisma, docker, and tests", () => {
    const files = listScannedFiles();
    for (const expected of [
      "src/app/layout.tsx",
      "src/content/legal/terms-of-service.md",
      "certificate-templates/default.html",
      "certificate-templates/default-empty.html",
      "prisma/schema.prisma",
      "Dockerfile",
      "docker-compose.yml",
      "scripts/seed-drip-campaigns.ts",
      "tests/unit/brand-config.test.ts",
    ]) {
      expect(files).toContain(expected);
    }
    expect(files).not.toContain("src/config/brand.ts");
    expect(files).not.toContain("src/config/content.ts");
    expect(files.some((file) => file.startsWith("src/generated/"))).toBe(false);
  });

  test("no scanned file outside src/config/brand.ts names the current brand", () => {
    const leaks = findBrandLeaks([
      brand.name,
      brand.wordmark,
      brand.legalName,
      brand.hubName,
      brand.address.street,
      brand.email.contact,
      brand.email.privacy,
      brand.email.legal,
      brand.urls.hub,
      brand.phone.display,
      brand.phone.schema,
      brand.signer.name,
    ]);
    expect(formatLeaks(leaks)).toBe("");
  });

  test("no scanned file carries a personal webmail address", () => {
    const leaks = findBrandLeaks(
      // Built at runtime so this file does not match its own scan.
      ["gmail", "yahoo", "hotmail", "icloud", "outlook"].map((provider) => `@${provider}.com`),
    );
    expect(formatLeaks(leaks)).toBe("");
  });

  test("no scanned file hardcodes the academy acronym", () => {
    const acronym = ["AI", "SA"].join("");
    const needle = new RegExp(`\\b${acronym}\\b`);
    const leaks = listScannedFiles().flatMap((file) => {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      return source
        .split("\n")
        .flatMap((text, index) =>
          needle.test(text) ? [`${file}:${index + 1} ${text.trim()}`] : []
        );
    });

    expect(leaks).toEqual([]);
  });
});

describe("brand placeholder renderers", () => {
  test("renderBrandTokens substitutes known tokens and leaves agreement variables alone", async () => {
    const { renderBrandTokens } = await import("@/lib/brandTokens");
    expect(renderBrandTokens("{{brand.name}} / {{ brand.email.contact }} / {{orgName}}", "fixture")).toBe(
      `${brand.name} / ${brand.email.contact} / {{orgName}}`,
    );
  });

  test("renderBrandTokens throws on an unknown brand token", async () => {
    const { renderBrandTokens } = await import("@/lib/brandTokens");
    expect(() => renderBrandTokens("{{brand.nope}}", "fixture.md")).toThrow(
      "Unknown brand token {{brand.nope}} in fixture.md",
    );
  });

  test("certificate placeholders fill from brand and leave data placeholders for the route", async () => {
    const { fillCertificateBrandPlaceholders } = await import("@/lib/certificateBrandPlaceholders");
    const html = fillCertificateBrandPlaceholders(
      '<a href="{{SITE_URL}}">{{SITE_DOMAIN}}</a>{{SIGNER_NAME}}|{{SIGNER_TITLE}}|{{ACADEMY_NAME}}|{{HUB_URL}}/verify?id={{CERT_ID}}',
    );
    expect(html).toBe(
      `<a href="${brand.urls.site}">${brand.domains.site}</a>${brand.signer.name}|${brand.signer.title}|${brand.name}|${brand.urls.hub}/verify?id={{CERT_ID}}`,
    );
  });

  test("SC-1 certificate templates render neutral optional sections and escape competencies", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fillCertificateBrandPlaceholders } = await import("@/lib/certificateBrandPlaceholders");
    const values = {
      academyName: "Fixture Institute",
      logoText: "FIXTURE",
      logoImage: "",
      signatureImage: "",
      signatureText: "",
      signerName: "Pat Fixture",
      signerTitle: "President",
      siteUrl: "https://example.test",
      siteDomain: "example.test",
      hubUrl: "https://hub.example.test",
      programDescription: "",
      competencies: [] as readonly string[],
      location: "",
    };

    for (const file of ["default.html", "default-empty.html"]) {
      const template = readFileSync(
        path.join(import.meta.dir, "..", "..", "certificate-templates", file),
        "utf8",
      );
      const rendered = fillCertificateBrandPlaceholders(template, values)
        .replaceAll("{{STUDENT_NAME}}", "Student")
        .replaceAll("{{COHORT_NAME}}", "Cohort")
        .replaceAll("{{DATE}}", "Jan 1, 2026")
        .replaceAll("{{CERT_ID}}", "CERT-1");

      expect(rendered).not.toContain('<div class="competencies-container">');
      expect(rendered).not.toContain('<div class="course-desc">');
      expect(rendered).not.toContain("<div>Location:");
      expect(rendered).not.toContain("{{");
    }

    const escaped = fillCertificateBrandPlaceholders(
      "<ul>{{CERTIFICATE_COMPETENCIES}}</ul>",
      { ...values, competencies: ['Build <agents> & use "tools"'] },
    );
    expect(escaped).toBe(
      "<ul><li>Build &lt;agents&gt; &amp; use &quot;tools&quot;</li></ul>",
    );
  });

  test("SC-1 shipped certificate templates contain no upstream copy or Cyrillic placeholders", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const file of ["default.html", "default-empty.html"]) {
      const template = readFileSync(
        path.join(import.meta.dir, "..", "..", "certificate-templates", file),
        "utf8",
      );
      expect(template).not.toMatch(/AI START|7-day|70-hour|OpenClaw|Happyverse|San Francisco, CA|af M c/);
      expect(template).not.toMatch(/[\u0400-\u04ff]/);
    }
  });

  test("SC-3 legal jurisdiction tokens resolve from brand config", async () => {
    const { renderBrandTokens } = await import("@/lib/brandTokens");
    expect(
      renderBrandTokens(
        "{{brand.legal.governingLaw}} law / {{brand.legal.venueCounty}}",
        "fixture.md",
      ),
    ).toBe(`${brand.legal.governingLaw} law / ${brand.legal.venueCounty}`);
  });

  test("shipped legal and agreement markdown has no unknown brand tokens", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { renderBrandTokens } = await import("@/lib/brandTokens");
    for (const dir of ["src/content/legal", "src/content/agreements"]) {
      const absoluteDir = path.join(import.meta.dir, "..", "..", dir);
      for (const file of readdirSync(absoluteDir)) {
        const rendered = renderBrandTokens(readFileSync(path.join(absoluteDir, file), "utf8"), file);
        expect(`${file}: ${rendered.includes("{{brand.")}`).toBe(`${file}: false`);
      }
    }
  });
});
