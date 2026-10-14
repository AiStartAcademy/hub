import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";

import {
  assignNeutralIds,
  buildHubCallPatchUrl,
  buildHubCallsUrl,
  buildHubRecordingUrl,
  buildRecordingsPageUrl,
  filterHallucinations,
  findLeaks,
  formatMonth,
  formatTranscriptTimestamp,
  maskPhone,
  mergeChannelSegments,
  parseArgs,
  parseCsv,
  parseEntitiesJson,
  redactEntities,
  redactText,
  renderMarkdown,
  renderTranscript,
  resolveTwilioPageUrl,
  serializeCsv,
  wordSpan,
  type CallIdentity,
  type ChannelSegment,
  type IndexRow,
  type MappingRow,
} from "../../scripts/call-transcripts/core";

function segment(
  channel: number,
  startSec: number,
  endSec: number,
  text: string,
  noSpeechProb?: number,
): ChannelSegment {
  return { index: 0, channel, startSec, endSec, text, noSpeechProb };
}

describe("channel filtering and merge", () => {
  it("orders interleaved channels and labels ch0 Closer / ch1 Lead", () => {
    expect(
      mergeChannelSegments(
        [segment(0, 0, 0.5, "Hello"), segment(0, 3, 4, "Goodbye")],
        [segment(1, 1, 2, "Hi")],
      ),
    ).toEqual([
      { speaker: "Closer", start: 0, end: 0.5, text: "Hello" },
      { speaker: "Lead", start: 1, end: 2, text: "Hi" },
      { speaker: "Closer", start: 3, end: 4, text: "Goodbye" },
    ]);
  });

  it("flips channel labels when swap is enabled", () => {
    const merged = mergeChannelSegments(
      [segment(0, 0, 1, "zero")],
      [segment(1, 2, 3, "one")],
      true,
    );

    expect(merged.map(({ speaker }) => speaker)).toEqual(["Lead", "Closer"]);
  });

  it("joins same-speaker segments only when the gap is below one second", () => {
    const merged = mergeChannelSegments([
      segment(0, 0, 1, "One"),
      segment(0, 1.9, 2.5, "two"),
      segment(0, 3.5, 4, "three"),
    ]);

    expect(merged).toEqual([
      { speaker: "Speaker", start: 0, end: 2.5, text: "One two" },
      { speaker: "Speaker", start: 3.5, end: 4, text: "three" },
    ]);
  });

  it("labels a single-channel recording Speaker", () => {
    expect(mergeChannelSegments([segment(0, 2, 3, "Mono")])).toEqual([
      { speaker: "Speaker", start: 2, end: 3, text: "Mono" },
    ]);
  });

  it("drops empty text and the third or later consecutive repeat per channel", () => {
    const filtered = filterHallucinations([
      segment(0, 0, 1, " "),
      segment(0, 1, 2, "Loop"),
      segment(1, 1.5, 2, "Loop"),
      segment(0, 2, 3, "Loop"),
      segment(0, 3, 4, "Loop"),
      segment(0, 4, 5, "Loop"),
      segment(0, 5, 6, "Different"),
      segment(0, 6, 7, "Loop"),
    ]);

    expect(filtered.map(({ channel, text }) => ({ channel, text }))).toEqual([
      { channel: 0, text: "Loop" },
      { channel: 1, text: "Loop" },
      { channel: 0, text: "Loop" },
      { channel: 0, text: "Different" },
      { channel: 0, text: "Loop" },
    ]);
  });

  it("drops stock silence phrases only above the no-speech threshold", () => {
    const phrases = ["Thank you.", "Thanks for watching!", "Subtitles by Alice", "you"];
    const input = phrases.flatMap((text, index) => [
      segment(0, index * 2, index * 2 + 0.5, text, 0.61),
      segment(0, index * 2 + 1, index * 2 + 1.5, text, 0.6),
    ]);

    expect(filterHallucinations(input).map(({ text }) => text)).toEqual(phrases);
  });
});

describe("transcript rendering", () => {
  it("uses [MM:SS] and unbounded minutes above one hour", () => {
    expect(formatTranscriptTimestamp(61)).toBe("[01:01]");
    expect(formatTranscriptTimestamp(3665)).toBe("[61:05]");
    expect(
      renderTranscript([{ speaker: "Lead", start: 3665, end: 3666, text: "Hello" }]),
    ).toBe("[61:05] Lead: Hello");
  });
});

describe("redaction", () => {
  it("redacts phone formats, email, URL, and street addresses", () => {
    const source = [
      "+1 (415) 555-0123",
      "415-555-0123",
      "4155550123",
      "me@example.com",
      "https://example.com/path?q=1",
      "123 Main St",
      "42 Market Avenue",
      "7 Long Road",
      "99 Broadway Blvd",
      "5 Pine Lane",
      "6 Oak Ln",
      "8 Lake Dr",
      "9 Hill Drive",
      "10 Easy Way",
      "11 High Ct",
      "12 County Court",
    ].join(" | ");
    const redacted = redactText(source);

    expect(redacted.match(/\[PHONE\]/g)).toHaveLength(3);
    expect(redacted).toContain("[EMAIL]");
    expect(redacted).toContain("[URL]");
    expect(redacted.match(/\[ADDRESS\]/g)).toHaveLength(11);
    expect(redacted).not.toMatch(/415|example\.com|Main St|County Court/);
  });

  it("redacts full names and tokens of 3+ chars with boundaries and escaped regex", () => {
    const redacted = redactText(
      `Ann met ANN Smith and ${brand.signer.name} with A.B. Person. Annual plans mention lexical.`,
      {
        leadNames: ["Ann Smith", "A.B. Person"],
        closerNames: [brand.signer.name],
      },
    );

    expect(redacted).toBe(
      "[LEAD] met [LEAD] and [CLOSER] with [LEAD]. Annual plans mention lexical.",
    );
  });

  it("parses and applies entity redaction", () => {
    const entities = parseEntitiesJson(
      JSON.stringify({
        entities: [
          { text: "Jane Doe", type: "PERSON" },
          { text: "Acme (West)", type: "COMPANY" },
          { text: "Paris", type: "CITY" },
        ],
      }),
    );

    expect(redactEntities("Jane Doe joined Acme (West) in Paris.", entities)).toBe(
      "[PERSON] joined [COMPANY] in [CITY].",
    );
  });

  it("rejects malformed entity output", () => {
    expect(() => parseEntitiesJson("{" )).toThrow(/valid JSON/);
    expect(() => parseEntitiesJson("{}" )).toThrow(/entities must be an array/);
    expect(() =>
      parseEntitiesJson('{"entities":[{"text":"X","type":"COUNTRY"}]}'),
    ).toThrow(/type/);
  });

  it("finds likely leaks but ignores timestamps and passes clean text", () => {
    expect(findLeaks("[61:05] Lead: A safe [PHONE] and [EMAIL].", ["Ann Smith"])).toEqual([]);

    const leaks = findLeaks(
      "[61:05] 1234567 contact@site.test http://site.test Ann arrived",
      ["Ann Smith"],
    );

    expect(leaks).toEqual(expect.arrayContaining(["7+ digit run", "@", "http", "known name: Ann"]));
  });
});

describe("mapping and Twilio helpers", () => {
  const calls: CallIdentity[] = [
    {
      callSid: "CAnewer",
      recordingSid: "REnewer",
      dialedNumber: "+14155550102",
      startedAt: "2026-02-01T00:00:00Z",
    },
    {
      callSid: "CAolder",
      recordingSid: "REolder",
      dialedNumber: "+14155550101",
      startedAt: "2026-01-01T00:00:00Z",
    },
  ];

  it("assigns ids by start time and preserves them when earlier calls arrive", () => {
    const first = assignNeutralIds([], calls);
    expect(first.map(({ id, callSid }) => ({ id, callSid }))).toEqual([
      { id: "call-001", callSid: "CAolder" },
      { id: "call-002", callSid: "CAnewer" },
    ]);

    const rerun = assignNeutralIds(first, [
      ...calls,
      {
        callSid: "CAearliest",
        recordingSid: "REearliest",
        dialedNumber: "+14155550100",
        startedAt: "2025-12-01T00:00:00Z",
      },
    ]);
    expect(rerun.find(({ callSid }) => callSid === "CAearliest")?.id).toBe("call-003");
    expect(rerun.find(({ callSid }) => callSid === "CAolder")?.id).toBe("call-001");
  });

  it("builds first and relative next-page Twilio URLs", () => {
    expect(buildRecordingsPageUrl("AC123", 75)).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings.json?PageSize=75",
    );
    expect(resolveTwilioPageUrl("/2010-04-01/Accounts/AC123/Recordings.json?Page=1")).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings.json?Page=1",
    );
  });

  it("masks phone numbers to only their final two digits", () => {
    expect(maskPhone("+1 (415) 555-0123")).toBe("••23");
    expect(maskPhone("7")).toBe("••7");
    expect(maskPhone(null)).toBe("—");
  });
});

describe("CSV and anonymized output", () => {
  it("roundtrips mapping.csv values containing commas and quotes", () => {
    const headers = ["id", "callSid", "recordingSid", "dialedNumber"] as const;
    const rows: MappingRow[] = [
      {
        id: "call-001",
        callSid: 'CA"quoted,one',
        recordingSid: "RE1",
        dialedNumber: "+1,415",
      },
    ];

    expect(parseCsv<MappingRow>(serializeCsv(headers, rows), headers)).toEqual(rows);
  });

  it("roundtrips index.csv and preserves quoted paths", () => {
    const headers = [
      "callSid",
      "recordingSid",
      "dialedNumber",
      "startedAt",
      "durationSec",
      "direction",
      "rawJsonPath",
    ] as const;
    const rows: IndexRow[] = [
      {
        callSid: "CA1",
        recordingSid: "RE1",
        dialedNumber: "+14155550123",
        startedAt: "2026-07-04T12:00:00Z",
        durationSec: "125",
        direction: "outbound-api",
        rawJsonPath: 'raw/a,"b".json',
      },
    ];

    expect(parseCsv<IndexRow>(serializeCsv(headers, rows), headers)).toEqual(rows);
  });

  it("formats UTC month and renders metadata without Twilio SID patterns", () => {
    expect(formatMonth("2026-07-31T23:30:00-07:00")).toBe("2026-08");
    const markdown = renderMarkdown({
      id: "call-007",
      startedAt: "2026-08-01T06:30:00Z",
      durationSec: 125,
      transcript: "[00:00] Closer: Hello\n[00:02] Lead: Hi",
    });

    expect(markdown).toContain("# call-007");
    expect(markdown).toContain("Month: 2026-08");
    expect(markdown).toContain("Duration: 2.1 minutes");
    expect(markdown).not.toMatch(/\b(?:CA|RE)[0-9A-Za-z]{8,}\b/);
  });
});

describe("argument parsing", () => {
  it("parses run defaults and overrides", () => {
    expect(
      parseArgs([
        "run",
        "--out",
        "private",
        "--limit",
        "3",
        "--since",
        "2026-01-02",
        "--swap-channels",
        "--force",
      ]),
    ).toEqual({
      command: "run",
      out: "private",
      source: "twilio",
      limit: 3,
      since: "2026-01-02",
      minDuration: 20,
      swapChannels: true,
      whisperCmd: "uvx --from mlx-whisper mlx_whisper",
      model: "mlx-community/whisper-large-v3-turbo",
      force: true,
      noWriteback: false,
    });
  });

  it("SC3.1: parses hub run mode, no-writeback, and push", () => {
    expect(parseArgs(["run", "--out", "private", "--source", "hub", "--no-writeback"])).toMatchObject({
      command: "run",
      out: "private",
      source: "hub",
      noWriteback: true,
    });
    expect(parseArgs(["push", "--out", "private"])).toEqual({
      command: "push",
      out: "private",
    });
  });

  it("SC3.2: builds bounded hub list, recording, and patch URLs", () => {
    expect(
      buildHubCallsUrl("https://hub.example/", {
        needsTranscript: true,
        provider: "twilio",
        limit: 50,
        since: "2026-10-01",
        cursor: "call 1",
        providerCallId: "CA123",
      }),
    ).toBe(
      "https://hub.example/api/internal/mcp/v1/calls?needsTranscript=1&provider=twilio&limit=50&since=2026-10-01&cursor=call+1&providerCallId=CA123",
    );
    expect(buildHubRecordingUrl("https://hub.example/", "call/1")).toBe(
      "https://hub.example/api/internal/mcp/v1/calls/call%2F1/recording",
    );
    expect(buildHubCallPatchUrl("https://hub.example/", "call/1")).toBe(
      "https://hub.example/api/internal/mcp/v1/calls/call%2F1",
    );
  });

  it("requires output directories and parses anonymize lists", () => {
    expect(() => parseArgs(["run"])).toThrow(/--out/);
    expect(() => parseArgs(["anonymize", "--out", "private"])).toThrow(/--drive-dir/);
    expect(
      parseArgs([
        "anonymize",
        "--out",
        "private",
        "--drive-dir",
        "drive",
        "--closer-names",
        `${brand.signer.name.split(/\s+/)[0]},${brand.signer.name}`,
      ]),
    ).toEqual({
      command: "anonymize",
      out: "private",
      driveDir: "drive",
      closerNames: [brand.signer.name.split(/\s+/)[0], brand.signer.name],
    });
  });
});

describe("word-level timing", () => {
  it("uses the first and last word so leading silence does not pull a segment to 0", () => {
    const raw = { start: 0, end: 9.24, words: [{ start: 5.34, end: 5.8 }, { start: 6.0, end: 9.24 }] };
    expect(wordSpan(raw)).toEqual({ startSec: 5.34, endSec: 9.24 });
  });

  it("returns undefined when words are missing, empty, or malformed", () => {
    expect(wordSpan({ start: 0, end: 2 })).toBeUndefined();
    expect(wordSpan({ words: [] })).toBeUndefined();
    expect(wordSpan({ words: [{ start: "x", end: 1 }] })).toBeUndefined();
    expect(wordSpan(null)).toBeUndefined();
  });
});
