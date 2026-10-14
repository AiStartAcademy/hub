"use client";

import { X, PlayCircle } from "lucide-react";
import Link from "next/link";
import { formatLocalTime } from "@/lib/calendarUtils";

// Local copies of the interface fields used by the props
interface ModalCohort {
  id: string;
  title: string;
  role: "student" | "instructor" | "both";
}

interface ModalGroupSession {
  id: string;
  title: string;
  description?: string | null;
  timezone: string;
  startTime: string;
  endTime: string;
  meetingLink: string | null;
  recordingLink?: string | null; // Recording URL
  cohortId: string;
  cohort: { title: string };
}

interface ModalOneOnOneSession {
  id: string;
  startTime: string;
  meetingLink?: string | null;
  instructor: { id: string; name: string | null; email: string };
  student: { id: string; name: string | null; email: string };
}

interface ModalVenueEvent {
  id: string;
  slug: string;
  title: string;
  startTime: string;
  endTime: string;
  orgName: string | null;
}

/**
 * A PENDING venue booking. Only ever passed in for ADMIN/TEAM_MEMBER — the
 * calendar leaves this empty for everyone else.
 */
interface ModalPendingHold {
  id: string;
  slug: string;
  title: string;
  startTime: string;
  endTime: string;
  orgName: string | null;
  dayIndex: number;
  dayCount: number;
}

interface DayEventsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: number;
  monthName: string;
  year: number;
  cohorts: ModalCohort[];
  groupSessions: ModalGroupSession[];
  oneOnOneSessions: ModalOneOnOneSession[];
  venueEvents: ModalVenueEvent[];
  pendingHolds?: ModalPendingHold[];
  currentUserId?: string;
}

const getRoleIcon = (role: string) => {
  if (role === "both") return "👨‍🏫📚";
  if (role === "instructor") return "👨‍🏫";
  return "📚";
};

// The browser's time zone
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function DayEventsModal({
  isOpen,
  onClose,
  selectedDate,
  monthName,
  year,
  cohorts,
  groupSessions,
  oneOnOneSessions,
  venueEvents,
  pendingHolds = [],
  currentUserId,
}: DayEventsModalProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-lg overflow-hidden relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Events for {monthName} {selectedDate}, {year}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Cohorts (start of classes) */}
          {cohorts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Cohort Starts</h4>
              <div className="space-y-2">
                {cohorts.map(cohort => (
                  <div key={cohort.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <div className="font-semibold text-slate-900 dark:text-white">{getRoleIcon(cohort.role)} {cohort.title}</div>
                    <Link href={`/cohorts/${cohort.id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
                      View details →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group Zoom calls */}
          {groupSessions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Live Classes (Zoom)</h4>
              <div className="space-y-2">
                {groupSessions.map(session => (
                  <div key={session.id} className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/10">
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-semibold text-blue-900 dark:text-blue-100">{session.title}</div>
                      <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded font-medium text-center whitespace-nowrap">
                        {formatLocalTime(session.startTime)} - {formatLocalTime(session.endTime)} <br/>
                        <span className="opacity-75 font-normal">({userTimezone})</span>
                      </span>
                    </div>
                    <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-3">
                      {session.cohort.title}
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mb-3">
                      {session.meetingLink && (
                        <a
                          href={session.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                          Join Zoom
                        </a>
                      )}
                      
                      {/* Watch Recording button */}
                      {session.recordingLink && (
                        <Link
                          href={session.recordingLink}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-blue-400/50 bg-blue-100 dark:bg-blue-800/40 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800/80 transition-colors"
                        >
                          <PlayCircle className="w-3.5 h-3.5" />
                          Watch Recording
                        </Link>
                      )}

                      <Link
                        href={`/cohorts/${session.cohortId}`}
                        className="px-3 py-1.5 text-xs font-medium rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        Go to Board
                      </Link>
                    </div>

                    {session.description && (
                      <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/60 mt-1">
                        <span className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1 block">
                          Description:
                        </span>
                        <div className="text-xs text-blue-800/80 dark:text-blue-200/80 whitespace-pre-wrap">
                          {session.description}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 1:1 calls */}
          {oneOnOneSessions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">1-on-1 Sessions</h4>
              <div className="space-y-2">
                {oneOnOneSessions.map(session => {
                  const isInstructor = currentUserId === session.instructor.id;
                  const otherPerson = isInstructor ? session.student : session.instructor;
                  
                  return (
                    <div key={session.id} className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/10">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-semibold text-emerald-900 dark:text-emerald-100">
                          Call with {otherPerson.name || otherPerson.email}
                        </div>
                        <span className="text-xs bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded font-medium whitespace-nowrap">
                          {formatLocalTime(session.startTime)}
                        </span>
                      </div>
                      {session.meetingLink && (
                        <a
                          href={session.meetingLink.startsWith("http") ? session.meetingLink : `https://${session.meetingLink}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block px-3 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                        >
                          Join Meeting
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {venueEvents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Community Events</h4>
              <div className="space-y-2">
                {venueEvents.map(event => (
                  <div key={event.id} className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-900/10">
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-semibold text-rose-900 dark:text-rose-100">{event.title}</div>
                      {(event.startTime || event.endTime) && (
                        <span className="text-xs bg-rose-200 dark:bg-rose-800 text-rose-800 dark:text-rose-200 px-2 py-0.5 rounded font-medium text-center whitespace-nowrap">
                          {event.startTime ? formatLocalTime(event.startTime) : ""}
                          {event.startTime && event.endTime ? " - " : ""}
                          {event.endTime ? formatLocalTime(event.endTime) : ""} <br />
                          <span className="opacity-75 font-normal">({userTimezone})</span>
                        </span>
                      )}
                    </div>
                    {event.orgName && (
                      <div className="text-sm font-medium text-rose-700 dark:text-rose-300 mb-3">
                        {event.orgName}
                      </div>
                    )}
                    <Link
                      href={`/events/${event.slug}`}
                      className="inline-block px-3 py-1.5 text-xs font-medium rounded border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
                    >
                      View event
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingHolds.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                Pending holds
              </h4>
              <div className="space-y-2">
                {pendingHolds.map(hold => (
                  <div
                    key={`${hold.id}-${hold.dayIndex}`}
                    className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {hold.title}
                        {hold.dayCount > 1 ? ` (day ${hold.dayIndex + 1}/${hold.dayCount})` : ""}
                      </div>
                      {(hold.startTime || hold.endTime) && (
                        <span className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded font-medium text-center whitespace-nowrap">
                          {hold.startTime ? formatLocalTime(hold.startTime) : ""}
                          {hold.startTime && hold.endTime ? " - " : ""}
                          {hold.endTime ? formatLocalTime(hold.endTime) : ""} <br />
                          <span className="opacity-75 font-normal">({userTimezone})</span>
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                      Not yet approved{hold.orgName ? ` · ${hold.orgName}` : ""}
                    </div>
                    <Link
                      href="/admin/venue-events"
                      className="inline-block px-3 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      Review booking
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
