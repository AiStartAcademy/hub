export interface Segment {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

export interface PlacedSegment {
  index: number;
  startSec: number;
  slotSec: number;
  synthSec: number;
  overrunSec: number;
}

export interface TimelinePlan {
  placements: PlacedSegment[];
  overruns: PlacedSegment[];
  totalDurationSec: number;
}

const TIMESTAMP_PATTERN =
  /^(\d{2}):(\d{2}):(\d{2})([,.])(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})([,.])(\d{3})$/;

function parseTimestampToSeconds(raw: string, blockIndex: number): number {
  const match: RegExpMatchArray | null = raw.match(/^(\d{2}):(\d{2}):(\d{2})([,.])(\d{3})$/);

  if (match === null) {
    throw new Error(
      `Malformed timestamp line in block ${blockIndex}: ${JSON.stringify(raw)}`,
    );
  }

  const hours: number = Number(match[1]);
  const minutes: number = Number(match[2]);
  const seconds: number = Number(match[3]);
  const milliseconds: number = Number(match[5]);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite, non-negative number`);
  }
}

export function parseSrt(srt: string): Segment[] {
  const normalized: string = srt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rawBlocks: string[] = normalized.split(/\n\s*\n/);
  const segments: Segment[] = [];

  rawBlocks.forEach((rawBlock: string, rawBlockIndex: number) => {
    if (rawBlock.trim() === "") {
      return;
    }

    const blockIndex: number = rawBlockIndex + 1;
    const lines: string[] = rawBlock.split("\n");
    const indexLine: string = (lines[0] ?? "").trim();

    if (!/^\d+$/.test(indexLine)) {
      throw new Error(`Unparseable index in block ${blockIndex}: ${JSON.stringify(lines[0] ?? "")}`);
    }

    const timestampLine: string = (lines[1] ?? "").trim();

    if (!timestampLine.includes("-->")) {
      throw new Error(`Missing --> in block ${blockIndex}: ${JSON.stringify(lines[1] ?? "")}`);
    }

    const timestampMatch: RegExpMatchArray | null = timestampLine.match(TIMESTAMP_PATTERN);

    if (timestampMatch === null) {
      throw new Error(
        `Malformed timestamp line in block ${blockIndex}: ${JSON.stringify(lines[1] ?? "")}`,
      );
    }

    const startRaw: string = `${timestampMatch[1]}:${timestampMatch[2]}:${timestampMatch[3]}${timestampMatch[4]}${timestampMatch[5]}`;
    const endRaw: string = `${timestampMatch[6]}:${timestampMatch[7]}:${timestampMatch[8]}${timestampMatch[9]}${timestampMatch[10]}`;
    const startSec: number = parseTimestampToSeconds(startRaw, blockIndex);
    const endSec: number = parseTimestampToSeconds(endRaw, blockIndex);

    if (endSec < startSec) {
      throw new Error(
        `End timestamp before start in block ${blockIndex}: ${JSON.stringify(lines[1] ?? "")}`,
      );
    }

    const text: string = lines
      .slice(2)
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .join(" ");

    segments.push({
      index: Number(indexLine),
      startSec,
      endSec,
      text,
    });
  });

  return segments;
}

export function parseWhisperJson(raw: unknown): Segment[] {
  if (raw === null || typeof raw !== "object" || !("segments" in raw)) {
    throw new Error("Invalid Whisper JSON: segments must be an array");
  }

  const candidate: { segments: unknown } = raw as { segments: unknown };

  if (!Array.isArray(candidate.segments)) {
    throw new Error("Invalid Whisper JSON: segments must be an array");
  }

  return candidate.segments.map((entry: unknown, index: number): Segment => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`Invalid Whisper JSON: segments[${index}] must be an object`);
    }

    const segment: {
      start?: unknown;
      end?: unknown;
      text?: unknown;
    } = entry as { start?: unknown; end?: unknown; text?: unknown };

    if (typeof segment.start !== "number" || !Number.isFinite(segment.start)) {
      throw new Error(`Invalid Whisper JSON: segments[${index}].start must be a finite number`);
    }

    if (typeof segment.end !== "number" || !Number.isFinite(segment.end)) {
      throw new Error(`Invalid Whisper JSON: segments[${index}].end must be a finite number`);
    }

    if (typeof segment.text !== "string") {
      throw new Error(`Invalid Whisper JSON: segments[${index}].text must be a string`);
    }

    return {
      index,
      startSec: segment.start,
      endSec: segment.end,
      text: segment.text.trim(),
    };
  });
}

export function planTimeline(
  segments: Segment[],
  synthDurationsSec: number[],
  totalDurationSec: number,
): TimelinePlan {
  if (segments.length !== synthDurationsSec.length) {
    throw new Error("segments and synthDurationsSec must have the same length");
  }

  assertFiniteNonNegative(totalDurationSec, "totalDurationSec");

  const placements: PlacedSegment[] = segments.map(
    (segment: Segment, index: number): PlacedSegment => {
      assertFiniteNonNegative(segment.startSec, `segments[${index}].startSec`);
      assertFiniteNonNegative(segment.endSec, `segments[${index}].endSec`);

      const slotSec: number = segment.endSec - segment.startSec;

      assertFiniteNonNegative(slotSec, `segments[${index}] slot duration`);

      const synthSec: number = synthDurationsSec[index] ?? Number.NaN;

      assertFiniteNonNegative(synthSec, `synthDurationsSec[${index}]`);

      return {
        index: segment.index,
        startSec: segment.startSec,
        slotSec,
        synthSec,
        overrunSec: Math.max(0, synthSec - slotSec),
      };
    },
  );

  const overruns: PlacedSegment[] = placements.filter(
    (placement: PlacedSegment): boolean => placement.overrunSec > 0,
  );

  let effectiveTotalDurationSec: number = totalDurationSec;

  if (placements.length > 0) {
    const lastPlacement: PlacedSegment = placements[placements.length - 1];
    effectiveTotalDurationSec = Math.max(
      effectiveTotalDurationSec,
      lastPlacement.startSec + lastPlacement.synthSec,
    );
  }

  return {
    placements,
    overruns,
    totalDurationSec: effectiveTotalDurationSec,
  };
}

export function formatTimestamp(seconds: number): string {
  assertFiniteNonNegative(seconds, "seconds");

  const totalMilliseconds: number = Math.round(seconds * 1000);
  const hours: number = Math.floor(totalMilliseconds / 3_600_000);
  const minutes: number = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const remainingSeconds: number = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds: number = totalMilliseconds % 1000;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0"),
  ].join(":") + `.${String(milliseconds).padStart(3, "0")}`;
}
