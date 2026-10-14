import { describe, it, expect, mock, beforeEach } from "bun:test";
import { brand } from "@/config/brand";

// getSecret is DB-backed (prisma) — stub it so this test has no network/DB dependency,
// same isolation approach as the rest of the CAPI payload it's verifying.
const secrets: Record<string, string | undefined> = {
  META_PIXEL_ID: "999999999",
  META_CAPI_TOKEN: "test-token",
  META_TEST_EVENT_CODE: undefined,
  GA4_MEASUREMENT_ID: undefined,
  GA4_API_SECRET: undefined,
};
mock.module("@/lib/secrets", () => ({
  getSecret: async (key: string) => secrets[key],
}));

// Query-param import busts bun's module registry: autoWon.test.ts mock.module()s
// "@/lib/serverConversions" and that mock leaks across test files in the same run.
const { dispatchConversion } = (await import(
  "../../src/lib/serverConversions.ts?real"
)) as typeof import("@/lib/serverConversions");

describe("CRM (system_generated) Meta CAPI events", () => {
  let capturedBody: unknown;
  let capturedUrl: string;

  beforeEach(() => {
    capturedBody = undefined;
    capturedUrl = "";
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
  });

  it("sends action_source=system_generated, custom_data.event_source=crm, and lead_id", async () => {
    await dispatchConversion(
      {
        name: "lead_won",
        eventId: "contact123:WON:1234567890",
        actionSource: "system_generated",
        leadId: "contact123",
      },
      { email: "student@example.com" }
    );

    expect(capturedUrl).toContain("999999999/events");
    const evt = (capturedBody as { data: unknown[] }).data[0] as Record<string, unknown>;
    expect(evt.event_name).toBe("LeadWon");
    expect(evt.action_source).toBe("system_generated");
    expect(evt.event_id).toBe("contact123:WON:1234567890");
    expect(evt.event_source_url).toBeUndefined();
    expect(evt.custom_data).toEqual({
      event_source: "crm",
      lead_event_source: brand.ids.leadEventSource,
    });
    const userData = evt.user_data as Record<string, unknown>;
    expect(userData.lead_id).toBe("contact123");
    expect(userData.em).toBeDefined(); // hashed email present
    expect(userData.client_ip_address).toBeUndefined();
    expect(userData.client_user_agent).toBeUndefined();
  });

  it("still sends normal website-sourced events unchanged (no lead_id, no crm custom_data)", async () => {
    await dispatchConversion(
      { name: "generate_lead", eventId: "resp-abc" },
      { email: "student@example.com", sourceUrl: `${brand.urls.hub}/onboarding/ai-path` }
    );

    const evt = (capturedBody as { data: unknown[] }).data[0] as Record<string, unknown>;
    expect(evt.event_name).toBe("Lead");
    expect(evt.action_source).toBe("website");
    expect(evt.event_source_url).toBe(`${brand.urls.hub}/onboarding/ai-path`);
    expect(evt.custom_data).toBeUndefined();
    const userData = evt.user_data as Record<string, unknown>;
    expect(userData.lead_id).toBeUndefined();
  });

  it("maps QUALIFIED and LOST to distinct custom event names", async () => {
    await dispatchConversion(
      { name: "lead_qualified", eventId: "c1:QUALIFIED:1", actionSource: "system_generated", leadId: "c1" },
      { email: "a@example.com" }
    );
    expect((capturedBody as { data: { event_name: string }[] }).data[0].event_name).toBe(
      "LeadQualified"
    );

    await dispatchConversion(
      { name: "lead_lost", eventId: "c1:LOST:2", actionSource: "system_generated", leadId: "c1" },
      { email: "a@example.com" }
    );
    expect((capturedBody as { data: { event_name: string }[] }).data[0].event_name).toBe(
      "LeadLost"
    );
  });
});
