import { describe, expect, it } from "bun:test";

import {
  formatTimestamp,
  parseSrt,
  parseWhisperJson,
  planTimeline,
} from "../../scripts/dub-audio/core";

describe("parseSrt", () => {
  it("parses cues, joins multiline text, and tolerates BOM with CRLF", () => {
    const fixture: string =
      "\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\nworld\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,100\r\nBye\r\n";

    const segments = parseSrt(fixture);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      index: 1,
      startSec: 1.25,
      endSec: 3.5,
      text: "Hello world",
    });
    expect(segments[1]).toEqual({
      index: 2,
      startSec: 4,
      endSec: 5.1,
      text: "Bye",
    });
  });

  it("accepts timestamps that use a dot for milliseconds", () => {
    const fixture: string = "1\n00:00:00.500 --> 00:00:01.750\nDot separator\n";

    expect(parseSrt(fixture)).toEqual([
      {
        index: 1,
        startSec: 0.5,
        endSec: 1.75,
        text: "Dot separator",
      },
    ]);
  });

  it("throws on malformed timestamp lines", () => {
    const fixture: string = "1\n00:00:00 --> 00:00:01,000\nBad timestamp\n";

    expect(() => parseSrt(fixture)).toThrow(/Malformed timestamp line in block 1/);
  });

  it("throws when the timestamp line is missing the arrow", () => {
    const fixture: string = "1\n00:00:00,000 to 00:00:01,000\nBad timestamp\n";

    expect(() => parseSrt(fixture)).toThrow(/Missing --> in block 1/);
  });

  it("throws when the cue index is not numeric", () => {
    const fixture: string = "A\n00:00:00,000 --> 00:00:01,000\nBad index\n";

    expect(() => parseSrt(fixture)).toThrow(/Unparseable index in block 1/);
  });

  it("throws when the end timestamp is before the start", () => {
    const fixture: string = "1\n00:00:02,000 --> 00:00:01,000\nBackwards\n";

    expect(() => parseSrt(fixture)).toThrow(/End timestamp before start in block 1/);
  });
});

describe("parseWhisperJson", () => {
  it("parses a valid Whisper segments payload", () => {
    const result = parseWhisperJson({
      segments: [
        { start: 0, end: 1.2, text: "  Hello  " },
        { start: 1.2, end: 2.5, text: "world" },
      ],
    });

    expect(result).toEqual([
      { index: 0, startSec: 0, endSec: 1.2, text: "Hello" },
      { index: 1, startSec: 1.2, endSec: 2.5, text: "world" },
    ]);
  });

  it("throws when segments is missing", () => {
    expect(() => parseWhisperJson({})).toThrow(/segments must be an array/);
  });

  it("throws when start is not numeric", () => {
    expect(() =>
      parseWhisperJson({
        segments: [{ start: "0", end: 1, text: "hello" }],
      }),
    ).toThrow(/segments\[0\]\.start must be a finite number/);
  });

  it("throws when text is not a string", () => {
    expect(() =>
      parseWhisperJson({
        segments: [{ start: 0, end: 1, text: 123 }],
      }),
    ).toThrow(/segments\[0\]\.text must be a string/);
  });
});

describe("planTimeline", () => {
  it("detects and reports overruns", () => {
    const segments = [
      { index: 0, startSec: 0, endSec: 1, text: "a" },
      { index: 1, startSec: 2, endSec: 3, text: "b" },
    ];

    const plan = planTimeline(segments, [0.8, 1.5], 4);

    expect(plan.placements).toEqual([
      { index: 0, startSec: 0, slotSec: 1, synthSec: 0.8, overrunSec: 0 },
      { index: 1, startSec: 2, slotSec: 1, synthSec: 1.5, overrunSec: 0.5 },
    ]);
    expect(plan.overruns).toEqual([
      { index: 1, startSec: 2, slotSec: 1, synthSec: 1.5, overrunSec: 0.5 },
    ]);
  });

  it("returns no overruns when every synth duration fits", () => {
    const segments = [{ index: 4, startSec: 5, endSec: 7, text: "fit" }];

    const plan = planTimeline(segments, [1.25], 10);

    expect(plan.overruns).toEqual([]);
    expect(plan.placements[0]?.startSec).toBe(5);
    expect(plan.totalDurationSec).toBe(10);
  });

  it("throws on length mismatch", () => {
    const segments = [{ index: 0, startSec: 0, endSec: 1, text: "a" }];

    expect(() => planTimeline(segments, [], 1)).toThrow(/same length/);
  });

  it("preserves original start times and extends total duration when the last segment overflows", () => {
    const segments = [
      { index: 7, startSec: 1.5, endSec: 2.5, text: "first" },
      { index: 8, startSec: 10, endSec: 11, text: "last" },
    ];

    const plan = planTimeline(segments, [0.4, 3], 12);

    expect(plan.placements.map((placement) => placement.startSec)).toEqual([1.5, 10]);
    expect(plan.totalDurationSec).toBe(13);
  });
});

describe("formatTimestamp", () => {
  it("formats zero", () => {
    expect(formatTimestamp(0)).toBe("00:00:00.000");
  });

  it("formats hours, minutes, seconds, and milliseconds", () => {
    expect(formatTimestamp(3661.5)).toBe("01:01:01.500");
  });

  it("throws on negative input", () => {
    expect(() => formatTimestamp(-0.1)).toThrow(/seconds must be a finite, non-negative number/);
  });
});
