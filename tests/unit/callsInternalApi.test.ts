import { describe, expect, it } from "bun:test";

import {
  TRANSCRIPT_MAX_LENGTH,
  parseCallListQuery,
  parseRecordingSid,
  validateCallPatch,
} from "@/lib/calls/internalApi";

describe("internal call API helpers", () => {
  it("SC1.1: parses only a valid Twilio proxy recording SID", () => {
    const sid = `RE${"a1".repeat(16)}`;
    expect(parseRecordingSid(`/api/twilio/recordings/${sid}`)).toBe(sid);
    expect(parseRecordingSid("/api/twilio/recordings/RE123")).toBeNull();
    expect(parseRecordingSid(`https://api.twilio.com/Recordings/${sid}.wav`)).toBeNull();
    expect(parseRecordingSid(null)).toBeNull();
  });

  it("SC1.2: parses call list defaults and optional filters", () => {
    expect(parseCallListQuery(new URL("https://hub.test/calls"))).toEqual({
      ok: true,
      value: {
        needsTranscript: false,
        provider: "twilio",
        limit: 50,
      },
    });
    expect(
      parseCallListQuery(
        new URL(
          "https://hub.test/calls?needsTranscript=1&provider=vapi&limit=500&since=2026-10-01T12%3A00%3A00Z&providerCallId=CA123&cursor=call-9",
        ),
      ),
    ).toEqual({
      ok: true,
      value: {
        needsTranscript: true,
        provider: "vapi",
        limit: 200,
        since: new Date("2026-10-01T12:00:00.000Z"),
        providerCallId: "CA123",
        cursor: "call-9",
      },
    });
  });

  it("SC1.3: rejects an invalid since value", () => {
    expect(parseCallListQuery(new URL("https://hub.test/calls?since=not-a-date"))).toEqual({
      ok: false,
      error: "Invalid since date",
    });
  });

  it("SC1.4: validates patch fields, JSON analysis, cap, and force", () => {
    expect(validateCallPatch({ nope: "x" })).toEqual({
      ok: false,
      error: "Unknown field: nope",
    });
    expect(validateCallPatch({})).toEqual({ ok: false, error: "Patch body is empty" });
    expect(validateCallPatch({ transcript: "x".repeat(TRANSCRIPT_MAX_LENGTH + 1) })).toEqual({
      ok: false,
      error: `transcript exceeds ${TRANSCRIPT_MAX_LENGTH} characters`,
    });
    expect(validateCallPatch({ analysis: "{" })).toEqual({
      ok: false,
      error: "analysis must be valid JSON text",
    });
    expect(validateCallPatch({ transcript: "hello", force: "yes" })).toEqual({
      ok: false,
      error: "force must be a boolean",
    });
    expect(validateCallPatch({ summary: "short", analysis: '{"score":1}', force: true })).toEqual({
      ok: true,
      value: { summary: "short", analysis: '{"score":1}', force: true },
    });
  });
});
