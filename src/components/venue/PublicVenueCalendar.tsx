"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type JSX,
} from "react";

import { brand } from "@/config/brand";
import VenueRequestModal, {
  type VenueDayBlock,
} from "@/components/venue/VenueRequestModal";
import {
  DAYS,
  MONTHS,
  buildDateKeyFromUtcIso,
  formatLocalTime,
  getCalendarMonthGrid,
} from "@/lib/calendarUtils";

interface BusyCalendarItem {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  cohortTitle: string;
}

interface EventCalendarItem {
  id: string;
  slug: string;
  title: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  orgName: string | null;
  cover: string | null;
  /** 0-based position within a multi-day run; dayCount is 1 for single-day events. */
  dayIndex: number;
  dayCount: number;
}

interface TentativeCalendarItem {
  date: string;
  startTime: string;
  endTime: string;
  label: string;
}

interface CalendarResponse {
  busy: BusyCalendarItem[];
  events: EventCalendarItem[];
  tentative: TentativeCalendarItem[];
}

interface CalendarDayItem {
  kind: "busy" | "event" | "tentative";
  title: string;
  subtitle: string | null;
  startTime: string;
  endTime: string;
  href: string | null;
  modalLabel: string;
  cover?: string | null;
}

const EMPTY_RESPONSE: CalendarResponse = {
  busy: [],
  events: [],
  tentative: [],
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseInitialMonth(initialMonth: string): Date {
  const match: RegExpMatchArray | null = initialMonth.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    const now: Date = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const year: number = Number(match[1]);
  const monthIndex: number = Number(match[2]) - 1;

  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const now: Date = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return new Date(year, monthIndex, 1);
}

function formatMonthParam(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function buildDayString(year: number, zeroBasedMonth: number, day: number): string {
  return `${year}-${pad2(zeroBasedMonth + 1)}-${pad2(day)}`;
}

function shiftMonth(currentDate: Date, delta: number): Date {
  return new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1);
}

export default function PublicVenueCalendar({
  initialMonth,
}: {
  initialMonth: string;
}): JSX.Element {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => parseInitialMonth(initialMonth));
  const [calendarData, setCalendarData] = useState<CalendarResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [retryCount, setRetryCount] = useState<number>(0);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalBlocks, setModalBlocks] = useState<VenueDayBlock[]>([]);

  const monthKey: string = useMemo(() => formatMonthParam(currentMonth), [currentMonth]);
  const monthGrid = useMemo(() => getCalendarMonthGrid(currentMonth), [currentMonth]);

  useEffect(() => {
    const controller: AbortController = new AbortController();
    let active: boolean = true;

    async function loadCalendarMonth(): Promise<void> {
      setLoading(true);
      setError("");

      try {
        const response: Response = await fetch(
          `/api/public/venue-calendar?month=${encodeURIComponent(monthKey)}`,
          {
            method: "GET",
            signal: controller.signal,
            // The route serves CDN-cacheable headers for anonymous traffic; the
            // browser must still fetch fresh so a just-submitted hold shows up.
            cache: "no-store",
          },
        );

        const body: unknown = await response.json();

        if (!response.ok) {
          const message: string =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : "Unable to load the venue calendar.";
          throw new Error(message);
        }

        if (!active) {
          return;
        }

        const payload: CalendarResponse =
          typeof body === "object" && body !== null
            ? {
                busy: Array.isArray((body as CalendarResponse).busy)
                  ? (body as CalendarResponse).busy
                  : [],
                events: Array.isArray((body as CalendarResponse).events)
                  ? (body as CalendarResponse).events
                  : [],
                tentative: Array.isArray((body as CalendarResponse).tentative)
                  ? (body as CalendarResponse).tentative
                  : [],
              }
            : EMPTY_RESPONSE;

        setCalendarData(payload);
      } catch (caughtError: unknown) {
        if (!active) {
          return;
        }

        if (caughtError instanceof DOMException && caughtError.name === "AbortError") {
          return;
        }

        const message: string =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load the venue calendar.";
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadCalendarMonth();

    return () => {
      active = false;
      controller.abort();
    };
  }, [monthKey, retryCount]);

  const itemsByDay = useMemo((): Record<string, CalendarDayItem[]> => {
    const nextItemsByDay: Record<string, CalendarDayItem[]> = {};

    function addItem(key: string, item: CalendarDayItem): void {
      if (!nextItemsByDay[key]) {
        nextItemsByDay[key] = [];
      }

      nextItemsByDay[key].push(item);
    }

    for (const item of calendarData.busy) {
      addItem(buildDateKeyFromUtcIso(item.date), {
        kind: "busy",
        title: item.title,
        subtitle: item.cohortTitle,
        startTime: item.startTime,
        endTime: item.endTime,
        href: null,
        modalLabel: item.title,
      });
    }

    for (const item of calendarData.events) {
      // A multi-day event appears on each of its days; say which day it is so
      // the second day doesn't read as a duplicate booking.
      const dayLabel =
        item.dayCount > 1 ? ` (day ${item.dayIndex + 1} of ${item.dayCount})` : "";

      addItem(buildDateKeyFromUtcIso(item.date), {
        kind: "event",
        title: `${item.title}${dayLabel}`,
        subtitle: item.orgName,
        startTime: item.startTime,
        endTime: item.endTime,
        href: `/events/${item.slug}`,
        modalLabel: item.title,
        cover: item.cover,
      });
    }

    for (const item of calendarData.tentative) {
      addItem(buildDateKeyFromUtcIso(item.date), {
        kind: "tentative",
        title: item.label,
        subtitle: null,
        startTime: item.startTime,
        endTime: item.endTime,
        href: null,
        modalLabel: "Tentative hold",
      });
    }

    return nextItemsByDay;
  }, [calendarData]);

  function openRequestModal(date: string | null, dayItems: CalendarDayItem[]): void {
    setModalDate(date);
    setModalBlocks(
      dayItems.map(
        (item): VenueDayBlock => ({
          label: item.modalLabel,
          startTime: item.startTime,
          endTime: item.endTime,
        }),
      ),
    );
    setModalOpen(true);
  }

  function handleDayKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
    date: string | null,
    dayItems: CalendarDayItem[],
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRequestModal(date, dayItems);
    }
  }

  return (
    <>
      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentMonth((previous) => shiftMonth(previous, -1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Previous month"
            >
              <span aria-hidden="true">←</span>
            </button>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                {MONTHS[monthGrid.month]} {monthGrid.year}
              </h2>
              <p className="text-sm text-slate-500">Browse availability and partner events.</p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentMonth((previous) => shiftMonth(previous, 1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              aria-label="Next month"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => openRequestModal(null, [])}
            className="inline-flex items-center justify-center rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
          >
            Request an event
          </button>
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-slate-600">
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-teal-500" aria-hidden="true" />
            <span>{brand.shortName} session</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-sky-500" aria-hidden="true" />
            <span>Approved partner event</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-slate-400" aria-hidden="true" />
            <span>Tentative hold</span>
          </div>
        </div>

        {error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setRetryCount((value) => value + 1)}
              className="inline-flex items-center justify-center rounded-full border border-rose-300 px-4 py-2 font-medium text-rose-700 transition hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="min-w-[42rem]">
            <div className="grid grid-cols-7 gap-px rounded-2xl bg-slate-200">
              {DAYS.map((day) => (
                <div
                  key={day}
                  className="bg-slate-100 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 sm:text-sm"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="relative mt-px" aria-busy={loading}>
              <div className="grid grid-cols-7 gap-px rounded-2xl bg-slate-200">
                {monthGrid.days.map((dayValue, index) => {
                  const isCurrentMonthDay: boolean = dayValue > 0;
                  // Fillers encode prev-month days as -n and next-month days as
                  // -(n + 100) — strip the offset before display.
                  const absValue: number = Math.abs(dayValue);
                  const dayNumber: number = absValue > 100 ? absValue - 100 : absValue;
                  const dateKey: string | null = isCurrentMonthDay
                    ? buildDayString(monthGrid.year, monthGrid.month, dayNumber)
                    : null;
                  const dayItems: CalendarDayItem[] = dateKey ? itemsByDay[dateKey] ?? [] : [];
                  const visibleItems: CalendarDayItem[] = dayItems.slice(0, 3);
                  const hiddenCount: number = Math.max(dayItems.length - visibleItems.length, 0);

                  if (!isCurrentMonthDay) {
                    return (
                      <div
                        key={`filler-${index}-${dayValue}`}
                        className="min-h-[8.5rem] bg-slate-50 p-3 text-sm text-slate-300"
                      >
                        <span>{dayNumber}</span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={dateKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRequestModal(dateKey, dayItems)}
                      onKeyDown={(event) => handleDayKeyDown(event, dateKey, dayItems)}
                      className="min-h-[8.5rem] cursor-pointer bg-white p-3 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-900">{dayNumber}</span>
                        {dayItems.length > 0 ? (
                          <span className="text-[11px] font-medium text-slate-400">
                            {dayItems.length} block{dayItems.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        {visibleItems.map((item, itemIndex) => {
                          const timeLabel: string = `${formatLocalTime(item.startTime)} - ${formatLocalTime(item.endTime)}`;
                          const blockClasses: string =
                            item.kind === "busy"
                              ? "border-teal-200 bg-teal-50 text-teal-900"
                              : item.kind === "event"
                                ? "border-sky-200 bg-sky-50 text-sky-900"
                                : "border-slate-200 bg-slate-100 text-slate-700";

                          const content = (
                            <div className="flex items-start gap-2">
                              {item.cover ? (
                                // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN hosts
                                <img
                                  alt=""
                                  className="h-9 w-9 shrink-0 rounded-lg object-cover"
                                  loading="lazy"
                                  src={item.cover}
                                />
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold">{item.title}</p>
                                {item.subtitle ? (
                                  <p className="truncate text-[11px] opacity-80">{item.subtitle}</p>
                                ) : null}
                                <p className="truncate text-[11px] opacity-80">{timeLabel}</p>
                              </div>
                            </div>
                          );

                          if (item.href) {
                            return (
                              <Link
                                key={`${dateKey}-${item.kind}-${itemIndex}`}
                                href={item.href}
                                onClick={(event) => event.stopPropagation()}
                                className={`block rounded-xl border px-2.5 py-2 transition hover:brightness-95 ${blockClasses}`}
                              >
                                {content}
                              </Link>
                            );
                          }

                          return (
                            <div
                              key={`${dateKey}-${item.kind}-${itemIndex}`}
                              className={`rounded-xl border px-2.5 py-2 ${blockClasses}`}
                            >
                              {content}
                            </div>
                          );
                        })}

                        {hiddenCount > 0 ? (
                          <p className="text-xs font-medium text-slate-500">+{hiddenCount} more</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/75 backdrop-blur-[1px]">
                  <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
                    <span>Loading calendar…</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <VenueRequestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialDate={modalDate}
        dayBlocks={modalBlocks}
      />
    </>
  );
}
