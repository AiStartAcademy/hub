import { notFound } from "next/navigation";

import { brand } from "@/config/brand";
import { listBookableSlots } from "@/lib/booking/leadBooking";
import prisma from "@/lib/prisma";

import BookingClient from "./BookingClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `Book an ${brand.shortName} 1:1 | ${brand.name}`,
  robots: { index: false, follow: false },
};

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const closer = await prisma.user.findUnique({
    where: { bookingToken: token },
    select: { id: true, name: true, email: true },
  });
  if (!closer) notFound();

  const contactToken = typeof query.c === "string" ? query.c : null;
  const [slots, contact] = await Promise.all([
    listBookableSlots(closer.id),
    contactToken
      ? prisma.contact.findUnique({
          where: { publicToken: contactToken },
          select: { name: true, email: true },
        })
      : Promise.resolve(null),
  ]);
  const closerName = closer.name?.trim() || closer.email;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
          {brand.wordmark}
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">Book a 1:1 with {closerName}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Pick a time that works for you. We&apos;ll email your Zoom link and calendar invitation after you confirm.
        </p>

        <BookingClient
          token={token}
          slots={slots.map((slot) => ({
            id: slot.id,
            startAt: slot.startAt.toISOString(),
            endAt: slot.endAt.toISOString(),
            timezone: slot.timezone,
          }))}
          prefill={{ name: contact?.name ?? "", email: contact?.email ?? "" }}
        />
      </div>
    </main>
  );
}
