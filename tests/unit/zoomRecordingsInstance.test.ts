import { describe, expect, it } from "bun:test";
import {
  encodeZoomMeetingUuid,
  parseSyncRecordingsBody,
  zoomRecordingsUrl,
} from "@/lib/zoomRecordingsUrl";

// Criterion 2: recordings URL for the numeric meeting id vs a specific instance UUID.
describe("SC-2 Zoom recordings URL", () => {
  it("SC-2a: numeric meeting id path is unchanged", () => {
    expect(zoomRecordingsUrl("85012345678")).toBe("https://api.zoom.us/v2/meetings/85012345678/recordings");
    expect(zoomRecordingsUrl("85012345678", undefined)).toBe("https://api.zoom.us/v2/meetings/85012345678/recordings");
    expect(zoomRecordingsUrl("85012345678", null)).toBe("https://api.zoom.us/v2/meetings/85012345678/recordings");
  });

  it("SC-2b: a plain base64 UUID is single-encoded and replaces the numeric id", () => {
    expect(zoomRecordingsUrl("85012345678", "4444AAAiAAAAAiAiAiiAii==")).toBe(
      "https://api.zoom.us/v2/meetings/4444AAAiAAAAAiAiAiiAii%3D%3D/recordings",
    );
  });

  it("SC-2c: a UUID starting with '/' is double-encoded", () => {
    expect(encodeZoomMeetingUuid("/ajXp112QmuoKj4854875==")).toBe("%252FajXp112QmuoKj4854875%253D%253D");
    expect(zoomRecordingsUrl("1", "/ajXp112QmuoKj4854875==")).toBe(
      "https://api.zoom.us/v2/meetings/%252FajXp112QmuoKj4854875%253D%253D/recordings",
    );
  });

  it("SC-2d: a UUID containing '//' is double-encoded", () => {
    expect(encodeZoomMeetingUuid("abc//def+g==")).toBe("abc%252F%252Fdef%252Bg%253D%253D");
  });

  it("SC-2e: a single inner '/' or '+' without the double-encode trigger is encoded once", () => {
    expect(encodeZoomMeetingUuid("ab/c+d==")).toBe("ab%2Fc%2Bd%3D%3D");
  });
});

// Criterion 3: optional JSON body of POST /api/cohorts/[id]/sessions/sync.
describe("SC-3 sessions/sync body", () => {
  it("SC-3a: empty or whitespace body means today's behavior (no instance)", () => {
    expect(parseSyncRecordingsBody("")).toEqual({ ok: true, zoomInstanceUuid: null });
    expect(parseSyncRecordingsBody("  \n")).toEqual({ ok: true, zoomInstanceUuid: null });
    expect(parseSyncRecordingsBody("{}")).toEqual({ ok: true, zoomInstanceUuid: null });
  });

  it("SC-3b: zoomInstanceUuid is returned trimmed", () => {
    expect(parseSyncRecordingsBody('{"zoomInstanceUuid":" /abc//d== "}')).toEqual({
      ok: true,
      zoomInstanceUuid: "/abc//d==",
    });
  });

  it("SC-3c: invalid JSON, non-object, or non-string/empty uuid is a 400", () => {
    for (const raw of ["{not json", "[]", '"x"', '{"zoomInstanceUuid":5}', '{"zoomInstanceUuid":"  "}']) {
      expect(parseSyncRecordingsBody(raw)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("SC-3d: explicit null uuid behaves like no body", () => {
    expect(parseSyncRecordingsBody('{"zoomInstanceUuid":null}')).toEqual({ ok: true, zoomInstanceUuid: null });
  });
});
