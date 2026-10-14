import { describe, expect, it } from "bun:test";
import { SEED_CAMPAIGNS } from "@/lib/drip/campaigns";
import {
  candidateWhere,
  describeSegment,
  matchesSegment,
  parseSegment,
  serializeSegment,
  type ContactForMatch,
} from "@/lib/drip/segment";

const NOW = new Date("2026-07-30T18:00:00.000Z");

type ContactWhereSubset = {
  createdAt?: {
    gte?: Date;
    lte?: Date;
  };
  OR?: Array<{ source: { in: string[] } } | { source: { startsWith: string } }>;
  status?: { in: string[] };
  unsubscribedAt?: null;
};

function contact(overrides: Partial<ContactForMatch> = {}): ContactForMatch {
  return {
    status: "NEW",
    source: "manual",
    tags: JSON.stringify([]),
    createdAt: new Date("2026-07-29T18:00:00.000Z"),
    lastActivityAt: new Date("2026-07-29T18:00:00.000Z"),
    unsubscribedAt: null,
    ...overrides,
  };
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function tagsJson(tags: string[]): string {
  return JSON.stringify(tags);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectAllowedKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: string[]
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new Error(`${label} contains unsupported key "${key}"`);
    }
  }
}

function matchesSourceClause(contactToCheck: ContactForMatch, clause: unknown): boolean {
  const clauseRecord = expectRecord(clause, "where.OR clause");
  expectAllowedKeys(clauseRecord, "where.OR clause", ["source"]);

  const sourceRecord = expectRecord(clauseRecord.source, "where.OR clause.source");
  expectAllowedKeys(sourceRecord, "where.OR clause.source", ["in", "startsWith"]);

  const hasIn = Object.prototype.hasOwnProperty.call(sourceRecord, "in");
  const hasStartsWith = Object.prototype.hasOwnProperty.call(sourceRecord, "startsWith");
  if (hasIn === hasStartsWith) {
    throw new Error("where.OR clause.source must contain exactly one of in/startsWith");
  }

  if (hasIn) {
    if (
      !Array.isArray(sourceRecord.in) ||
      sourceRecord.in.some((value) => typeof value !== "string")
    ) {
      throw new Error("where.OR clause.source.in must be a string array");
    }
    return contactToCheck.source !== null && sourceRecord.in.includes(contactToCheck.source);
  }

  if (typeof sourceRecord.startsWith !== "string") {
    throw new Error("where.OR clause.source.startsWith must be a string");
  }
  return (
    contactToCheck.source !== null &&
    contactToCheck.source.startsWith(sourceRecord.startsWith)
  );
}

function candidateWhereMatches(
  contactToCheck: ContactForMatch,
  where: ContactWhereSubset
): boolean {
  const record = expectRecord(where, "where");
  expectAllowedKeys(record, "where", ["unsubscribedAt", "status", "OR", "createdAt"]);

  for (const [key, value] of Object.entries(record)) {
    if (key === "unsubscribedAt") {
      if (value !== null) {
        throw new Error("where.unsubscribedAt must be null");
      }
      if (contactToCheck.unsubscribedAt !== null) return false;
      continue;
    }

    if (key === "status") {
      const statusRecord = expectRecord(value, "where.status");
      expectAllowedKeys(statusRecord, "where.status", ["in"]);
      if (
        !Array.isArray(statusRecord.in) ||
        statusRecord.in.some((item) => typeof item !== "string")
      ) {
        throw new Error("where.status.in must be a string array");
      }
      if (contactToCheck.status === null || !statusRecord.in.includes(contactToCheck.status)) {
        return false;
      }
      continue;
    }

    if (key === "OR") {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error("where.OR must be a non-empty array");
      }
      if (!value.some((clause) => matchesSourceClause(contactToCheck, clause))) {
        return false;
      }
      continue;
    }

    if (key === "createdAt") {
      const createdAtRecord = expectRecord(value, "where.createdAt");
      expectAllowedKeys(createdAtRecord, "where.createdAt", ["gte", "lte"]);
      if (
        createdAtRecord.gte !== undefined &&
        !(createdAtRecord.gte instanceof Date && Number.isFinite(createdAtRecord.gte.getTime()))
      ) {
        throw new Error("where.createdAt.gte must be a Date");
      }
      if (
        createdAtRecord.lte !== undefined &&
        !(createdAtRecord.lte instanceof Date && Number.isFinite(createdAtRecord.lte.getTime()))
      ) {
        throw new Error("where.createdAt.lte must be a Date");
      }
      if (createdAtRecord.gte && contactToCheck.createdAt < createdAtRecord.gte) return false;
      if (createdAtRecord.lte && contactToCheck.createdAt > createdAtRecord.lte) return false;
      continue;
    }

    throw new Error(`where contains unsupported key "${key}"`);
  }

  return true;
}

function buildSyntheticContacts(): ContactForMatch[] {
  const contacts: ContactForMatch[] = [];
  const statuses = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const;
  const sources = [
    null,
    "manual",
    "asset_download",
    "onboarding",
    "onboarding-ai-path",
    "onboarding:ai-path",
    // Recovery sources written by syncAbandonedCheckouts (src/lib/drip/abandoned.ts).
    // Without these, the cart/membership recovery campaigns would match zero
    // synthetic contacts and the coverage assertion below would be vacuous.
    "checkout_abandoned",
    "membership_abandoned",
    "program_checkout_abandoned",
    // onProgramPurchased (src/lib/programPurchaseLifecycle.ts) sets this on create.
    "program",
    // Written by the public newsletter signup route
    // (src/app/api/public/newsletter/subscribe/route.ts).
    "newsletter",
  ] as const;
  const tagSets = [
    JSON.stringify([]),
    tagsJson(["goal-agency"]),
    tagsJson(["goal-career"]),
    tagsJson(["goal-explore"]),
    tagsJson(["no-drip"]),
    tagsJson(["goal-agency", "no-drip"]),
    tagsJson(["next-cohort"]),
    tagsJson(["seg-next-cohort"]),
    // The newsletter-welcome segment requires this tag alongside the source.
    tagsJson(["newsletter"]),
  ] as const;
  const createdAts = [hoursAgo(1), daysAgo(1), daysAgo(2), daysAgo(30), daysAgo(31)];
  const lastActivityAts = [null, hoursAgo(12), daysAgo(29), daysAgo(30), daysAgo(31)];
  const unsubscribedAts = [null, NOW];

  for (const status of statuses) {
    for (const source of sources) {
      for (const tags of tagSets) {
        for (const createdAt of createdAts) {
          for (const lastActivityAt of lastActivityAts) {
            for (const unsubscribedAt of unsubscribedAts) {
              contacts.push(
                contact({
                  status,
                  source,
                  tags,
                  createdAt,
                  lastActivityAt,
                  unsubscribedAt,
                })
              );
            }
          }
        }
      }
    }
  }

  return contacts;
}

describe("parseSegment", () => {
  it("SC-1: parseSegment and serializeSegment round-trip broadcast audience fields", () => {
    const segment = {
      cohorts: [" cohort-1 ", "spring-2026", "cohort-1", ""],
      products: ["self-paced", "unknown", "membership", "self-paced"],
      includeUsers: true,
    };

    expect(parseSegment(JSON.stringify(segment))).toEqual({
      cohorts: ["cohort-1", "spring-2026"],
      products: ["self-paced", "membership"],
      includeUsers: true,
    });
    expect(parseSegment(serializeSegment(segment))).toEqual({
      cohorts: ["cohort-1", "spring-2026"],
      products: ["self-paced", "membership"],
      includeUsers: true,
    });
    expect(parseSegment('{"cohorts":"any","includeUsers":false}')).toEqual({
      cohorts: "any",
    });
    expect(
      parseSegment(
        JSON.stringify({
          cohorts: "all",
          products: ["future-product"],
          includeUsers: "true",
        })
      )
    ).toEqual({});
  });

  it("SC-2: describeSegment includes cohorts, products, and user reach in one line", () => {
    expect(
      describeSegment({
        cohorts: ["cohort-1", "spring-2026"],
        products: ["self-paced", "membership"],
        includeUsers: true,
      })
    ).toBe(
      "cohorts: cohort-1, spring-2026 · products: self-paced, membership · include all users"
    );
    expect(describeSegment({ cohorts: "any" })).toBe("cohorts: any");
  });

  it("drops malformed JSON and malformed values instead of throwing", () => {
    expect(parseSegment("not json")).toEqual({});
    expect(parseSegment("[]")).toEqual({});
    expect(parseSegment('"scalar"')).toEqual({});

    expect(
      parseSegment(
        JSON.stringify({
          sources: ["manual", "", " onboarding:* ", 42],
          statuses: "NEW",
          anyTags: [],
          allTags: ["vip", "vip", " "],
          noneTags: [false, ""],
          minAgeHours: 0,
          maxAgeDays: -1,
          inactiveForDays: 1.5,
          unexpected: ["ignored"],
        })
      )
    ).toEqual({
      sources: ["manual", "onboarding:*"],
      allTags: ["vip"],
    });
  });
});

describe("matchesSegment", () => {
  it("matches onboarding wildcards by the onboarding: prefix only, while exact sources stay exact", () => {
    const wildcardSegment = { sources: ["onboarding:*"] };
    expect(matchesSegment(contact({ source: "onboarding:ai-path" }), wildcardSegment, NOW)).toBe(
      true
    );
    expect(matchesSegment(contact({ source: "manual" }), wildcardSegment, NOW)).toBe(false);
    expect(matchesSegment(contact({ source: "onboarding-ai-path" }), wildcardSegment, NOW)).toBe(
      false
    );

    const exactSegment = { sources: ["manual"] };
    expect(matchesSegment(contact({ source: "manual" }), exactSegment, NOW)).toBe(true);
    expect(matchesSegment(contact({ source: "manual:import" }), exactSegment, NOW)).toBe(false);
  });

  it("applies anyTags, allTags, and noneTags correctly alone and in combination", () => {
    const tagged = contact({ tags: tagsJson(["vip", "founder", "active"]) });

    expect(matchesSegment(tagged, { anyTags: ["vip", "operator"] }, NOW)).toBe(true);
    expect(matchesSegment(tagged, { anyTags: ["operator", "builder"] }, NOW)).toBe(false);
    expect(matchesSegment(tagged, { allTags: ["vip", "founder"] }, NOW)).toBe(true);
    expect(matchesSegment(tagged, { allTags: ["vip", "missing"] }, NOW)).toBe(false);
    expect(matchesSegment(tagged, { noneTags: ["blocked", "archived"] }, NOW)).toBe(true);
    expect(matchesSegment(tagged, { noneTags: ["blocked", "founder"] }, NOW)).toBe(false);
    expect(
      matchesSegment(
        tagged,
        {
          anyTags: ["vip", "operator"],
          allTags: ["vip", "founder"],
          noneTags: ["archived"],
        },
        NOW
      )
    ).toBe(true);
    expect(
      matchesSegment(
        tagged,
        {
          anyTags: ["vip"],
          allTags: ["vip", "founder"],
          noneTags: ["founder"],
        },
        NOW
      )
    ).toBe(false);
  });

  it("treats age and inactivity boundaries as inclusive, with inactivity falling back to createdAt", () => {
    expect(
      matchesSegment(contact({ createdAt: hoursAgo(48) }), { minAgeHours: 48 }, NOW)
    ).toBe(true);
    expect(
      matchesSegment(contact({ createdAt: new Date(hoursAgo(48).getTime() + 1) }), { minAgeHours: 48 }, NOW)
    ).toBe(false);

    expect(matchesSegment(contact({ createdAt: daysAgo(7) }), { maxAgeDays: 7 }, NOW)).toBe(
      true
    );
    expect(
      matchesSegment(contact({ createdAt: new Date(daysAgo(7).getTime() - 1) }), { maxAgeDays: 7 }, NOW)
    ).toBe(false);

    expect(
      matchesSegment(
        contact({ lastActivityAt: daysAgo(30), createdAt: daysAgo(40) }),
        { inactiveForDays: 30 },
        NOW
      )
    ).toBe(true);
    expect(
      matchesSegment(
        contact({
          lastActivityAt: new Date(daysAgo(30).getTime() + 1),
          createdAt: daysAgo(40),
        }),
        { inactiveForDays: 30 },
        NOW
      )
    ).toBe(false);
    expect(
      matchesSegment(
        contact({ lastActivityAt: null, createdAt: daysAgo(30) }),
        { inactiveForDays: 30 },
        NOW
      )
    ).toBe(true);
    expect(
      matchesSegment(
        contact({
          lastActivityAt: null,
          createdAt: new Date(daysAgo(30).getTime() + 1),
        }),
        { inactiveForDays: 30 },
        NOW
      )
    ).toBe(false);
  });

  it("never matches unsubscribed contacts, even for the empty segment", () => {
    expect(matchesSegment(contact({ unsubscribedAt: NOW }), {}, NOW)).toBe(false);
    expect(
      matchesSegment(
        contact({
          source: "onboarding:ai-path",
          status: "NEW",
          unsubscribedAt: NOW,
        }),
        { sources: ["onboarding:*"], statuses: ["NEW"] },
        NOW
      )
    ).toBe(false);
  });
});

describe("candidateWhere", () => {
  it("is never narrower than matchesSegment for the seeded campaign segments", () => {
    const contacts = buildSyntheticContacts();

    for (const campaign of SEED_CAMPAIGNS) {
      const where = candidateWhere(campaign.segment, NOW) as ContactWhereSubset;
      let matchingContacts = 0;

      for (const syntheticContact of contacts) {
        const exactMatch = matchesSegment(syntheticContact, campaign.segment, NOW);
        if (!exactMatch) continue;

        matchingContacts += 1;
        expect(candidateWhereMatches(syntheticContact, where)).toBe(true);
      }

      expect(matchingContacts).toBeGreaterThan(0);
    }
  });
});
