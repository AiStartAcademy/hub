import { describe, expect, it } from "bun:test";

import {
  buildLegs,
  nextLeg,
  packLegs,
  parseRingStrategy,
  parseRouteChain,
  twimlForLeg,
  unpackLegs,
  validateRoutingNumbers,
  type Leg,
} from "@/lib/calls/inboundRouting";

const DEFAULT_CHAIN = ["owner", "closers", "vapi", "forward"];

function encodedPayload(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("inbound routing", () => {
  it("SC1.1: parses an ordered array of known route steps", () => {
    expect(parseRouteChain('["forward","owner","vapi","closers"]')).toEqual([
      "forward",
      "owner",
      "vapi",
      "closers",
    ]);
  });

  it("SC1.1: defaults invalid JSON, non-arrays, unknown steps, and empty arrays", () => {
    expect(parseRouteChain(undefined)).toEqual(DEFAULT_CHAIN);
    expect(parseRouteChain("not-json")).toEqual(DEFAULT_CHAIN);
    expect(parseRouteChain('{"owner":true}')).toEqual(DEFAULT_CHAIN);
    expect(parseRouteChain('["owner","mystery"]')).toEqual(DEFAULT_CHAIN);
    expect(parseRouteChain("[]")).toEqual(DEFAULT_CHAIN);
  });

  it("SC1.2: emits the available staff owner first and excludes them from closers", () => {
    expect(
      buildLegs({
        chain: ["owner", "closers"],
        strategy: "simulring",
        forwardNumber: null,
        vapiNumber: null,
        ownerCandidate: { userId: "owner_1", available: true, isStaff: true },
        availableClosers: [
          { id: "closer_1", lastAnsweredAt: null },
          { id: "owner_1", lastAnsweredAt: new Date("2026-08-01T00:00:00Z") },
        ],
      })
    ).toEqual([
      { kind: "closer", userIds: ["owner_1"], owner: true },
      { kind: "closer", userIds: ["closer_1"], owner: false },
    ]);
  });

  it("SC1.3: omits unavailable, non-staff, and absent owners without an empty leg", () => {
    const base = {
      chain: ["owner", "closers"] as const,
      strategy: "simulring" as const,
      forwardNumber: null,
      vapiNumber: null,
      availableClosers: [{ id: "closer_1", lastAnsweredAt: null }],
    };

    for (const ownerCandidate of [
      null,
      { userId: "owner_1", available: false, isStaff: true },
      { userId: "owner_1", available: true, isStaff: false },
    ]) {
      expect(buildLegs({ ...base, ownerCandidate })).toEqual([
        { kind: "closer", userIds: ["closer_1"], owner: false },
      ]);
    }
  });

  it("SC1.4: defaults invalid strategies and simulrings at most ten closers in one leg", () => {
    expect(parseRingStrategy(undefined)).toBe("simulring");
    expect(parseRingStrategy("ROUND-ROBIN")).toBe("simulring");
    expect(parseRingStrategy(" simulring ")).toBe("simulring");
    expect(parseRingStrategy("round-robin")).toBe("round-robin");

    const legs = buildLegs({
      chain: ["closers"],
      strategy: "simulring",
      forwardNumber: null,
      vapiNumber: null,
      ownerCandidate: null,
      availableClosers: Array.from({ length: 12 }, (_, index) => ({
        id: `closer_${String(index).padStart(2, "0")}`,
        lastAnsweredAt: null,
      })),
    });

    expect(legs).toHaveLength(1);
    expect(legs[0]).toEqual({
      kind: "closer",
      userIds: Array.from({ length: 10 }, (_, index) =>
        `closer_${String(index).padStart(2, "0")}`
      ),
      owner: false,
    });
  });

  it("SC1.4: round-robins never-answered closers first with id tie-breaks and caps at four", () => {
    const legs = buildLegs({
      chain: ["closers"],
      strategy: "round-robin",
      forwardNumber: null,
      vapiNumber: null,
      ownerCandidate: null,
      availableClosers: [
        { id: "later", lastAnsweredAt: new Date("2026-08-03T00:00:00Z") },
        { id: "never_b", lastAnsweredAt: null },
        { id: "earlier_b", lastAnsweredAt: new Date("2026-08-01T00:00:00Z") },
        { id: "never_a", lastAnsweredAt: null },
        { id: "earlier_a", lastAnsweredAt: new Date("2026-08-01T00:00:00Z") },
        { id: "latest", lastAnsweredAt: new Date("2026-08-04T00:00:00Z") },
      ],
    });

    expect(legs).toEqual(
      ["never_a", "never_b", "earlier_a", "earlier_b"].map((id) => ({
        kind: "closer",
        userIds: [id],
        owner: false,
      }))
    );
  });

  it("SC1.4: deterministically truncates the total dialable chain to eight legs", () => {
    const legs = buildLegs({
      chain: ["closers", "forward", "closers", "vapi", "closers"],
      strategy: "round-robin",
      forwardNumber: "+14155550101",
      vapiNumber: "+14155550102",
      ownerCandidate: null,
      availableClosers: [
        { id: "a", lastAnsweredAt: null },
        { id: "b", lastAnsweredAt: null },
        { id: "c", lastAnsweredAt: null },
      ],
    });

    expect(legs).toHaveLength(8);
    expect(legs.at(-1)).toEqual({
      kind: "number",
      target: "+14155550102",
      purpose: "vapi",
    });
  });

  it("SC1.5: omits unset, invalid, and looped number legs while keeping valid numbers", () => {
    const invalidNumbers = validateRoutingNumbers({
      twilioNumber: "+14155550100",
      forwardNumber: "not-a-phone",
      vapiNumber: undefined,
    });
    expect(invalidNumbers.forwardNumber).toBeNull();
    expect(invalidNumbers.vapiNumber).toBeNull();
    expect(invalidNumbers.errors).toHaveLength(1);

    const validNumbers = validateRoutingNumbers({
      twilioNumber: "+14155550100",
      forwardNumber: "+14155550101",
      vapiNumber: "+14155550102",
    });
    expect(
      buildLegs({
        chain: ["vapi", "forward"],
        strategy: "simulring",
        forwardNumber: invalidNumbers.forwardNumber,
        vapiNumber: invalidNumbers.vapiNumber,
        ownerCandidate: null,
        availableClosers: [],
      })
    ).toEqual([]);
    expect(
      buildLegs({
        chain: ["vapi", "forward"],
        strategy: "simulring",
        forwardNumber: validNumbers.forwardNumber,
        vapiNumber: validNumbers.vapiNumber,
        ownerCandidate: null,
        availableClosers: [],
      })
    ).toEqual([
      { kind: "number", target: "+14155550102", purpose: "vapi" },
      { kind: "number", target: "+14155550101", purpose: "forward" },
    ]);
  });

  it("SC1.6: packs URL-safe tuples and round-trips every leg exactly", () => {
    const legs: Leg[] = [
      { kind: "closer", userIds: ["owner_1"], owner: true },
      { kind: "closer", userIds: ["closer-A", "closer_B"], owner: false },
      { kind: "number", target: "+14155550102", purpose: "vapi" },
      { kind: "number", target: "+14155550101", purpose: "forward" },
    ];

    const packed = packLegs(legs);
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(packed, "base64url").toString("utf8"))).toEqual([
      1,
      [
        ["c", 1, ["owner_1"]],
        ["c", 0, ["closer-A", "closer_B"]],
        ["n", "v", "+14155550102"],
        ["n", "f", "+14155550101"],
      ],
    ]);
    expect(unpackLegs(packed)).toEqual(legs);
  });

  it("SC1.6: unpack rejects over-cap, malformed, and unsafe leg entries", () => {
    const closer = ["c", 0, ["closer_1"]];
    const rejected = [
      null,
      "",
      "not-base64!",
      encodedPayload({ version: 1 }),
      encodedPayload([2, []]),
      encodedPayload([1, Array.from({ length: 9 }, () => closer)]),
      encodedPayload([1, [["c", 0, []]]]),
      encodedPayload([
        1,
        [["c", 0, Array.from({ length: 11 }, (_, index) => `closer_${index}`)]],
      ]),
      encodedPayload([1, [["c", 0, ["unsafe user id"]]]]),
      encodedPayload([1, [["c", 2, ["closer_1"]]]]),
      encodedPayload([1, [["n", "x", "+14155550101"]]]),
      encodedPayload([1, [["n", "f", "not-a-phone"]]]),
    ];

    for (const packed of rejected) expect(unpackLegs(packed)).toBeNull();
  });

  it("SC1.7: finalizes completed dials, advances all other statuses, then uses voicemail", () => {
    const legs: Leg[] = [
      { kind: "closer", userIds: ["closer_1"], owner: false },
      { kind: "number", target: "+14155550101", purpose: "forward" },
    ];

    expect(nextLeg(legs, 0, "completed")).toEqual({ action: "finalize" });
    expect(nextLeg(legs, 0, "busy")).toEqual({
      action: "dial",
      index: 1,
      leg: legs[1],
    });
    expect(nextLeg(legs, 1, "no-answer")).toEqual({ action: "voicemail" });
    expect(nextLeg([], -1, "failed")).toEqual({ action: "voicemail" });
  });

  it("SC1.8: snapshots solo closer TwiML with one client and complete dial callbacks", () => {
    const response = twimlForLeg(
      { kind: "closer", userIds: ["owner_1"], owner: true },
      {
        contactCallId: "call id/1",
        contactId: "contact_1",
        leadName: "Ada & Co",
        legs: "packed+/=",
        index: 2,
        appUrl: "https://hub.test/",
      }
    );

    expect(response.toString()).toMatchInlineSnapshot(
      `"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Dial record=\"record-from-answer-dual\" recordingStatusCallback=\"https://hub.test/api/webhooks/twilio/voice/recording\" recordingStatusCallbackEvent=\"completed\" timeout=\"15\" action=\"https://hub.test/api/webhooks/twilio/voice/inbound/after?contactCallId=call%20id%2F1&amp;legs=packed%2B%2F%3D&amp;i=2\" method=\"POST\"><Client><Identity>closer-owner_1</Identity><Parameter name=\"contactId\" value=\"contact_1\"/><Parameter name=\"leadName\" value=\"Ada &amp; Co\"/></Client></Dial></Response>"`
    );
  });

  it("SC1.8: snapshots simulring TwiML with every client and a twenty-second timeout", () => {
    const response = twimlForLeg(
      { kind: "closer", userIds: ["closer_1", "closer_2"], owner: false },
      {
        contactCallId: "call_1",
        contactId: "contact_1",
        leadName: "Ada",
        legs: "packed_legs",
        index: 0,
        appUrl: "https://hub.test",
      }
    );

    expect(response.toString()).toMatchInlineSnapshot(
      `"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Dial record=\"record-from-answer-dual\" recordingStatusCallback=\"https://hub.test/api/webhooks/twilio/voice/recording\" recordingStatusCallbackEvent=\"completed\" timeout=\"20\" action=\"https://hub.test/api/webhooks/twilio/voice/inbound/after?contactCallId=call_1&amp;legs=packed_legs&amp;i=0\" method=\"POST\"><Client><Identity>closer-closer_1</Identity><Parameter name=\"contactId\" value=\"contact_1\"/><Parameter name=\"leadName\" value=\"Ada\"/></Client><Client><Identity>closer-closer_2</Identity><Parameter name=\"contactId\" value=\"contact_1\"/><Parameter name=\"leadName\" value=\"Ada\"/></Client></Dial></Response>"`
    );
  });

  it("SC1.8: snapshots vapi and forward TwiML as numbers without callerId", () => {
    for (const purpose of ["vapi", "forward"] as const) {
      const response = twimlForLeg(
        { kind: "number", target: "+14155550102", purpose },
        {
          contactCallId: "call_1",
          contactId: "contact_1",
          leadName: "Ada",
          legs: "packed_legs",
          index: 3,
          appUrl: "https://hub.test",
        }
      );

      expect(response.toString()).toMatchInlineSnapshot(
        `"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Dial record=\"record-from-answer-dual\" recordingStatusCallback=\"https://hub.test/api/webhooks/twilio/voice/recording\" recordingStatusCallbackEvent=\"completed\" timeout=\"15\" action=\"https://hub.test/api/webhooks/twilio/voice/inbound/after?contactCallId=call_1&amp;legs=packed_legs&amp;i=3\" method=\"POST\"><Number>+14155550102</Number></Dial></Response>"`
      );
      expect(response.toString()).not.toContain("callerId");
    }
  });

  it("SC1.9: rejects forward and vapi loops after E.164 normalization", () => {
    const result = validateRoutingNumbers({
      twilioNumber: "+1 (415) 555-0100",
      forwardNumber: "415-555-0100",
      vapiNumber: "+1 415 555 0100",
    });

    expect(result.forwardNumber).toBeNull();
    expect(result.vapiNumber).toBeNull();
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.includes("TWILIO_PHONE_NUMBER"))).toBe(true);
  });
});
