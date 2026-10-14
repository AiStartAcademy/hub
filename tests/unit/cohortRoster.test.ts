import { describe, expect, it, mock } from "bun:test";

type ContactRow = {
  email: string;
  phone: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
};

const CONSENT_AT = new Date("2026-09-01T12:00:00.000Z");
const STOP_AT = new Date("2026-09-02T12:00:00.000Z");

const SMSABLE_PHONE = "+14155550123";
const STOPPED_PHONE = "+14155550124";
const UNCONSENTED_PHONE = "+14155550125";
const MARKETING_ONLY_PHONE = "+14155550126";
const NO_SMS = { smsMarketingConsentAt: null, smsTransactionalConsentAt: null };

const contacts: ContactRow[] = [
  // Consented to reminder texts, valid number, no opt-out → smsable. The roster
  // is a cohort surface, so it asks about TRANSACTIONAL consent specifically.
  { email: "ada@example.com", phone: SMSABLE_PHONE, phoneConsentAt: null, smsMarketingConsentAt: null, smsTransactionalConsentAt: CONSENT_AT, smsOptOutAt: null },
  // Texted STOP → not smsable, even with consent on file.
  { email: "grace@example.com", phone: STOPPED_PHONE, phoneConsentAt: CONSENT_AT, smsMarketingConsentAt: CONSENT_AT, smsTransactionalConsentAt: CONSENT_AT, smsOptOutAt: STOP_AT },
  // Call consent only (the legacy bundled field) → not smsable.
  { email: "alan@example.com", phone: UNCONSENTED_PHONE, phoneConsentAt: CONSENT_AT, ...NO_SMS, smsOptOutAt: null },
  // Marketing texts only → not smsable for cohort reminders.
  { email: "katherine@example.com", phone: MARKETING_ONLY_PHONE, phoneConsentAt: null, smsMarketingConsentAt: CONSENT_AT, smsTransactionalConsentAt: null, smsOptOutAt: null },
];

const contactFindManyCalls: unknown[] = [];

const prismaMock = {
  cohort: {
    findFirst: async () => ({
      id: "cohort-1",
      slug: "sep-evening",
      title: "3-Week Evening Edition",
      enrollments: [
        { source: "native", user: { name: "Ada Lovelace", email: "Ada@Example.com" } },
        { source: "luma", user: { name: "Grace Hopper", email: "grace@example.com" } },
        { source: "manual", user: { name: "Alan Turing", email: "alan@example.com" } },
        // No Contact row at all → smsable must be false, never undefined.
        { source: "native", user: { name: "Edsger Dijkstra", email: "edsger@example.com" } },
      ],
      groups: [
        {
          name: "General",
          members: [{ user: { name: "Katherine Johnson", email: "katherine@example.com" } }],
        },
      ],
    }),
  },
  contact: {
    findMany: async (args: unknown): Promise<ContactRow[]> => {
      contactFindManyCalls.push(args);
      const where = (args as { where: { email?: { in?: string[] } } }).where;
      const emails = where.email?.in ?? [];
      return contacts.filter((c) => emails.includes(c.email)).map((c) => ({ ...c }));
    },
  },
};

const actualPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({ ...actualPrisma, default: prismaMock }));

// Spread the real module: mock.module is process-wide, so replacing the whole
// module would strip mcpJsonLimited/mcpJson for every other file in the run.
const actualMcpApi = await import("@/lib/mcpApi");
mock.module("@/lib/mcpApi", () => ({
  ...actualMcpApi,
  requireMcpToken: async () => null,
}));

const { GET } = await import("@/app/api/internal/mcp/v1/cohorts/[id]/roster/route");

async function fetchRoster(): Promise<{ raw: string; rows: Record<string, unknown>[] }> {
  contactFindManyCalls.length = 0;
  const response = await GET(
    new Request("https://hub.example/api/internal/mcp/v1/cohorts/cohort-1/roster"),
    { params: Promise.resolve({ id: "cohort-1" }) }
  );
  expect(response.status).toBe(200);
  const raw = await response.text();
  const body = JSON.parse(raw) as { roster: Record<string, unknown>[] };
  return { raw, rows: body.roster };
}

describe("cohort roster MCP", () => {
  it("SC-23: exposes a smsable boolean per row and never the raw phone number", async () => {
    const { raw, rows } = await fetchRoster();
    const byEmail = new Map(rows.map((r) => [String(r.email).toLowerCase(), r]));

    // The security-relevant half: no digits reach the MCP surface at all.
    for (const phone of [SMSABLE_PHONE, STOPPED_PHONE, UNCONSENTED_PHONE]) {
      expect(raw).not.toContain(phone);
      expect(raw).not.toContain(phone.replace("+1", ""));
    }
    expect(raw).not.toContain("phone");

    expect(byEmail.get("ada@example.com")?.smsable).toBe(true);
    expect(byEmail.get("grace@example.com")?.smsable).toBe(false);
    expect(byEmail.get("alan@example.com")?.smsable).toBe(false);
    expect(byEmail.get("edsger@example.com")?.smsable).toBe(false);
    expect(byEmail.get("katherine@example.com")?.smsable).toBe(false);

    // Every row carries the flag — an absent key would read as "unknown".
    for (const row of rows) expect(typeof row.smsable).toBe("boolean");

    // One batched Contact query for the whole roster (no N+1).
    expect(contactFindManyCalls).toHaveLength(1);
  });
});
