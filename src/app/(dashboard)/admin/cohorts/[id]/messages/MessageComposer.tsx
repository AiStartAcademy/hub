"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, MessageSquareText, Send } from "lucide-react";
import {
  canSubmitCohortMessage,
  composerFingerprint,
  insertAtCursor,
  sendConfirmMessage,
  smsCounter,
  wallTimeToIso,
} from "@/lib/cohortMessages/composerState";
import { COHORT_MESSAGE_MERGE_FIELDS } from "@/lib/cohortMessages/smsText";
import {
  previewCohortMessageAction,
  sendCohortMessageAction,
} from "./actions";

// Keep the client boundary honest: action result types come from the server
// action signatures, without importing the server-only send module.
type PreviewResult = Awaited<ReturnType<typeof previewCohortMessageAction>>;
type SendResult = Awaited<ReturnType<typeof sendCohortMessageAction>>;
type SuccessfulSend = Extract<SendResult, { ok: true }> & { scheduled: boolean };

type MessageComposerProps = {
  cohortId: string;
  cohortTimezone: string;
  smsEnabled: boolean;
};

type FocusedBody = "email" | "sms";

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function reasonLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800";

export function MessageComposer({
  cohortId,
  cohortTimezone,
  smsEnabled,
}: MessageComposerProps) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [includeInstructors, setIncludeInstructors] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [logisticsConfirmed, setLogisticsConfirmed] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessfulSend | null>(null);
  const [isPreviewing, startPreview] = useTransition();
  const [isSending, startSending] = useTransition();
  const submitGuard = useRef(false);
  const emailRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const [focusedBody, setFocusedBody] = useState<FocusedBody>("email");

  const currentFingerprint = useMemo(
    () =>
      composerFingerprint({
        subject,
        emailBody,
        smsBody,
        includeInstructors,
        sendAt,
      }),
    [emailBody, includeInstructors, sendAt, smsBody, subject]
  );
  const counter = useMemo(() => smsCounter(smsBody), [smsBody]);
  const scheduleValidation = useMemo(() => {
    if (!sendAt) return { ok: true, reason: null };
    const result = wallTimeToIso(sendAt, cohortTimezone);
    return result.ok
      ? { ok: true, reason: null }
      : { ok: false, reason: result.reason };
  }, [cohortTimezone, sendAt]);
  const busy = isPreviewing || isSending;
  const submitState = canSubmitCohortMessage({
    previewFingerprint,
    currentFingerprint,
    previewOk: preview?.ok === true,
    logisticsConfirmed,
    pending: busy,
    subject,
    emailBody,
    smsValidation: {
      enabled: smsEnabled,
      hasText: smsBody.trim().length > 0,
      ok: counter.ok,
      reason: counter.reason,
    },
    scheduleValidation,
  });
  const previewIsStale =
    previewFingerprint !== null && previewFingerprint !== currentFingerprint;

  function insertMergeField(field: (typeof COHORT_MESSAGE_MERGE_FIELDS)[number]) {
    const target: FocusedBody =
      focusedBody === "sms" && smsEnabled ? "sms" : "email";
    const ref: RefObject<HTMLTextAreaElement | null> =
      target === "sms" ? smsRef : emailRef;
    const text = target === "sms" ? smsBody : emailBody;
    const start = ref.current?.selectionStart ?? text.length;
    const end = ref.current?.selectionEnd ?? start;
    const next = insertAtCursor(text, start, end, `{${field}}`);
    if (target === "sms") setSmsBody(next.value);
    else setEmailBody(next.value);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  function handlePreview() {
    const requestedFingerprint = currentFingerprint;
    setError(null);
    setSuccess(null);
    startPreview(async () => {
      try {
        const result = await previewCohortMessageAction({
          cohortId,
          includeInstructors,
        });
        setPreview(result);
        setPreviewFingerprint(requestedFingerprint);
        if (!result.ok) setError(result.reason);
      } catch (caught) {
        console.error("Failed to preview cohort message", caught);
        setPreview(null);
        setPreviewFingerprint(null);
        setError("Preview failed. Please try again.");
      }
    });
  }

  function resetAfterSuccess() {
    setSubject("");
    setEmailBody("");
    setSmsBody("");
    setIncludeInstructors(false);
    setSendAt("");
    setLogisticsConfirmed(false);
    setPreview(null);
    setPreviewFingerprint(null);
    setIdempotencyKey(newIdempotencyKey());
  }

  function handleSend() {
    if (!submitState.enabled || submitGuard.current || !preview?.ok) return;

    let sendAtIso: string | null = null;
    if (sendAt) {
      const converted = wallTimeToIso(sendAt, cohortTimezone);
      if (!converted.ok) {
        setError(converted.reason);
        return;
      }
      sendAtIso = converted.iso;
    }

    const confirmed = window.confirm(
      sendConfirmMessage({
        total: preview.total,
        email: preview.email,
        sms: preview.sms,
        smsOn: smsEnabled && smsBody.trim().length > 0,
        schedule: sendAt
          ? { when: sendAt.replace("T", " "), timezone: cohortTimezone }
          : undefined,
      })
    );
    if (!confirmed) return;

    submitGuard.current = true;
    setError(null);
    setSuccess(null);
    startSending(async () => {
      try {
        const result = await sendCohortMessageAction({
          cohortId,
          subject,
          emailBody,
          smsBody: smsEnabled && smsBody.trim() ? smsBody : null,
          sendAt: sendAtIso,
          includeInstructors,
          logisticsConfirmed,
          idempotencyKey,
        });
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        setSuccess({ ...result, scheduled: Boolean(sendAt) });
        resetAfterSuccess();
        router.refresh();
      } catch (caught) {
        console.error("Failed to send cohort message", caught);
        setError("The message could not be submitted. Please try again.");
      } finally {
        submitGuard.current = false;
      }
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Compose cohort update
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Preview the current audience before sending or scheduling.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="cohort-message-subject" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
            Subject
          </label>
          <input
            id="cohort-message-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <Mail className="h-4 w-4 text-slate-400" />
            <label htmlFor="cohort-message-email" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Email body
            </label>
          </div>
          <textarea
            id="cohort-message-email"
            ref={emailRef}
            value={emailBody}
            onChange={(event) => setEmailBody(event.target.value)}
            onFocus={() => setFocusedBody("email")}
            rows={8}
            className={`${inputClass} resize-y`}
            placeholder="Write the logistics update in plain text. Links become clickable in the email."
            required
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Insert merge field
          </p>
          <div className="flex flex-wrap gap-2">
            {COHORT_MESSAGE_MERGE_FIELDS.map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => insertMergeField(field)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {`{${field}}`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-slate-400" />
              <label htmlFor="cohort-message-sms" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {smsEnabled
                  ? "Text message (optional)"
                  : "Text messages: pending carrier approval"}
              </label>
            </div>
            <span
              className={`text-xs font-semibold ${
                counter.ok ? "text-slate-500" : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {counter.length} / {counter.max} before merge fields
            </span>
          </div>
          <textarea
            id="cohort-message-sms"
            ref={smsRef}
            value={smsBody}
            onChange={(event) => setSmsBody(event.target.value)}
            onFocus={() => setFocusedBody("sms")}
            rows={4}
            className={`${inputClass} resize-y`}
            disabled={!smsEnabled}
            placeholder={smsEnabled ? "Short logistics update" : "Text sending is off"}
          />
          {smsEnabled && counter.reason && (
            <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              {counter.reason}
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeInstructors}
              onChange={(event) => setIncludeInstructors(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Include instructors
          </label>
          <div>
            <label htmlFor="cohort-message-send-at" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">
              Schedule (optional)
            </label>
            <input
              id="cohort-message-send-at"
              type="datetime-local"
              value={sendAt}
              onChange={(event) => setSendAt(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">Cohort timezone: {cohortTimezone}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={handlePreview}
            disabled={busy}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {isPreviewing && <Loader2 className="h-4 w-4 animate-spin" />}
            Preview audience
          </button>

          {preview?.ok && (
            <div className="mt-4 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold">
                {preview.email} get email · {smsEnabled ? `${preview.sms} get text · ${preview.smsMissing.length} can't get text` : "text is off"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {preview.total} total people in this audience
              </p>
              {(preview.emailMissing.length > 0 ||
                (smsEnabled && preview.smsMissing.length > 0)) && (
                <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    People missing a channel
                  </summary>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {preview.emailMissing.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Can&apos;t get email</p>
                        <ul className="mt-1 space-y-1 text-xs text-slate-500">
                          {preview.emailMissing.map((recipient, index) => (
                            <li key={`${recipient.name}-${recipient.reason}-${index}`}>
                              {recipient.name} — {reasonLabel(recipient.reason)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {smsEnabled && preview.smsMissing.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Can&apos;t get text</p>
                        <ul className="mt-1 space-y-1 text-xs text-slate-500">
                          {preview.smsMissing.map((recipient, index) => (
                            <li key={`${recipient.name}-${recipient.reason}-${index}`}>
                              {recipient.name} — {reasonLabel(recipient.reason)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              )}
              {previewIsStale && (
                <p className="mt-3 font-medium text-amber-700 dark:text-amber-300">
                  The message changed. Preview the audience again.
                </p>
              )}
            </div>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <input
            type="checkbox"
            checked={logisticsConfirmed}
            onChange={(event) => setLogisticsConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-amber-400 text-primary focus:ring-primary"
          />
          This is a logistics update, not a promotion
        </label>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        )}
        {success?.ok && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <p className="font-semibold">
              {success.scheduled ? "Message scheduled" : "Message submitted"}: {success.enrolled} enrolled
              {success.duplicate ? " (duplicate request; nothing was added)" : ""}.
            </p>
            {success.smsSkipped === "disabled" && (
              <p className="mt-1">Text was skipped because transactional SMS is off.</p>
            )}
          </div>
        )}

        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleSend}
            disabled={!submitState.enabled}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSending && <Loader2 className="h-4 w-4 animate-spin" />}
            {sendAt ? "Schedule" : "Send"}
          </button>
          {!submitState.enabled && submitState.reason && (
            <p className="text-xs font-medium text-slate-500">{submitState.reason}</p>
          )}
        </div>
      </div>
    </section>
  );
}
