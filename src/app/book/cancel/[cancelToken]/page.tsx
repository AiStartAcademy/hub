import { redirect } from "next/navigation";

import { brand } from "@/config/brand";
import { cancelLeadBooking } from "@/lib/booking/leadBooking";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `Cancel your ${brand.shortName} 1:1 | ${brand.name}`,
  robots: { index: false, follow: false },
};

function formatBookingTime(startAt: Date, endAt: Date, timezone: string): string {
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
  return `${date}, ${time.format(startAt)}–${time.format(endAt)}`;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
          {brand.wordmark}
        </p>
        {children}
      </div>
    </main>
  );
}

export default async function CancelLeadBookingPage({
  params,
}: {
  params: Promise<{ cancelToken: string }>;
}) {
  const { cancelToken } = await params;
  const booking = await prisma.leadBooking.findUnique({
    where: { cancelToken },
    select: {
      status: true,
      slot: {
        select: {
          startAt: true,
          endAt: true,
          timezone: true,
          closer: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!booking) {
    return (
      <PageShell>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Booking not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This cancellation link is invalid or no longer available. If you need help, email{" "}
          <a className="underline" href={`mailto:${brand.email.contact}`}>{brand.email.contact}</a>.
        </p>
      </PageShell>
    );
  }

  if (booking.status === "CANCELLED") {
    return (
      <PageShell>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">This booking is cancelled</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          You&apos;re all set—there&apos;s nothing else you need to do.
        </p>
      </PageShell>
    );
  }

  if (booking.status !== "CONFIRMED") {
    return (
      <PageShell>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Booking unavailable</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This booking cannot be changed from this link. Email{" "}
          <a className="underline" href={`mailto:${brand.email.contact}`}>{brand.email.contact}</a> for help.
        </p>
      </PageShell>
    );
  }

  async function cancelBookingAction(): Promise<never> {
    "use server";

    const result = await cancelLeadBooking(cancelToken);
    if (!result.ok) {
      redirect(`/book/cancel/${encodeURIComponent(cancelToken)}?state=not-found`);
    }
    redirect(`/book/cancel/${encodeURIComponent(cancelToken)}`);
  }

  const closerName = booking.slot.closer.name?.trim() || booking.slot.closer.email;
  const when = formatBookingTime(
    booking.slot.startAt,
    booking.slot.endAt,
    booking.slot.timezone,
  );

  return (
    <PageShell>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Cancel your {brand.shortName} 1:1?</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Your meeting with {closerName} is scheduled for <strong>{when}</strong>.
      </p>
      <form action={cancelBookingAction} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white hover:bg-rose-700"
        >
          Yes, cancel my booking
        </button>
      </form>
      <p className="mt-3 text-center text-xs text-slate-400">You can close this page to keep the meeting.</p>
    </PageShell>
  );
}
