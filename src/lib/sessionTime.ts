// Shared formatting for cohort session date/times.
//
// Sessions are stored as UTC ISO strings plus the IANA zone the session is
// actually run in (both written by the Zoom sync). We format at render time so
// each viewer can also see the time in their own zone — see ScheduleRow in
// CohortsPublic and the Sessions panel in the cohort edit page.

/** Sessions are run out of SF; used when Zoom hands us a zone we can't resolve. */
export const SESSION_TZ_FALLBACK = "America/Los_Angeles";

/** "22 JUL 2026 · 18:00 PDT" — rendered in the given IANA zone. */
export function fmtSessionWhen(iso: string, tz: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const build = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: zone, timeZoneName: "short",
    }).formatToParts(d);
  let parts;
  try {
    parts = build(tz);
  } catch {
    parts = build(SESSION_TZ_FALLBACK); // Intl throws RangeError on unknown zones
  }
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")} ${g("month").toUpperCase()} ${g("year")} · ${g("hour")}:${g("minute")} ${g("timeZoneName")}`;
}

/** The viewer's own IANA zone. Browser-only — call from an effect, not render. */
export function viewerTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || SESSION_TZ_FALLBACK;
  } catch {
    return SESSION_TZ_FALLBACK;
  }
}

/**
 * Both lines for one session: the session's own zone, and the viewer's zone
 * when it actually reads differently. `viewerTz` is null until mount.
 */
export function sessionWhenLines(
  startTime: string | null,
  timezone: string | null,
  viewerTz: string | null
): { main: string | null; viewer: string | null } {
  if (!startTime) return { main: null, viewer: null };
  const sessionTz = timezone || SESSION_TZ_FALLBACK;
  const main = fmtSessionWhen(startTime, sessionTz);
  if (!viewerTz || viewerTz === sessionTz) return { main, viewer: null };
  const viewer = fmtSessionWhen(startTime, viewerTz);
  // Same wall-clock reading (e.g. another PT-equivalent zone) — no point twice.
  return { main, viewer: viewer && viewer !== main ? viewer : null };
}
