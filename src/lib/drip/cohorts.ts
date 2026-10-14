// src/lib/drip/cohorts.ts
// Upcoming cohort merge data for drip templates.
//
// Two rules matter here:
//  1. Dates and prices in campaign copy may drift; the sanctioned exception is
//     these helpers, which derive both from live Cohort + Group rows at send
//     time instead of freezing a number into authored copy.
//  2. A missing cohort never leaves a hole. The fallback still points at the
//     cohorts page, because a blank block or raw `{{token}}` is worse
//     than a generic "check the calendar" line in a customer email.

import { escapeHtml } from "@/lib/mail";
import prisma from "@/lib/prisma";
import { appendUtmParams, deriveLinkContent } from "./link-utm";

export type UpcomingCohort = {
  title: string;
  /** Deep link to this specific cohort's page — /cohorts/<slug-or-id>, not the bare list. */
  url: string;
  dateLabel: string;
  timeLabel: string | null;
  priceLabel: string | null;
};

type CohortRow = {
  id: string;
  slug: string | null;
  title: string;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  groups: Array<{
    id: string;
    name: string;
    inPerson: boolean;
    price: number;
    seats: number;
  }>;
};


function utcDateParts(date: Date): { month: string; day: string; year: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);
  const get = (type: "month" | "day" | "year") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { month: get("month"), day: get("day"), year: get("year") };
}

function formatDateLabel(startDate: Date, endDate: Date | null): string {
  if (!endDate) {
    const start = utcDateParts(startDate);
    return `${start.month} ${start.day}, ${start.year}`;
  }

  const start = utcDateParts(startDate);
  const end = utcDateParts(endDate);

  if (start.year === end.year) {
    return `${start.month} ${start.day} – ${end.month} ${end.day}, ${end.year}`;
  }
  return `${start.month} ${start.day}, ${start.year} – ${end.month} ${end.day}, ${end.year}`;
}

function formatTimeLabel(
  startTime: string | null,
  endTime: string | null,
  timezone: string | null
): string | null {
  if (!startTime || !endTime) return null;
  return `${startTime}–${endTime}${timezone ? ` ${timezone}` : ""}`;
}

function formatUsd(amount: number): string {
  const integral = Number.isInteger(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: integral ? 0 : 2,
    maximumFractionDigits: integral ? 0 : 2,
  }).format(amount);
}

function groupLabel(group: { name: string; inPerson: boolean }): string {
  const name = group.name.trim();
  if (name) return name;
  return group.inPerson ? "In person" : "Zoom";
}

function formatPriceLabel(groups: CohortRow["groups"]): string | null {
  const priced = groups.filter((group) => group.price > 0);
  if (priced.length === 0) return null;
  if (priced.length === 1) return formatUsd(priced[0].price);

  const online = priced.find((group) => !group.inPerson) ?? null;
  const inPerson = priced.find((group) => group.inPerson) ?? null;

  if (online && inPerson) {
    return [
      `${groupLabel(online)} ${formatUsd(online.price)}`,
      `${groupLabel(inPerson)} ${formatUsd(inPerson.price)}`,
    ].join(" · ");
  }

  return priced
    .map((group) => `${groupLabel(group)} ${formatUsd(group.price)}`)
    .join(" · ");
}

export { formatPriceLabel as priceLabel };

function detailsLine(cohort: UpcomingCohort): string {
  return [cohort.dateLabel, cohort.timeLabel, cohort.priceLabel].filter(Boolean).join(" · ");
}

export async function getUpcomingCohorts(
  appUrl: string,
  limit = 3
): Promise<UpcomingCohort[]> {
  if (limit < 1) return [];

  // Same app-local Prisma read as the rest of the dashboard/request path; we do
  // not wrap repo-internal DB calls in a second timeout layer here.
  const rows = (await prisma.cohort.findMany({
    where: {
      status: "ENROLLMENT",
      leadMagnet: false,
      startDate: { gte: new Date() },
    },
    orderBy: { startDate: "asc" },
    take: limit,
    select: {
      id: true,
      slug: true,
      title: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      timezone: true,
      groups: {
        select: {
          id: true,
          name: true,
          price: true,
          inPerson: true,
          seats: true,
        },
      },
    },
  })) as CohortRow[];

  return rows
    .map((row) => {
      if (!row.startDate) return null; // Defensive: the schema allows null, the query does not.
      return {
        title: row.title,
        // Deep link to this cohort's own page, not the bare list — a reader
        // scanning three dates in an email should land on the one they
        // clicked, not have to re-find it. `slug` is nullable (older rows
        // predate it), so fall back to `id`; the [id]/page.tsx route accepts
        // either.
        url: `${appUrl}/cohorts/${row.slug ?? row.id}`,
        dateLabel: formatDateLabel(row.startDate, row.endDate),
        timeLabel: formatTimeLabel(row.startTime, row.endTime, row.timezone),
        priceLabel: formatPriceLabel(row.groups),
      };
    })
    .filter((row): row is UpcomingCohort => row !== null);
}

export type CohortLinkUtm = { campaign: string; stepOrder: number };

function taggedCohortUrl(url: string, utm: CohortLinkUtm | undefined): string {
  if (!utm) return url;
  return appendUtmParams(url, {
    campaign: utm.campaign,
    content: `step${utm.stepOrder}-${deriveLinkContent(url)}`,
  });
}

/**
 * `utm` is optional so callers that don't yet have a campaign/step in scope
 * (there are none left in this codebase, but a bare call should still render
 * something correct rather than throw) still get plain, working links.
 */
export function renderUpcomingCohortsHtml(
  cohorts: UpcomingCohort[],
  appUrl: string,
  utm?: CohortLinkUtm
): string {
  if (cohorts.length === 0) {
    const fallbackUrl = taggedCohortUrl(`${appUrl}/cohorts`, utm);
    return `<p style="margin:0 0 16px;color:#475569">Current cohort dates and pricing are always on <a href="${fallbackUrl}" style="color:#7209B7;text-decoration:underline">our cohorts page</a>.</p>`;
  }

  const rows = cohorts
    .map(
      (cohort, index) => `
        <div style="margin:${index === cohorts.length - 1 ? "0" : "0 0 14px"}">
          <div style="margin:0 0 4px;font-weight:700;color:#1B1F3B">
            <a href="${taggedCohortUrl(cohort.url, utm)}" style="color:#1B1F3B;text-decoration:none">${escapeHtml(cohort.title)}</a>
          </div>
          <div style="margin:0;color:#64748b;font-size:14px;line-height:1.5">${escapeHtml(detailsLine(cohort))}</div>
        </div>`
    )
    .join("");

  return `<div style="margin:24px 0;padding:18px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
    <div style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1B1F3B">Upcoming cohorts</div>
    ${rows}
  </div>`;
}

export function renderNextCohortLine(cohorts: UpcomingCohort[]): string {
  const cohort = cohorts[0];
  if (!cohort) {
    return "Next cohort dates and current pricing are always on our cohorts page.";
  }

  return `Next cohort: <strong>${escapeHtml(cohort.title)}</strong>, ${escapeHtml(detailsLine(cohort))}`;
}
