"use client";

import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { buildGmailComposeUrl, buildOrganizerEmail } from "@/lib/venueOrganizerEmail";
import type { VenueEventRow } from "./VenueEventsClient";

export interface OrganizerEmailPanelProps {
  event: VenueEventRow;
}

/**
 * Composes the organizer email (agreement link + payment link) as an editable
 * draft. Nothing is sent from here — "Open in Gmail" hands the draft to the admin.s
 * own compose window, preserving the send-it-yourself approval gate.
 */
export default function OrganizerEmailPanel({ event }: OrganizerEmailPanelProps): JSX.Element | null {
  const draft = useMemo(
    () =>
      buildOrganizerEmail({
        title: event.title,
        organizerName: event.organizerName,
        contactEmail: event.contactEmail,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        quoteAmountCents: event.quoteAmountCents,
        rentalFeeCents: event.rentalFeeCents,
        rentalPaymentUrl: event.rentalPaymentUrl,
        rentalPaymentStatus: event.rentalPaymentStatus,
        latestAgreement: event.latestAgreement
          ? { token: event.latestAgreement.token, status: event.latestAgreement.status }
          : null,
      }),
    [event]
  );

  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  // Re-seed the editable draft when the drawer switches to another event or
  // its links change (e.g. a payment link was just created).
  useEffect(() => {
    setSubject(draft.subject);
    setBody(draft.body);
    setCopyMessage(null);
  }, [draft.subject, draft.body]);

  if (event.dealType === "INTERNAL") {
    return null;
  }

  const openInGmail = (): void => {
    window.open(buildGmailComposeUrl(draft.to, subject, body), "_blank", "noopener,noreferrer");
  };

  const copyEmail = async (): Promise<void> => {
    const text = `To: ${draft.to}\nSubject: ${subject}\n\n${body}`;

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopyMessage("Email copied.");
        return;
      } catch {
        // Fall through to the manual instruction when clipboard permissions fail.
      }
    }

    setCopyMessage("Clipboard unavailable — select the text and copy it manually.");
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-slate-900">Organizer email</h3>
        <p className="mt-1 text-xs text-slate-500">
          Draft with the signing and payment links. Nothing sends from here — open it in Gmail
          and send it yourself.
        </p>
      </header>

      {draft.warnings.length > 0 ? (
        <ul className="mb-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {draft.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="organizer-email-to">
            To
          </label>
          <input
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            id="organizer-email-to"
            readOnly
            value={draft.to}
          />
        </div>

        <div>
          <label
            className="mb-1 block text-xs font-medium text-slate-600"
            htmlFor="organizer-email-subject"
          >
            Subject
          </label>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            id="organizer-email-subject"
            onChange={(changeEvent) => setSubject(changeEvent.target.value)}
            value={subject}
          />
        </div>

        <div>
          <label
            className="mb-1 block text-xs font-medium text-slate-600"
            htmlFor="organizer-email-body"
          >
            Body
          </label>
          <textarea
            className="min-h-56 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-900"
            id="organizer-email-body"
            onChange={(changeEvent) => setBody(changeEvent.target.value)}
            value={body}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={openInGmail}
            type="button"
          >
            Open in Gmail
          </button>
          <button
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            onClick={() => void copyEmail()}
            type="button"
          >
            Copy email
          </button>
          {copyMessage ? <span className="text-xs text-slate-500">{copyMessage}</span> : null}
        </div>
      </div>
    </section>
  );
}
