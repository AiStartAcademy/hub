// src/lib/bookingIcs.ts
//
// Minimal RFC 5545 VCALENDAR writer for lead bookings. The booking already
// stores absolute instants, so the event is emitted entirely in UTC.

import { brand } from "@/config/brand";

const PRODID = `-//${brand.ids.icsOrganization}//Hub Lead Booking//EN`;

export type BookingIcsInput = {
  id: string;
  startAt: Date;
  endAt: Date;
  summary: string;
  zoomJoinUrl: string;
};

export function leadBookingIcsFilename(prefix: string): string {
  return `${prefix}-1-on-1.ics`;
}

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

/** Fold RFC 5545 content lines at 75 octets without splitting UTF-8 codepoints. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74;
  }

  return chunks.join("\r\n ");
}

export function buildBookingIcs(booking: BookingIcsInput): string {
  const summary = booking.summary.trim();
  const zoomJoinUrl = booking.zoomJoinUrl.trim();

  if (!booking.id.trim()) throw new Error("buildBookingIcs: booking id is required");
  if (!summary) throw new Error("buildBookingIcs: summary is required");
  if (!zoomJoinUrl) throw new Error("buildBookingIcs: Zoom join URL is required");
  if (Number.isNaN(booking.startAt.getTime()) || Number.isNaN(booking.endAt.getTime())) {
    throw new Error("buildBookingIcs: startAt and endAt must be valid dates");
  }
  if (booking.endAt.getTime() <= booking.startAt.getTime()) {
    throw new Error("buildBookingIcs: endAt must be after startAt");
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(booking.id)}`,
    `DTSTAMP:${stampUtc(new Date())}`,
    `DTSTART:${stampUtc(booking.startAt)}`,
    `DTEND:${stampUtc(booking.endAt)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(`Join Zoom: ${zoomJoinUrl}`)}`,
    `LOCATION:${escapeText(zoomJoinUrl)}`,
    `URL:${escapeText(zoomJoinUrl)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
