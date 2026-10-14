// src/lib/sessionLink.ts
//
// One place that answers "which URL does a student click to join this session".
//
// Join links live in two columns: CohortSession.meetingLink (written by the Zoom
// sync, or set by hand in the admin Sessions panel) and Cohort.zoomLink (the
// cohort-wide recurring meeting). Every student-facing surface — ManageView, the
// dashboard calendar, drip reminders, the free-seat email, /members/calls — used
// to pick one column each, so half of them showed nothing for a cohort whose
// sessions carried the link and the other half for a cohort whose cohort row did.
// They all go through resolveJoinLink now.
//
// A session may also *borrow* another cohort's session link (CohortSession.
// linkedSessionId). The borrowed URL is resolved server-side and copied into
// meetingLink, so reading a link never needs to walk the relation — the link is
// always local, and linkedSessionId is provenance only.

import prisma from "@/lib/prisma";

export type JoinLinkSource = {
  meetingLink: string | null;
  cohort: { zoomLink: string | null } | null;
};

/** Trimmed value, or null when the column holds nothing usable ("" / whitespace). */
function present(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The session's own link, else its cohort's, else nothing. Blank strings count as
 * "no link": an empty `meetingLink` must fall through to the cohort rather than
 * render an anchor pointing at the current page.
 */
export function resolveJoinLink(session: JoinLinkSource): string | null {
  return present(session.meetingLink) ?? present(session.cohort?.zoomLink) ?? null;
}

/**
 * Whether a value is a link safe to store and later render as an href. Only
 * http/https — `javascript:` and `data:` URLs are executable in an anchor, and a
 * bare host ("zoom.us/j/1") would resolve relative to the hub when clicked.
 */
export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false; // Not absolute, or not a URL at all.
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * Push a freshly-attached recording out to every session that borrowed this
 * session's meeting, skipping any that already have their own recording — a
 * borrowed link must never overwrite a session's real one.
 *
 * Returns the number of rows filled. Callers treat this as best-effort follow-up
 * to the write that produced `recordingLink`, not as part of it.
 */
export async function propagateRecordingLink(
  sessionId: string,
  recordingLink: string
): Promise<number> {
  const link = present(recordingLink);
  // Guard: an empty link here would write nulls over borrowed recordings, which
  // reads as "the recording disappeared" on /members/calls.
  if (!link) return 0;

  const result = await prisma.cohortSession.updateMany({
    where: { linkedSessionId: sessionId, recordingLink: null },
    data: { recordingLink: link },
  });
  return result.count;
}
