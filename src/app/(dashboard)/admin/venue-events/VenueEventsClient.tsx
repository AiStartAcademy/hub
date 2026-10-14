"use client";

import type { AgreementVariableSpec } from "@/lib/agreementTemplates";
import type { ChangeEvent, JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatVenueEventTypeLabel } from "@/lib/venueEventTypeLabels";

import VenueEventDrawer from "./VenueEventDrawer";

export interface VenueEventAgreementSummary {
  id: string;
  status: string;
  templateKey: string;
  token: string;
  signedAt: string | null;
}

export interface VenueEventRow {
  id: string;
  title: string;
  slug: string;
  type: string;
  description: string | null;
  cover: string | null;
  subtitle: string | null;
  organizerName: string;
  orgName: string | null;
  contactEmail: string;
  contactPhone: string | null;
  date: string;
  endDate: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  expectedAttendees: number | null;
  capacity: number | null;
  status: string;
  dealType: string;
  dealNote: string | null;
  adminNote: string | null;
  quoteAmountCents: number | null;
  quoteNote: string | null;
  rentalFeeCents: number | null;
  rentalDepositCents: number | null;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
  ticketPriceCents: number | null;
  ticketPaymentLink: string | null;
  videoUrl: string | null;
  priceNote: string | null;
  gallery: string | null;
  agenda: string | null;
  hosts: string | null;
  pricingTiers: string | null;
  faq: string | null;
  externalRegistrationUrl: string | null;
  isOnline: boolean;
  source: string;
  gcalEventId: string | null;
  gcalSyncError: string | null;
  gcalSyncedAt: string | null;
  createdAt: string;
  registrationCount: number;
  latestAgreement: VenueEventAgreementSummary | null;
}

interface VenueEventsClientProps {
  variableSpecs: Record<
    "paid-rental" | "free-barter" | "revenue-share",
    readonly AgreementVariableSpec[]
  >;
}

type FilterKey = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "ALL";
type FetchState = "idle" | "loading" | "success" | "error";

const FILTERS: ReadonlyArray<FilterKey> = [
  "PENDING",
  "APPROVED",
  "DECLINED",
  "CANCELLED",
  "ALL",
];

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function formatTimeRange(
  startTime: string,
  endTime: string,
  timezone: string,
): string {
  return `${startTime} - ${endTime} ${timezone}`;
}

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case "APPROVED":
      return "bg-emerald-100 text-emerald-800";
    case "DECLINED":
      return "bg-rose-100 text-rose-800";
    case "CANCELLED":
      return "bg-slate-200 text-slate-800";
    case "PENDING":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function normalizeEvents(payload: unknown): VenueEventRow[] {
  if (Array.isArray(payload)) {
    return payload as VenueEventRow[];
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "events" in payload &&
    Array.isArray((payload as { events?: unknown }).events)
  ) {
    return (payload as { events: VenueEventRow[] }).events;
  }

  return [];
}

export default function VenueEventsClient({
  variableSpecs,
}: VenueEventsClientProps): JSX.Element {
  const [filter, setFilter] = useState<FilterKey>("PENDING");
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [events, setEvents] = useState<VenueEventRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const refresh = useCallback(() => {
    setRefreshToken((currentToken) => currentToken + 1);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadEvents(): Promise<void> {
      setFetchState("loading");
      setErrorMessage(null);

      try {
        const params = new URLSearchParams();
        params.set("status", filter);

        if (search.length > 0) {
          params.set("q", search);
        }

        const response = await fetch(
          `/api/admin/venue-events?${params.toString()}`,
          {
            method: "GET",
            signal: abortController.signal,
            headers: { Accept: "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload: unknown = await response.json();
        const nextEvents = normalizeEvents(payload);

        setEvents(nextEvents);
        setFetchState("success");
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Unable to load venue events.";

        setEvents([]);
        setFetchState("error");
        setErrorMessage(message);
      }
    }

    void loadEvents();

    return () => {
      abortController.abort();
    };
  }, [filter, refreshToken, search]);

  const selectedEvent = useMemo(() => {
    if (!selectedId) {
      return null;
    }

    return events.find((event) => event.id === selectedId) ?? null;
  }, [events, selectedId]);

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearchInput(event.target.value);
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filterOption) => {
            const isActive = filterOption === filter;

            return (
              <button
                key={filterOption}
                type="button"
                onClick={() => setFilter(filterOption)}
                className={[
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {filterOption}
              </button>
            );
          })}
        </div>

        <div className="w-full md:w-80">
          <label className="sr-only" htmlFor="venue-events-search">
            Search venue events
          </label>
          <input
            id="venue-events-search"
            type="search"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Search by title, organizer, or email"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      {fetchState === "loading" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading venue events…
        </div>
      ) : null}

      {fetchState === "error" ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          <p className="font-medium">Failed to load venue events.</p>
          <p className="mt-1">
            {errorMessage ?? "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 transition hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      ) : null}

      {fetchState === "success" && events.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No venue events match the current filter.
        </div>
      ) : null}

      {fetchState === "success" && events.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Org</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Registrations</th>
                  <th className="px-4 py-3">Agreement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((event) => {
                  const isSelected = selectedId === event.id;

                  return (
                    <tr
                      key={event.id}
                      onClick={() => setSelectedId(event.id)}
                      className={[
                        "cursor-pointer text-sm text-slate-700 transition hover:bg-slate-50",
                        isSelected ? "bg-slate-50" : "bg-white",
                      ].join(" ")}
                    >
                      <td className="px-4 py-3">{formatDate(event.date)}</td>
                      <td className="px-4 py-3">
                        {formatTimeRange(
                          event.startTime,
                          event.endTime,
                          event.timezone,
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {event.title}
                      </td>
                      <td className="px-4 py-3">{event.orgName ?? "—"}</td>
                      <td className="px-4 py-3">
                        {formatVenueEventTypeLabel(event.type)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                            getStatusBadgeClasses(event.status),
                          ].join(" ")}
                        >
                          {event.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{event.source}</td>
                      <td className="px-4 py-3">{event.registrationCount}</td>
                      <td className="px-4 py-3">
                        {event.latestAgreement?.status ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <VenueEventDrawer
        event={selectedEvent}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
        variableSpecs={variableSpecs}
      />
    </div>
  );
}
