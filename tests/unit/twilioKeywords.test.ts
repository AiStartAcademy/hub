import { describe, expect, it } from "bun:test";
import {
  START_KEYWORDS,
  STOP_KEYWORDS,
  smsKeywordAction,
  smsOptOutWrite,
} from "@/lib/sms/keywords";

describe("Twilio SMS keywords", () => {
  it("SC-7 exports the complete STOP and START keyword sets", () => {
    expect([...STOP_KEYWORDS].sort()).toEqual(
      ["CANCEL", "QUIT", "STOP", "OPTOUT", "UNSUBSCRIBE", "STOPALL", "REVOKE", "END"].sort()
    );
    expect([...START_KEYWORDS].sort()).toEqual(["START", "YES", "UNSTOP"].sort());
  });

  it("SC-7 classifies normalized keywords without granting consent", () => {
    expect(smsKeywordAction("  revoke ")).toBe("stop");
    expect(smsKeywordAction("unstOp")).toBe("start");
    expect(smsKeywordAction("hello")).toBeNull();
  });

  it("review-5: STOP and START produce a write for every contact on the number; other replies none", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    expect(smsOptOutWrite("stop", now)).toEqual({ smsOptOutAt: now });
    expect(smsOptOutWrite("start", now)).toEqual({ smsOptOutAt: null });
    expect(smsOptOutWrite(null, now)).toBeNull();
  });

});
