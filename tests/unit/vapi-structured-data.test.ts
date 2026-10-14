import { describe, expect, it } from "bun:test";
import { extractStructuredData } from "@/lib/vapi/structuredData";

describe("extractStructuredData", () => {
  it("SC1 returns analysis.structuredData when present (legacy path unchanged)", () => {
    const message = {
      analysis: { structuredData: { outcome: "qualified", requested_dnc: false } },
    };
    expect(extractStructuredData(message)).toEqual({
      outcome: "qualified",
      requested_dnc: false,
    });
  });

  it("SC2 returns the result object of a single structured output when analysis is absent", () => {
    const message = {
      artifact: {
        structuredOutputs: {
          so_1: { name: "call_result", result: { outcome: "booked", qualified: true } },
        },
      },
    };
    expect(extractStructuredData(message)).toEqual({ outcome: "booked", qualified: true });
  });

  it("SC3 merges object results in entry order, keys scalars by name (id fallback), later wins", () => {
    const message = {
      artifact: {
        structuredOutputs: {
          so_1: { name: "first", result: { outcome: "voicemail", notes: "left message" } },
          so_2: { name: "requested_dnc", result: true },
          so_3: { name: "second", result: { outcome: "callback" } },
          so_4: { result: ["a", "b"] },
        },
      },
    };
    expect(extractStructuredData(message)).toEqual({
      outcome: "callback",
      notes: "left message",
      requested_dnc: true,
      so_4: ["a", "b"],
    });
  });

  it("SC4 returns null when neither source has usable data", () => {
    expect(extractStructuredData(undefined)).toBeNull();
    expect(extractStructuredData(null)).toBeNull();
    expect(extractStructuredData({})).toBeNull();
    expect(extractStructuredData({ analysis: { structuredData: {} } })).toBeNull();
    expect(extractStructuredData({ analysis: { structuredData: "junk" } })).toBeNull();
    expect(extractStructuredData({ analysis: { structuredData: [1, 2] } })).toBeNull();
    expect(extractStructuredData({ artifact: { structuredOutputs: {} } })).toBeNull();
    expect(extractStructuredData({ artifact: { structuredOutputs: "junk" } })).toBeNull();
    expect(extractStructuredData({ artifact: { structuredOutputs: [{ result: 1 }] } })).toBeNull();
    expect(
      extractStructuredData({ artifact: { structuredOutputs: { so_1: "junk" } } })
    ).toBeNull();
    expect(
      extractStructuredData({ artifact: { structuredOutputs: { so_1: { result: undefined } } } })
    ).toBeNull();
  });

  it("SC5 merges both sources with legacy analysis.structuredData winning on conflict", () => {
    const message = {
      analysis: { structuredData: { outcome: "legacy-outcome" } },
      artifact: {
        structuredOutputs: {
          so_1: { name: "so", result: { outcome: "new-outcome", transferred_to: "+15551234567" } },
          so_2: { name: "requested_dnc", result: true },
        },
      },
    };
    expect(extractStructuredData(message)).toEqual({
      outcome: "legacy-outcome",
      transferred_to: "+15551234567",
      requested_dnc: true,
    });
  });

  it("SC6 surfaces the route's four consumed fields from Structured Outputs alone", () => {
    const structured = extractStructuredData({
      artifact: {
        structuredOutputs: {
          so_1: {
            name: "call_result",
            result: {
              outcome: "transferred",
              transferred_to: "+15550001111",
              requested_dnc: true,
            },
          },
        },
      },
    });
    expect(structured).not.toBeNull();
    expect(structured?.["outcome"]).toBe("transferred");
    expect(structured?.["transferred_to"]).toBe("+15550001111");
    expect(structured?.["requested_dnc"]).toBe(true);
    expect(JSON.parse(JSON.stringify(structured))).toEqual(structured as object);
  });
});
