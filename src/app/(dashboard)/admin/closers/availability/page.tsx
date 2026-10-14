import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { MobileMenuButton } from "@/components/MobileMenuButton";
import { CRM_STAFF_ROLES } from "@/lib/adminGuard";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole } from "@/lib/roles";
import { CreateAvailabilityForm, DeleteAvailabilityForm } from "./AvailabilityForms";

export const metadata = { title: "Closer Availability | Admin" };
export const dynamic = "force-dynamic";

type AvailabilityPageProps = {
  searchParams: Promise<{ userId?: string }>;
};

function formatSlotWindow(startAt: Date, endAt: Date, timezone: string) {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(startAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return { date, time: `${time.format(startAt)}–${time.format(endAt)}` };
}

export default async function CloserAvailabilityPage({ searchParams }: AvailabilityPageProps) {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, CRM_STAFF_ROLES)) redirect("/dashboard");

  const { userId } = await searchParams;
  const requestedUserId = userId?.trim();
  const isAdmin = hasRole(session.user, "ADMIN");
  if (requestedUserId && requestedUserId !== session.user.id && !isAdmin) {
    redirect("/admin/closers/availability");
  }
  const closerId = requestedUserId || session.user.id;

  const closer = await prisma.user.findUnique({
    where: { id: closerId },
    select: { id: true, name: true, email: true, role: true, roles: true },
  });
  if (!closer || !hasAnyRole(closer, CRM_STAFF_ROLES)) notFound();

  const slots = await prisma.closerSlot.findMany({
    where: { closerId: closer.id, startAt: { gt: new Date() } },
    orderBy: { startAt: "asc" },
    include: {
      booking: {
        select: {
          status: true,
          contact: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  const managingAnotherCloser = closer.id !== session.user.id;
  const closerLabel = closer.name?.trim() || closer.email;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <CalendarClock className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <div>
          <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
            Closer availability
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
            Managing {closerLabel}
          </p>
        </div>
        {managingAnotherCloser ? (
          <Link
            href="/admin/closers/availability"
            className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Back to my slots
          </Link>
        ) : (
          <span className="ml-auto text-xs font-medium text-slate-500 dark:text-slate-400">
            {slots.length} upcoming
          </span>
        )}
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 text-sm font-bold text-slate-900 dark:text-white">
              Add availability
            </h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Times are saved as absolute instants and displayed in the timezone entered here.
            </p>
            <CreateAvailabilityForm closerId={closer.id} />
          </section>

          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Window</th>
                  <th className="px-4 py-3 font-semibold">Timezone</th>
                  <th className="px-4 py-3 font-semibold">Booking</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {slots.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      No upcoming availability slots.
                    </td>
                  </tr>
                ) : (
                  slots.map((slot) => {
                    const window = formatSlotWindow(slot.startAt, slot.endAt, slot.timezone);
                    const confirmedBooking =
                      slot.booking?.status === "CONFIRMED" ? slot.booking : null;
                    return (
                      <tr key={slot.id}>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {window.date}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                          {window.time}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {slot.timezone}
                        </td>
                        <td className="px-4 py-3">
                          {confirmedBooking ? (
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                Booked
                              </span>
                              <Link
                                href={`/admin/contacts/${confirmedBooking.contact.id}`}
                                className="font-medium text-slate-700 hover:text-primary hover:underline dark:text-slate-200"
                              >
                                {confirmedBooking.contact.name.trim() ||
                                  confirmedBooking.contact.email}
                              </Link>
                            </div>
                          ) : (
                            <span className="text-slate-400">Open</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {confirmedBooking ? (
                            <span className="text-xs text-slate-400">Cannot delete</span>
                          ) : (
                            <DeleteAvailabilityForm closerId={closer.id} slotId={slot.id} />
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </div>
  );
}
