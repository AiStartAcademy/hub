"use client";

import { FormEvent, useMemo, useState } from "react";

import { brand } from "@/config/brand";

export type PublicBookingSlot = {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
};

type BookingPrefill = {
  name: string;
  email: string;
};

type BookingSuccess = {
  ok: true;
  joinUrl?: string;
};

type SlotGroup = {
  key: string;
  label: string;
  timezone: string;
  slots: PublicBookingSlot[];
};

function dateParts(iso: string, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function groupSlots(slots: PublicBookingSlot[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>();
  for (const slot of slots) {
    const parts = dateParts(slot.startAt, slot.timezone);
    const key = `${slot.timezone}:${parts.year}-${parts.month}-${parts.day}`;
    const existing = groups.get(key);
    if (existing) {
      existing.slots.push(slot);
      continue;
    }

    groups.set(key, {
      key,
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: slot.timezone,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date(slot.startAt)),
      timezone: slot.timezone,
      slots: [slot],
    });
  }
  return [...groups.values()];
}

function formatSlotTime(slot: PublicBookingSlot): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: slot.timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(slot.startAt))}–${formatter.format(new Date(slot.endAt))}`;
}

function parseBookingResponse(value: unknown): BookingSuccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true) return null;
  if (record.joinUrl !== undefined && typeof record.joinUrl !== "string") return null;
  return { ok: true, ...(record.joinUrl ? { joinUrl: record.joinUrl } : {}) };
}

function responseError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : null;
}

export default function BookingClient({
  token,
  slots,
  prefill,
}: {
  token: string;
  slots: PublicBookingSlot[];
  prefill: BookingPrefill;
}) {
  const groups = useMemo(() => groupSlots(slots), [slots]);
  const [slotId, setSlotId] = useState(slots[0]?.id ?? "");
  const [name, setName] = useState(prefill.name);
  const [email, setEmail] = useState(prefill.email);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<BookingSuccess | null>(null);

  async function submitBooking(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!slotId) {
      setError("Choose an available time first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/booking/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, name, email, phone, note }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`Booking service returned an invalid response (${response.status}).`);
      }

      if (!response.ok) {
        throw new Error(responseError(payload) ?? `Booking failed (${response.status}).`);
      }
      const parsed = parseBookingResponse(payload);
      if (!parsed) throw new Error("Booking service returned an invalid confirmation.");
      setSuccess(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Booking failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-xl font-bold text-emerald-950">You&apos;re booked</h2>
        <p className="mt-2 text-sm leading-relaxed text-emerald-900">
          We sent the calendar invitation and cancellation link to {email}.
        </p>
        {success.joinUrl && (
          <a
            href={success.joinUrl}
            className="mt-4 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800"
          >
            Open Zoom link
          </a>
        )}
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">No times are open right now</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Please check back soon or email {brand.email.contact} for help finding a time.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submitBooking} className="mt-8 space-y-8">
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Choose a time</h2>
        <div className="mt-3 space-y-5">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold text-slate-900">{group.label}</h3>
                <span className="text-xs font-semibold text-slate-500">{group.timezone}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.slots.map((slot) => (
                  <label
                    key={slot.id}
                    className={`cursor-pointer rounded-xl border px-3 py-3 text-center text-sm font-semibold transition ${
                      slotId === slot.id
                        ? "border-violet-600 bg-violet-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-violet-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="slotId"
                      value={slot.id}
                      checked={slotId === slot.id}
                      onChange={() => setSlotId(slot.id)}
                      className="sr-only"
                    />
                    {formatSlotTime(slot)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Your details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Name
            <input
              required
              maxLength={200}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
            Phone <span className="font-normal text-slate-400">(optional, include country code)</span>
            <input
              type="tel"
              maxLength={32}
              autoComplete="tel"
              placeholder="+1 415 555 2671"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
            Anything you&apos;d like us to know? <span className="font-normal text-slate-400">(optional)</span>
            <textarea
              maxLength={500}
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
            <span className="mt-1 block text-right text-xs font-normal text-slate-400">{note.length}/500</span>
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Booking…" : "Confirm my 1:1"}
        </button>
      </section>
    </form>
  );
}
