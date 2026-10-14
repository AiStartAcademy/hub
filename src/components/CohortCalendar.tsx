"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { hasAnyRole } from "@/lib/roles";
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import DayEventsModal from "@/components/DayEventsModal";
// Cohort start/end are date-only values (UTC-anchored) and must be compared as
// YYYY-MM-DD strings — see calendarDate.ts. Deliberately NOT calendarUtils'
// isDateWithinInclusiveRange, which normalizes with local getters and shifts
// cohort ranges a day early for viewers west of UTC.
import { toCalendarDate, calendarDateFromParts } from "@/lib/calendarDate";
import {
  DAYS,
  MONTHS,
  buildDateKeyFromUtcIso,
  compareStartTimes,
  formatLocalTime,
  getCalendarMonthGrid,
  isSameLocalDate,
} from "@/lib/calendarUtils";

interface Cohort {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  deliveryMode: string;
  programs?: { id: string; name: string }[];
  role: "student" | "instructor" | "both";
}

interface OneOnOneSession {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  meetingLink?: string | null;
  instructor: { id: string; name: string | null; email: string; image?: string | null };
  student: { id: string; name: string | null; email: string; image?: string | null };
  group?: { id: string; name: string; cohortId: string } | null;
}

interface GroupSession {
  id: string;
  title: string;
  description?: string | null;
  timezone: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  meetingLink: string | null;
  cohortId: string;
  cohort: { title: string };
}

interface VenueCalendarEvent {
  id: string;
  slug: string;
  title: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  orgName: string | null;
}

/** A PENDING venue booking. Staff-only — never fetched for other roles. */
interface PendingHold {
  id: string;
  slug: string;
  title: string;
  orgName: string | null;
  date: string;
  startTime: string;
  endTime: string;
  dayIndex: number;
  dayCount: number;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case "DRAFT":
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
    case "ENROLLMENT":
      return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
    case "IN_PROGRESS":
      return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
    case "COMPLETE":
      return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400";
    case "ARCHIVED":
      return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400";
    default:
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
  }
};

const getRoleIcon = (role: string) => {
  if (role === "both") return "👨‍🏫📚";
  if (role === "instructor") return "👨‍🏫";
  return "📚";
};

const VENUE_EVENT_COLOR = "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";

// Pending venue bookings, shown to staff only (see PendingHold below). Grey
// reads as "held, not confirmed" against the saturated confirmed-event colours.
const PENDING_HOLD_COLOR =
  "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";

// Booking pipeline detail is commercial information. Deliberately narrower than
// MANAGE_ROLES (which includes INSTRUCTOR) — same pair the venue admin routes gate on.
const VENUE_STAFF_ROLES = ["ADMIN", "TEAM_MEMBER"] as const;

// Cohort format drives calendar colors (see legend): 3-Week Evening = blue,
// 10-Day Intensive = green. Classified from the cohort title, falling back to
// the session's local start hour (evening cohorts start at 6pm PT).
type CohortFormat = "evening" | "intensive" | "other";

const classifyCohortFormat = (title: string, startTime?: string): CohortFormat => {
  if (/evening|3-week/i.test(title)) return "evening";
  if (/intensive|10-day/i.test(title)) return "intensive";
  if (startTime) {
    const start = new Date(startTime);
    if (!Number.isNaN(start.getTime())) {
      return start.getHours() >= 16 ? "evening" : "intensive";
    }
  }
  return "other";
};

const FORMAT_COLORS: Record<CohortFormat, string> = {
  evening: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  intensive: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  other: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
};

const LEGEND_ITEMS: { dot: string; label: string }[] = [
  { dot: "bg-blue-500", label: "3-Week Evening" },
  { dot: "bg-green-500", label: "10-Day Intensive" },
  { dot: "bg-red-500", label: "Events" },
  { dot: "bg-emerald-500", label: "1:1 Sessions" },
];

// Appended only for staff — a legend entry for chips a student can never see
// would just be confusing.
const PENDING_LEGEND_ITEM = { dot: "bg-slate-400", label: "Pending hold" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parsePendingHolds = (payload: unknown): PendingHold[] => {
  if (!isRecord(payload) || !Array.isArray(payload.pending)) return [];

  return payload.pending.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const { id, slug, title, orgName, date, startTime, endTime, dayIndex, dayCount } = entry;
    if (
      typeof id !== "string" ||
      typeof slug !== "string" ||
      typeof title !== "string" ||
      typeof date !== "string"
    ) {
      return [];
    }
    return [
      {
        id,
        slug,
        title,
        orgName: typeof orgName === "string" ? orgName : null,
        date,
        startTime: typeof startTime === "string" ? startTime : "",
        endTime: typeof endTime === "string" ? endTime : "",
        dayIndex: typeof dayIndex === "number" ? dayIndex : 0,
        dayCount: typeof dayCount === "number" ? dayCount : 1,
      },
    ];
  });
};

const parseVenueCalendarEvents = (payload: unknown): VenueCalendarEvent[] => {
  if (!isRecord(payload) || !Array.isArray(payload.events)) {
    throw new Error("Invalid venue calendar response: events must be an array");
  }

  return payload.events.flatMap((event): VenueCalendarEvent[] => {
    if (
      !isRecord(event) ||
      typeof event.id !== "string" ||
      typeof event.slug !== "string" ||
      typeof event.title !== "string" ||
      typeof event.date !== "string"
    ) {
      return [];
    }

    return [
      {
        id: event.id,
        slug: event.slug,
        title: event.title,
        type: typeof event.type === "string" ? event.type : "",
        date: event.date,
        startTime: typeof event.startTime === "string" ? event.startTime : "",
        endTime: typeof event.endTime === "string" ? event.endTime : "",
        orgName: typeof event.orgName === "string" ? event.orgName : null,
      },
    ];
  });
};

export default function CohortCalendar() {
  const { data: authSession } = useSession();
  const currentUserId = (authSession?.user as any)?.id;
  const userRole = (authSession?.user as any)?.role || "STUDENT";
  // Reads session.user.roles, not the legacy `.role` scalar — a TEAM_MEMBER
  // whose role lives only in the roles[] array must still count as staff.
  const isVenueStaff = hasAnyRole(authSession?.user, [...VENUE_STAFF_ROLES]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [sessions, setSessions] = useState<OneOnOneSession[]>([]);
  const [groupSessions, setGroupSessions] = useState<GroupSession[]>([]);
  const [venueEvents, setVenueEvents] = useState<VenueCalendarEvent[]>([]);
  const [pendingHolds, setPendingHolds] = useState<PendingHold[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Modal state
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchData = async () => {
    try {
      // No caching, always fresh data
      const fetchOpts = { cache: 'no-store' as RequestCache, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' } };
      
      const [cohortsRes, sessionsRes, groupSessionsRes] = await Promise.all([
        fetch(`/api/me/cohorts?t=${Date.now()}`, fetchOpts),
        fetch(`/api/me/one-on-one-sessions?t=${Date.now()}`, fetchOpts),
        fetch(`/api/me/cohort-sessions?t=${Date.now()}`, fetchOpts),
      ]);

      if (!cohortsRes.ok) {
        const errorData = await cohortsRes.json();
        throw new Error(errorData.error || "Failed to fetch cohorts");
      }
      const cohortsData = await cohortsRes.json();
      setCohorts(cohortsData.cohorts || []);

      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        setSessions(sessionsData);
      }

      if (groupSessionsRes.ok) {
        const groupSessionsData: GroupSession[] = await groupSessionsRes.json();
        // Manual rows (NULL zoomOccurrenceId) can duplicate Zoom-synced rows for
        // the same slot — keep one chip per cohort + start time.
        const seen = new Set<string>();
        const deduped = groupSessionsData.filter(session => {
          const key = `${session.cohortId}|${new Date(session.startTime).toISOString()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setGroupSessions(deduped);
      }
    } catch (err) {
      console.error("[Calendar] Error fetching data:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleZoomSync = async () => {
    console.log("[Zoom Sync] Starting manual sync process...");
    setIsSyncing(true);
    try {
      const res = await fetch("/api/admin/zoom/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      console.log("[Zoom Sync] Sync successful, refreshing data...");
      await fetchData();
    } catch (error) {
      console.error("[Zoom Sync] Failed:", error);
      alert("Failed to sync Zoom sessions");
    } finally {
      setIsSyncing(false);
    }
  };

  const { year, month, monthStart, monthEnd, days } = getCalendarMonthGrid(currentDate);
  const displayedMonthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const displayedMonthKeyRef = useRef(displayedMonthKey);

  useEffect(() => {
    displayedMonthKeyRef.current = displayedMonthKey;
  }, [displayedMonthKey]);

  // Month bounds as YYYY-MM-DD keys, for comparing against cohorts' date-only
  // (UTC-anchored) start/end. Distinct from the grid's monthStart/monthEnd above,
  // which are local Dates used for laying out the calendar cells.
  const monthStartKey = calendarDateFromParts(year, month, 1);
  const monthEndKey = calendarDateFromParts(year, month, new Date(year, month + 1, 0).getDate());

  useEffect(() => {
    const fetchVenueEvents = async () => {
      const requestedMonthKey = displayedMonthKey;

      try {
        const fetchOpts = {
          cache: "no-store" as RequestCache,
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        };
        const res = await fetch(
          `/api/public/venue-calendar?month=${requestedMonthKey}&t=${Date.now()}`,
          fetchOpts
        );

        if (!res.ok) {
          throw new Error(`Failed to fetch venue events (${res.status})`);
        }

        const data: unknown = await res.json();
        const parsedEvents = parseVenueCalendarEvents(data);

        if (displayedMonthKeyRef.current !== requestedMonthKey) {
          return;
        }

        setVenueEvents(parsedEvents);
      } catch (err) {
        console.error("[Calendar] Error fetching venue events:", {
          month: requestedMonthKey,
          error: err,
        });

        if (displayedMonthKeyRef.current === requestedMonthKey) {
          setVenueEvents([]);
        }
      }
    };

    void fetchVenueEvents();
  }, [displayedMonthKey]);

  // Staff-only pending holds. Guarded on isVenueStaff so a student's browser
  // never even issues the request; the route enforces the same rule server-side.
  useEffect(() => {
    if (!isVenueStaff) {
      setPendingHolds([]);
      return;
    }

    const fetchPendingHolds = async () => {
      const requestedMonthKey = displayedMonthKey;

      try {
        const res = await fetch(
          `/api/venue-calendar/pending?month=${requestedMonthKey}&t=${Date.now()}`,
          {
            cache: "no-store" as RequestCache,
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              Pragma: "no-cache",
            },
          }
        );

        if (!res.ok) {
          throw new Error(`Failed to fetch pending holds (${res.status})`);
        }

        const parsed = parsePendingHolds(await res.json());

        // The month may have changed while this request was in flight.
        if (displayedMonthKeyRef.current !== requestedMonthKey) return;

        setPendingHolds(parsed);
      } catch (err) {
        console.error("[Calendar] Error fetching pending holds:", {
          month: requestedMonthKey,
          error: err,
        });

        // Degrade to the pre-existing calendar rather than breaking it.
        if (displayedMonthKeyRef.current === requestedMonthKey) {
          setPendingHolds([]);
        }
      }
    };

    void fetchPendingHolds();
  }, [displayedMonthKey, isVenueStaff]);

  const cohortsThisMonth = cohorts.filter(cohort => {
    const startDate = toCalendarDate(cohort.startDate);
    if (!startDate) return false;

    return startDate >= monthStartKey && startDate <= monthEndKey;
  });

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Cohorts appear only on their start date — day-to-day presence is carried by
  // the Zoom-synced session chips, which encode the real per-cohort weekday
  // schedule (a range-containment chip would also paint weekends).
  const getCohortsStartingOnDate = (day: number) => {
    if (day <= 0) return [];
    // Cohort start is a date-only value stored at UTC midnight. Compare as
    // YYYY-MM-DD strings so it doesn't shift a day for viewers west of UTC.
    const cell = calendarDateFromParts(year, month, day);

    return cohorts.filter(cohort => toCalendarDate(cohort.startDate) === cell);
  };

  const getCohortsWithoutDate = () => {
    return cohorts.filter(cohort => !cohort.startDate);
  };

  // NOTE: session.date is a real timestamp (a 6:00 PM PT session), not a date-only value.
  // Extracting the LOCAL calendar day here is correct — do not "fix" this to UTC like
  // the cohort ranges above; that would move sessions onto the wrong day.
  const getSessionsForDate = (day?: number | null) => {
    if (!day || day <= 0) return [];
    const date = new Date(year, month, day);

    return sessions
      .filter(session => {
        const sessionDate = new Date(session.date);
        return isSameLocalDate(sessionDate, date);
      })
      .sort(compareStartTimes);
  };

  // Same as getSessionsForDate: timestamped events, local day extraction is intentional.
  const getGroupSessionsForDate = (day?: number | null) => {
    if (!day || day <= 0) return [];
    const date = new Date(year, month, day);

    return groupSessions
      .filter(session => {
        const sessionDate = new Date(session.date);
        return isSameLocalDate(sessionDate, date);
      })
      .sort(compareStartTimes);
  };

  const getVenueEventsForDate = (day?: number | null) => {
    if (!day || day <= 0) return [];
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    return venueEvents
      .filter(event => buildDateKeyFromUtcIso(event.date) === dateKey)
      .sort(compareStartTimes);
  };

  const getPendingHoldsForDate = (day?: number | null) => {
    if (!day || day <= 0) return [];
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    return pendingHolds
      .filter(hold => buildDateKeyFromUtcIso(hold.date) === dateKey)
      .sort(compareStartTimes);
  };

  const openModal = (day: number | null) => {
    if (!day) return;
    if (
      getCohortsStartingOnDate(day).length > 0 ||
      getSessionsForDate(day).length > 0 || 
      getGroupSessionsForDate(day).length > 0 ||
      getVenueEventsForDate(day).length > 0 ||
      getPendingHoldsForDate(day).length > 0
    ) {
      setSelectedDate(day);
      setIsModalOpen(true);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            {MONTHS[month]} {year}
          </h2>
          <div className="flex gap-2">
            {userRole !== "STUDENT" && (
              <button
                onClick={handleZoomSync}
                disabled={isSyncing}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 mr-2"
                title="Sync Zoom Events"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync Zoom"}
              </button>
            )}
            <button
              onClick={goToPreviousMonth}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Previous month"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goToToday}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              Today
            </button>
            <button
              onClick={goToNextMonth}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Next month"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {cohortsThisMonth.length > 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {cohortsThisMonth.length} cohort{cohortsThisMonth.length !== 1 ? "s" : ""} starting this month
          </p>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-600 dark:text-slate-400">
          {(isVenueStaff ? [...LEGEND_ITEMS, PENDING_LEGEND_ITEM] : LEGEND_ITEMS).map(item => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="p-6">
        {/* Day names */}
        <div className="grid grid-cols-7 gap-px mb-4">
          {DAYS.map(day => (
            <div
              key={day}
              className="text-center text-sm font-semibold text-slate-600 dark:text-slate-400 py-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, index) => {
            const isCurrentMonth = day > 0;
            const dayNumber = isCurrentMonth ? day : null;
            const isToday =
              isCurrentMonth &&
              new Date(year, month, day).toDateString() === new Date().toDateString();

            const dayCohortsStarting = dayNumber ? getCohortsStartingOnDate(dayNumber) : [];
            const dayGroupSessions = dayNumber ? getGroupSessionsForDate(dayNumber) : [];
            const day1on1Sessions = dayNumber ? getSessionsForDate(dayNumber) : [];
            const dayVenueEvents = dayNumber ? getVenueEventsForDate(dayNumber) : [];
            const dayPendingHolds = dayNumber ? getPendingHoldsForDate(dayNumber) : [];

            const hasEvents =
              dayCohortsStarting.length > 0 ||
              dayGroupSessions.length > 0 ||
              day1on1Sessions.length > 0 ||
              dayVenueEvents.length > 0 ||
              dayPendingHolds.length > 0;

            return (
              <div
                key={index}
                onClick={() => openModal(dayNumber)}
                className={`min-h-24 p-2 rounded-lg border transition-colors ${hasEvents ? 'cursor-pointer' : ''} ${
                  isCurrentMonth
                    ? isToday
                      ? "border-primary bg-primary/5 dark:bg-primary/10 hover:border-primary/50"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-primary/50"
                    : "border-transparent bg-slate-50 dark:bg-slate-800/20"
                }`}
              >
                {dayNumber && (
                  <>
                    <div
                      className={`text-sm font-semibold mb-1 ${
                        isToday
                          ? "text-primary"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {dayNumber}
                    </div>
                    {dayCohortsStarting.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {dayCohortsStarting.map(cohort => (
                          <Link
                            key={cohort.id}
                            href={`/cohorts/${cohort.id}`}
                            className="block"
                          >
                            <div
                              className={`text-xs p-1.5 rounded cursor-pointer hover:opacity-80 transition-opacity ${
                                FORMAT_COLORS[classifyCohortFormat(cohort.title)]
                              }`}
                            >
                              <div className="font-semibold truncate">
                                {getRoleIcon(cohort.role)} Starts: {cohort.title}
                              </div>
                              {cohort.programs && cohort.programs.length > 0 && (
                                <div className="text-[10px] opacity-75 truncate" title={cohort.programs.map(p => p.name).join(', ')}>
                                  {cohort.programs.map(p => p.name).join(', ')}
                                </div>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                    {dayGroupSessions.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {dayGroupSessions.map(session => (
                          <div
                            key={session.id}
                            className={`text-xs p-1.5 rounded truncate ${
                              FORMAT_COLORS[classifyCohortFormat(session.cohort.title, session.startTime)]
                            }`}
                            title={session.title}
                          >
                            <span className="font-semibold">{formatLocalTime(session.startTime)}</span> 📹 {session.cohort.title}
                          </div>
                        ))}
                      </div>
                    )}
                    {day1on1Sessions.length > 0 && (
                      <div className="space-y-1">
                        {day1on1Sessions.map(session => {
                          const isInstructor = currentUserId === session.instructor.id;
                          const otherPerson = isInstructor ? session.student : session.instructor;
                          const otherName = otherPerson.name || otherPerson.email;

                          return session.meetingLink ? (
                            <a
                              key={session.id}
                              href={session.meetingLink?.startsWith("http") ? session.meetingLink : `https://${session.meetingLink}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs p-1.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors cursor-pointer"
                              title={`1:1 with ${otherName} at ${formatLocalTime(session.startTime)} — click to join`}
                            >
                              <div className="font-semibold truncate">
                                {formatLocalTime(session.startTime)}
                              </div>
                              <div className="text-[10px] opacity-75 truncate">
                                1:1 {otherName}
                              </div>
                            </a>
                          ) : (
                            <div
                              key={session.id}
                              className="text-xs p-1.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 cursor-default"
                              title={`1:1 with ${otherName} at ${formatLocalTime(session.startTime)}`}
                            >
                              <div className="font-semibold truncate">
                                {formatLocalTime(session.startTime)}
                              </div>
                              <div className="text-[10px] opacity-75 truncate">
                                1:1 {otherName}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {dayVenueEvents.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {dayVenueEvents.map(event => (
                          <Link
                            key={event.id}
                            href={`/events/${event.slug}`}
                            className="block"
                          >
                            <div
                              className={`text-xs p-1.5 rounded hover:opacity-80 transition-opacity ${VENUE_EVENT_COLOR}`}
                              title={event.orgName ? `${event.title} — ${event.orgName}` : event.title}
                            >
                              <div className="font-semibold truncate">{event.title}</div>
                              {event.orgName && (
                                <div className="text-[10px] opacity-75 truncate">{event.orgName}</div>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                    {dayPendingHolds.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {dayPendingHolds.map(hold => (
                          <Link
                            key={`${hold.id}-${hold.dayIndex}`}
                            href="/admin/venue-events"
                            className="block"
                          >
                            <div
                              className={`text-xs p-1.5 rounded border border-dashed border-slate-300 dark:border-slate-600 hover:opacity-80 transition-opacity ${PENDING_HOLD_COLOR}`}
                              title={`Pending hold — ${hold.title}${hold.orgName ? ` (${hold.orgName})` : ""}`}
                            >
                              <div className="font-semibold truncate">
                                {hold.title}
                                {hold.dayCount > 1
                                  ? ` (day ${hold.dayIndex + 1}/${hold.dayCount})`
                                  : ""}
                              </div>
                              <div className="text-[10px] opacity-75 truncate">
                                Pending{hold.orgName ? ` · ${hold.orgName}` : ""}
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cohorts without dates */}
      {getCohortsWithoutDate().length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">
            Cohorts without start date
          </h3>
          <div className="space-y-2">
            {getCohortsWithoutDate().map(cohort => (
              <Link
                key={cohort.id}
                href={`/cohorts/${cohort.id}`}
                className="block p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {getRoleIcon(cohort.role)} {cohort.title}
                    </div>
                    {cohort.programs && cohort.programs.length > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {cohort.programs.map(p => p.name).join(', ')}
                      </div>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${getStatusColor(cohort.status)}`}>
                    {cohort.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* No cohorts message */}
      {cohorts.length === 0 && (
        <div className="p-12 text-center">
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            You don't have any cohorts yet
          </p>
          <Link
            href="/cohorts"
            className="inline-block px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            Browse Cohorts
          </Link>
        </div>
      )}

      {/* Selected Date Modal Component */}
      <DayEventsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedDate={selectedDate || 0}
        monthName={MONTHS[month]}
        year={year}
        cohorts={selectedDate ? getCohortsStartingOnDate(selectedDate) : []}
        groupSessions={selectedDate ? getGroupSessionsForDate(selectedDate) : []}
        oneOnOneSessions={selectedDate ? getSessionsForDate(selectedDate) : []}
        venueEvents={selectedDate ? getVenueEventsForDate(selectedDate) : []}
        pendingHolds={selectedDate ? getPendingHoldsForDate(selectedDate) : []}
        currentUserId={currentUserId}
      />
    </div>
  );
}
