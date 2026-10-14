"use server";

import { revalidatePath } from "next/cache";

import { assertStaff, CRM_STAFF_ROLES, staffIdentity } from "@/lib/adminGuard";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole } from "@/lib/roles";
import { wallClockToUtc } from "@/lib/sessionInstant";
import { isValidIanaTimezone } from "@/lib/timezone";

const AVAILABILITY_PATH = "/admin/closers/availability";
const MAX_SERIES_WEEKS = 52;
const CONFIRMED = "CONFIRMED";

export type AvailabilityActionState = { error?: string; ok?: string };

type DateParts = {
  year: number;
  monthIndex: number;
  day: number;
};

type ProposedSlot = {
  startAt: Date;
  endAt: Date;
  timezone: string;
};

async function managedCloserId(requestedCloserId: string): Promise<string> {
  const actor = await staffIdentity();
  if (!actor.id) {
    throw new Error("Your staff session has no user id; sign out and sign in again");
  }

  const closerId = requestedCloserId.trim() || actor.id;
  if (closerId !== actor.id) {
    const session = await auth();
    if (!hasRole(session?.user, "ADMIN")) {
      throw new Error("Only admins can manage another closer's availability");
    }
  }

  const closer = await prisma.user.findUnique({
    where: { id: closerId },
    select: { id: true, role: true, roles: true },
  });
  if (!closer) {
    throw new Error(`Closer account ${closerId} was not found`);
  }
  if (!hasAnyRole(closer, CRM_STAFF_ROLES)) {
    throw new Error("Availability can only be managed for an ADMIN or TEAM_MEMBER account");
  }

  return closer.id;
}

function parseDate(raw: FormDataEntryValue | null): DateParts {
  const value = String(raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid date");

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Choose a real calendar date");
  }
  return { year, monthIndex, day };
}

function parseTime(raw: FormDataEntryValue | null, label: string): number {
  const value = String(raw ?? "").trim();
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} must be a valid time`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`${label} must be a valid time`);
  }
  return hours * 60 + minutes;
}

function localTimeMatches(
  instant: Date,
  date: DateParts,
  minutes: number,
  timezone: string,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "-1");

  return (
    numberPart("year") === date.year &&
    numberPart("month") === date.monthIndex + 1 &&
    numberPart("day") === date.day &&
    numberPart("hour") === Math.floor(minutes / 60) &&
    numberPart("minute") === minutes % 60
  );
}

function addWeeks(date: DateParts, weeks: number): DateParts {
  const shifted = new Date(Date.UTC(date.year, date.monthIndex, date.day + weeks * 7));
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function parseSeriesWeeks(formData: FormData): number {
  const repeatValue = formData.get("repeatWeekly");
  if (repeatValue === null) return 1;
  if (repeatValue !== "on") throw new Error("Repeat weekly has an invalid value");

  const rawWeeks = String(formData.get("weeks") ?? "").trim();
  const weeks = Number(rawWeeks);
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > MAX_SERIES_WEEKS) {
    throw new Error(`Series length must be a whole number from 2 to ${MAX_SERIES_WEEKS} weeks`);
  }
  return weeks;
}

function proposedSlots(formData: FormData): ProposedSlot[] {
  const firstDate = parseDate(formData.get("date"));
  const startMinutes = parseTime(formData.get("startTime"), "Start time");
  const endMinutes = parseTime(formData.get("endTime"), "End time");
  if (endMinutes <= startMinutes) {
    throw new Error("End time must be later than start time on the same day");
  }

  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!isValidIanaTimezone(timezone)) {
    throw new Error("Timezone must be a valid IANA name, such as America/Los_Angeles");
  }

  const weeks = parseSeriesWeeks(formData);
  const slots = Array.from({ length: weeks }, (_, index) => {
    const date = addWeeks(firstDate, index);
    const startAt = wallClockToUtc(
      date.year,
      date.monthIndex,
      date.day,
      startMinutes,
      timezone,
    );
    const endAt = wallClockToUtc(
      date.year,
      date.monthIndex,
      date.day,
      endMinutes,
      timezone,
    );
    if (
      !localTimeMatches(startAt, date, startMinutes, timezone) ||
      !localTimeMatches(endAt, date, endMinutes, timezone)
    ) {
      throw new Error(
        `The selected time does not exist in ${timezone} on one of the chosen dates because of a daylight-saving change`,
      );
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new Error("The selected timezone produces an invalid availability window");
    }
    return { startAt, endAt, timezone };
  });

  if (slots[0].startAt.getTime() <= Date.now()) {
    throw new Error("Availability must start in the future");
  }
  return slots;
}

function formatConflict(startAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startAt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createAvailabilityAction(
  _previous: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  await assertStaff();

  try {
    const closerId = await managedCloserId(String(formData.get("closerId") ?? ""));
    const slots = proposedSlots(formData);
    const earliestStart = slots[0].startAt;
    const latestEnd = slots[slots.length - 1].endAt;

    await prisma.$transaction(async (transaction) => {
      const existing = await transaction.closerSlot.findMany({
        where: {
          closerId,
          startAt: { lt: latestEnd },
          endAt: { gt: earliestStart },
        },
        select: { startAt: true, endAt: true },
      });
      const conflicting = slots.find((slot) =>
        existing.some(
          (current) =>
            slot.startAt.getTime() < current.endAt.getTime() &&
            current.startAt.getTime() < slot.endAt.getTime(),
        ),
      );
      if (conflicting) {
        throw new Error(
          `Availability overlaps an existing slot near ${formatConflict(conflicting.startAt, conflicting.timezone)}`,
        );
      }

      await transaction.closerSlot.createMany({
        data: slots.map((slot) => ({ closerId, ...slot })),
      });
    });

    revalidatePath(AVAILABILITY_PATH);
    return {
      ok: `Created ${slots.length} availability slot${slots.length === 1 ? "" : "s"}`,
    };
  } catch (error) {
    return { error: `Could not create availability: ${errorMessage(error)}` };
  }
}

export async function deleteAvailabilityAction(
  _previous: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  await assertStaff();

  try {
    const closerId = await managedCloserId(String(formData.get("closerId") ?? ""));
    const slotId = String(formData.get("slotId") ?? "").trim();
    if (!slotId) throw new Error("Slot id is required");

    await prisma.$transaction(async (transaction) => {
      const slot = await transaction.closerSlot.findFirst({
        where: { id: slotId, closerId },
        select: { booking: { select: { status: true } } },
      });
      if (!slot) throw new Error("That availability slot was not found for this closer");
      if (slot.booking?.status === CONFIRMED) {
        throw new Error("This slot has a confirmed booking and cannot be deleted");
      }

      await transaction.closerSlot.delete({ where: { id: slotId } });
    });

    revalidatePath(AVAILABILITY_PATH);
    return { ok: "Availability slot deleted" };
  } catch (error) {
    return { error: `Could not delete availability: ${errorMessage(error)}` };
  }
}
