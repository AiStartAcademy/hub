import { describe, expect, it } from "bun:test";
import { candidateWhere, matchesSegment, type ContactForMatch } from "@/lib/drip/segment";

const NOW = new Date("2026-10-03T12:00:00.000Z");

function contact(overrides: Partial<ContactForMatch> = {}): ContactForMatch {
  return {
    status: "NEW",
    source: "manual",
    tags: "[]",
    createdAt: NOW,
    lastActivityAt: null,
    unsubscribedAt: null,
    phone: "+14155551234",
    phoneConsentAt: NOW,
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: null,
    doNotCall: false,
    smsOptOutAt: null,
    ...overrides,
  };
}

describe("smsable drip segment", () => {
  it("SC-5 matches either SMS consent, rejects legacy-only consent and STOP", () => {
    expect(matchesSegment(contact({ smsMarketingConsentAt: NOW }), { smsable: true }, NOW)).toBe(true);
    expect(matchesSegment(contact({ smsTransactionalConsentAt: NOW }), { smsable: true }, NOW)).toBe(true);
    expect(matchesSegment(contact(), { smsable: true }, NOW)).toBe(false);
    expect(
      matchesSegment(
        contact({ smsMarketingConsentAt: NOW, smsOptOutAt: NOW }),
        { smsable: true },
        NOW
      )
    ).toBe(false);
  });

  it("SC-5 emits a Prisma OR over the two SMS consent fields plus opt-out null", () => {
    expect(candidateWhere({ smsable: true }, NOW)).toMatchObject({
      phone: { not: null },
      smsOptOutAt: null,
      AND: [
        {
          OR: [
            { smsMarketingConsentAt: { not: null } },
            { smsTransactionalConsentAt: { not: null } },
          ],
        },
      ],
    });
  });
});
