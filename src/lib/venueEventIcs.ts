// src/lib/venueEventIcs.ts
//
// Minimal RFC 5545 VCALENDAR writer for venue events. Hand-rolled rather than
// pulling a dependency: the surface we need is one VEVENT with UTC stamps, and
// the fiddly parts (CRLF, escaping, 75-octet folding) are a few lines each.

import { brand, brandFullAddress } from "@/config/brand";
import { resolveEventInstants, type VenueEventTimeInput } from "@/lib/venueEventTime";

const PRODID = `-//${brand.ids.icsOrganization}//Hub Events//EN`;
const VENUE_LOCATION = `${brand.wordmark}, ${brandFullAddress}`;

export type IcsEventInput = VenueEventTimeInput & {
  slug: string;
  title: string;
  summaryText: string | null;
  isOnline: boolean;
  url: string;
};

/** RFC 5545 §3.3.11: backslash, semicolon and comma escape; newlines become \n. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function stampUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Content lines are limited to 75 octets. Fold on octets, not characters, or a
 * multi-byte character can be split across the fold and corrupt the file.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Don't cut mid-codepoint: continuation bytes are 0b10xxxxxx.
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74; // continuation lines carry a leading space
  }

  return chunks.join("\r\n ");
}

export function buildVenueEventIcs(event: IcsEventInput): string {
  const { startUtc, endUtc } = resolveEventInstants(event);
  const location = event.isOnline
    ? "Online"
    : VENUE_LOCATION;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.slug}@${brand.domains.hub}`,
    // DTSTAMP must be the creation instant; using the start time makes some
    // clients treat a re-download as the same unchanged object.
    `DTSTAMP:${stampUtc(new Date())}`,
    `DTSTART:${stampUtc(startUtc)}`,
    `DTEND:${stampUtc(endUtc)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(location)}`,
    `URL:${escapeText(event.url)}`,
    event.summaryText ? `DESCRIPTION:${escapeText(event.summaryText)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** "Add to Google Calendar" template URL — the web equivalent of the .ics. */
export function googleCalendarTemplateUrl(event: IcsEventInput): string {
  const { startUtc, endUtc } = resolveEventInstants(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stampUtc(startUtc)}/${stampUtc(endUtc)}`,
    location: event.isOnline
      ? "Online"
      : VENUE_LOCATION,
    details: event.summaryText ? `${event.summaryText}\n\n${event.url}` : event.url,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
