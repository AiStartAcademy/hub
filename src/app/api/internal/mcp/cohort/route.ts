import { NextResponse } from "next/server";
import { requireManagedServiceToken } from "@/lib/serviceAuth";
import { mcpWritesEnabled } from "@/lib/mcpApi";
import { ZOOM_WEEKDAYS, type CreateZoomMeetingInput, type ZoomWeekday } from "@/lib/zoom";
import { logger } from "@/lib/logger";
import { CohortCreateError, createCohort } from "@/lib/cohortCreate";

/**
 * Machine-callable cohort creation for hub-mcp.
 *
 * Every other cohort route authenticates via a NextAuth session cookie, which a
 * headless MCP process cannot present. This route uses a shared bearer secret
 * instead — the same pattern as the n8n callbacks.
 *
 * Deliberate limits (see hub-mcp/work/DECISIONS.md D-010):
 *   - creates only; never updates or deletes
 *   - status is hardcoded DRAFT and cannot be overridden by the caller
 *   - fails closed when HUB_MCP_WRITES_ENABLED is not exactly "true"
 * A DRAFT cohort is invisible to students and cannot be bought, so the worst
 * outcome of a confused agent is clutter in the admin list.
 */

interface GroupInput {
  name?: unknown;
  price?: unknown;
  seats?: unknown;
  inPerson?: unknown;
}

interface CohortInput {
  title?: unknown;
  description?: unknown;
  deliveryMode?: unknown;
  location?: unknown;
  zoomLink?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  startTime?: unknown; // e.g. "6:00 PM" — daily session start, wall-clock
  endTime?: unknown; // e.g. "9:00 PM" — daily session end, wall-clock
  timezone?: unknown; // IANA, e.g. "America/Los_Angeles". Required if createZoomMeeting is true.
  createZoomMeeting?: unknown; // if true, creates a real recurring Zoom meeting and uses it as zoomLink
  zoomDays?: unknown; // e.g. ["MON","TUE","WED","THU"] — required if createZoomMeeting is true, no default
  instructorEmails?: unknown; // existing Users, attached as cohort instructors. NOTE: stage has no User.email data (deliberately stripped) — this will 400 there; only usable once promoted to prod.
  programTitles?: unknown; // existing Programs (courses), merged with the COHORT_DEFAULT_PROGRAM_TITLES config template
  rawProgramTitle?: unknown; // existing Program to set as the 1:1 recording-import target (Cohort.rawProgramId)
  groups?: unknown;
}

const DELIVERY_MODES = ["ONLINE", "INPERSON", "HYBRID"] as const;
type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** A real type predicate: `DELIVERY_MODES.includes(x as DeliveryMode)` type-checks but
 *  narrows nothing, so the validated value stayed a bare `string` at the call site. */
function isDeliveryMode(value: string): value is DeliveryMode {
  return (DELIVERY_MODES as readonly string[]).includes(value);
}

function parseDate(v: unknown, field: string): Date | null | string {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return `${field} must be an ISO date string`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return `${field} is not a valid date: ${v}`;
  return d;
}

/** Parses "6:00 PM" / "18:00" / "10:00am" into 24h {hour, minute}. */
function parseTimeOfDay(v: unknown, field: string): { hour: number; minute: number } | string {
  if (typeof v !== "string" || !v.trim()) return `${field} must be a time string like "6:00 PM"`;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return `${field} is not a recognized time: ${v}`;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return `${field} is not a valid time: ${v}`;
  return { hour, minute };
}

export async function POST(req: Request) {
  const denied = await requireManagedServiceToken(req, "HUB_MCP_TOKEN");
  if (denied) return denied;

  // Server-side kill switch. The MCP has its own local HUB_MCP_READONLY flag,
  // but that one is bypassable by anyone holding the token — this is the real one.
  if (!(await mcpWritesEnabled())) {
    return NextResponse.json(
      { error: "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true')." },
      { status: 403 }
    );
  }

  let body: CohortInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const title = body.title.trim();

  const deliveryMode =
    typeof body.deliveryMode === "string" ? body.deliveryMode.toUpperCase() : "ONLINE";
  if (!isDeliveryMode(deliveryMode)) {
    return NextResponse.json(
      { error: `deliveryMode must be one of ${DELIVERY_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  const startDate = parseDate(body.startDate, "startDate");
  if (typeof startDate === "string") return NextResponse.json({ error: startDate }, { status: 400 });
  const endDate = parseDate(body.endDate, "endDate");
  if (typeof endDate === "string") return NextResponse.json({ error: endDate }, { status: 400 });
  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ error: "endDate is before startDate" }, { status: 400 });
  }

  const rawGroups = Array.isArray(body.groups) ? (body.groups as GroupInput[]) : [];
  // seats is optional: omitting it means "use the schema default (50)", NOT zero.
  // A forced 0 here would silently create an unsellable, sold-out tier.
  const groups: { name: string; price: number; seats?: number; inPerson: boolean }[] = [];
  for (const [i, g] of rawGroups.entries()) {
    if (typeof g?.name !== "string" || !g.name.trim()) {
      return NextResponse.json({ error: `groups[${i}].name is required` }, { status: 400 });
    }
    const price = g.price === undefined ? 0 : Number(g.price);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: `groups[${i}].price must be a non-negative number` }, { status: 400 });
    }
    const group: { name: string; price: number; seats?: number; inPerson: boolean } = {
      name: g.name.trim(),
      price,
      inPerson: g.inPerson === true,
    };
    if (g.seats !== undefined) {
      const seats = Number(g.seats);
      if (!Number.isInteger(seats) || seats < 0) {
        return NextResponse.json({ error: `groups[${i}].seats must be a non-negative integer` }, { status: 400 });
      }
      group.seats = seats;
    }
    groups.push(group);
  }

  // Daily session time-of-day — optional, but required (together) if createZoomMeeting is set.
  let startTimeOfDay: { hour: number; minute: number } | null = null;
  let endTimeOfDay: { hour: number; minute: number } | null = null;
  if (body.startTime !== undefined) {
    const parsed = parseTimeOfDay(body.startTime, "startTime");
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    startTimeOfDay = parsed;
  }
  if (body.endTime !== undefined) {
    const parsed = parseTimeOfDay(body.endTime, "endTime");
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    endTimeOfDay = parsed;
  }
  const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : null;

  const wantsZoomMeeting = body.createZoomMeeting === true;
  let zoomDays: ZoomWeekday[] = [];
  if (wantsZoomMeeting) {
    if (!startDate || !endDate) {
      return NextResponse.json({ error: "createZoomMeeting requires startDate and endDate" }, { status: 400 });
    }
    if (!startTimeOfDay || !endTimeOfDay) {
      return NextResponse.json({ error: "createZoomMeeting requires startTime and endTime" }, { status: 400 });
    }
    if (!timezone) {
      return NextResponse.json({ error: "createZoomMeeting requires timezone (IANA, e.g. America/Los_Angeles)" }, { status: 400 });
    }
    // No default — cohort formats genuinely differ (e.g. an evening format may be
    // Mon–Thu while a daytime intensive is Mon–Fri). A silent Mon–Fri assumption already produced one
    // wrong recurrence; the caller must say explicitly.
    const rawDays = Array.isArray(body.zoomDays) ? (body.zoomDays as unknown[]) : [];
    if (!rawDays.length) {
      return NextResponse.json(
        { error: `createZoomMeeting requires zoomDays (e.g. ["MON","TUE","WED","THU"]) — no default is assumed` },
        { status: 400 }
      );
    }
    const invalid = rawDays.filter((d) => typeof d !== "string" || !ZOOM_WEEKDAYS.includes(d as ZoomWeekday));
    if (invalid.length) {
      return NextResponse.json(
        { error: `zoomDays contains invalid values: ${invalid.join(", ")}. Must be from ${ZOOM_WEEKDAYS.join(", ")}` },
        { status: 400 }
      );
    }
    zoomDays = rawDays as ZoomWeekday[];
  }

  let zoomMeeting: CreateZoomMeetingInput | null = null;
  if (wantsZoomMeeting && startDate && endDate && startTimeOfDay && endTimeOfDay && timezone) {
    const durationMinutes =
      endTimeOfDay.hour * 60 + endTimeOfDay.minute -
      (startTimeOfDay.hour * 60 + startTimeOfDay.minute);
    if (durationMinutes <= 0) {
      return NextResponse.json({ error: "endTime must be after startTime" }, { status: 400 });
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = startDate.toISOString().slice(0, 10);
    zoomMeeting = {
      topic: title,
      firstSessionStartLocal: `${dateStr}T${pad(startTimeOfDay.hour)}:${pad(startTimeOfDay.minute)}:00`,
      durationMinutes,
      timezone,
      lastSessionDate: endDate,
      days: zoomDays,
    };
  }

  // Request-shape coercion stays here; existence validation happens in createCohort.
  const instructorEmails = Array.isArray(body.instructorEmails)
    ? (body.instructorEmails as unknown[]).filter((e): e is string => typeof e === "string" && !!e.trim())
    : [];
  const explicitProgramTitles = Array.isArray(body.programTitles)
    ? (body.programTitles as unknown[]).filter((t): t is string => typeof t === "string" && !!t.trim())
    : [];
  const rawProgramTitle = typeof body.rawProgramTitle === "string" ? body.rawProgramTitle.trim() : "";

  try {
    const result = await createCohort({
      title,
      description: typeof body.description === "string" ? body.description : null,
      // Not caller-controllable. See the header comment.
      status: "DRAFT",
      deliveryMode,
      location: typeof body.location === "string" ? body.location : null,
      zoomLink: typeof body.zoomLink === "string" ? body.zoomLink : null,
      startDate,
      endDate,
      startTime: typeof body.startTime === "string" ? body.startTime : null,
      endTime: typeof body.endTime === "string" ? body.endTime : null,
      timezone,
      instructorEmails,
      programTitles: explicitProgramTitles,
      rawProgramTitle: rawProgramTitle || null,
      groups,
      zoomMeeting,
    });
    const { cohort } = result;

    return NextResponse.json({
      id: cohort.id,
      slug: cohort.slug,
      title: cohort.title,
      status: cohort.status,
      deliveryMode: cohort.deliveryMode,
      startDate: cohort.startDate,
      endDate: cohort.endDate,
      zoomLink: cohort.zoomLink,
      zoomMeetingId: cohort.zoomMeetingId,
      zoomWarning: result.zoomWarning,
      sessionsCreated: result.sessionsCreated,
      sessionsNote: result.sessionsNote,
      instructors: cohort.instructors,
      programs: cohort.programs,
      rawProgram: cohort.rawProgram,
      // Slug may have been de-duplicated; the caller needs to see the real one.
      slugWasAdjusted: result.slug !== title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      groups: cohort.groups.map((g) => ({ id: g.id, name: g.name, price: g.price, seats: g.seats })),
    });
  } catch (error) {
    if (error instanceof CohortCreateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "[MCP] Cohort create failed:");
    return NextResponse.json({ error: "Failed to create cohort" }, { status: 500 });
  }
}
