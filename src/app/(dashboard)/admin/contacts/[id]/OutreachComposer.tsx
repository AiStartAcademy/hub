"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  callOutcomeLabel,
  type CallOutcome,
} from "../callOutcomes";
import { smsableReason, type SmsabilityReason } from "@/lib/phone";
import type { OneOffBodyMode } from "@/lib/outreach/email";
import { MERGE_FIELD_TOKENS } from "@/lib/drip/mergeFieldTokens";
import type { TimelineItem } from "@/lib/leads/timeline";
import {
  addContactNote,
  deleteContactNote,
  draftOutreachEmailAction,
  logManualCall,
  previewOneOffEmailAction,
  sendOneOffEmailAction,
  sendSmsToLead,
  type NoteDTO,
  type SmsMessageDTO,
} from "./actions";

type ComposerTab = "call" | "sms" | "email" | "note";
type TimelineMutation = (current: TimelineItem[]) => TimelineItem[];

export type OutreachComposerProps = {
  contactId: string;
  contactName: string;
  email: string;
  phone: string | null;
  smsMarketingConsentAt: string | null;
  smsTransactionalConsentAt: string | null;
  smsOptOutAt: string | null;
  unsubscribedAt: string | null;
  initialMessages: SmsMessageDTO[];
  initialJournal: NoteDTO[];
  onTimelineChange: (mutation: TimelineMutation) => void;
  onTimelineRefresh: (actionLabel: string) => Promise<void>;
  onProfileRefresh: () => void;
};

const TABS: ReadonlyArray<{ id: ComposerTab; label: string }> = [
  { id: "call", label: "Call log" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "note", label: "Note" },
];

function fmtDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function smsReasonLabel(reason: SmsabilityReason, hasPhone: boolean): string {
  if (reason === "sms_opt_out") return "SMS disabled: contact opted out by replying STOP";
  if (!hasPhone) return "SMS disabled: no phone number";
  if (reason === "no_sms_marketing_consent") {
    return "SMS disabled: no marketing SMS consent on record";
  }
  if (reason === "no_sms_transactional_consent") {
    return "SMS disabled: no transactional SMS consent on record";
  }
  if (reason === "no_sms_consent") return "SMS disabled: no SMS consent on record";
  return "SMS disabled: phone number is not valid for SMS";
}

export default function OutreachComposer({
  contactId,
  contactName,
  email,
  phone,
  smsMarketingConsentAt,
  smsTransactionalConsentAt,
  smsOptOutAt,
  unsubscribedAt,
  initialMessages,
  initialJournal,
  onTimelineChange,
  onTimelineRefresh,
  onProfileRefresh,
}: OutreachComposerProps) {
  const [activeTab, setActiveTab] = useState<ComposerTab>("call");
  const [showLogCall, setShowLogCall] = useState(false);
  const [logOutcome, setLogOutcome] = useState<CallOutcome>("connected");
  const [logNotes, setLogNotes] = useState("");
  const [logDuration, setLogDuration] = useState("");
  const [callLogSaving, setCallLogSaving] = useState(false);
  const [callLogError, setCallLogError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessageDTO[]>(initialMessages);
  const [smsDraft, setSmsDraft] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [journal, setJournal] = useState<NoteDTO[]>(initialJournal);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailHtml, setEmailHtml] = useState("");
  const [emailMode, setEmailMode] = useState<OneOffBodyMode>("plain");
  const [emailDrafting, setEmailDrafting] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState("");
  const [emailPreviewError, setEmailPreviewError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const callRequestIdRef = useRef(0);
  const smsRequestIdRef = useRef(0);
  const noteRequestIdRef = useRef(0);
  const emailRequestIdRef = useRef(0);
  const emailPreviewRequestIdRef = useRef(0);
  const emailBodyRef = useRef<HTMLTextAreaElement>(null);
  const emailBodyFocusedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      callRequestIdRef.current += 1;
      smsRequestIdRef.current += 1;
      noteRequestIdRef.current += 1;
      emailRequestIdRef.current += 1;
      emailPreviewRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestId = ++emailPreviewRequestIdRef.current;
    if (!emailSubject.trim() && !emailHtml.trim()) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await previewOneOffEmailAction(
            contactId,
            emailSubject,
            emailHtml,
            emailMode
          );
          if (!mountedRef.current || requestId !== emailPreviewRequestIdRef.current) return;
          if (!result.ok) {
            setEmailPreviewError(result.error);
            return;
          }
          setEmailPreviewHtml(result.html);
          setEmailPreviewError(null);
        } catch (error: unknown) {
          if (!mountedRef.current || requestId !== emailPreviewRequestIdRef.current) return;
          setEmailPreviewError(
            error instanceof Error ? error.message : "Could not generate email preview"
          );
        }
      })();
    }, 400);

    return () => window.clearTimeout(timer);
  }, [contactId, emailSubject, emailHtml, emailMode]);

  const smsBlockedReason = smsableReason({
    phone,
    smsMarketingConsentAt: smsMarketingConsentAt
      ? new Date(smsMarketingConsentAt)
      : null,
    smsTransactionalConsentAt: smsTransactionalConsentAt
      ? new Date(smsTransactionalConsentAt)
      : null,
    smsOptOutAt: smsOptOutAt ? new Date(smsOptOutAt) : null,
  }, "any");
  const smsDisabledReason = smsBlockedReason
    ? smsReasonLabel(smsBlockedReason, Boolean(phone))
    : null;
  const emailDisabledReason = !email.trim()
    ? "Email disabled: lead has no email address"
    : unsubscribedAt
      ? "Email disabled: lead has unsubscribed"
      : null;
  const emailPreviewIsEmpty = !emailSubject.trim() && !emailHtml.trim();

  function insertEmailMergeField(token: string): void {
    const textarea = emailBodyRef.current;
    const hasSelection = emailBodyFocusedRef.current && textarea !== null;
    const selectionStart = hasSelection ? textarea.selectionStart : emailHtml.length;
    const selectionEnd = hasSelection ? textarea.selectionEnd : emailHtml.length;
    const nextValue = `${emailHtml.slice(0, selectionStart)}${token}${emailHtml.slice(selectionEnd)}`;
    const nextCaret = selectionStart + token.length;

    setEmailHtml(nextValue);
    window.requestAnimationFrame(() => {
      if (!mountedRef.current || !emailBodyRef.current) return;
      emailBodyRef.current.focus();
      emailBodyRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function saveLoggedCall(): void {
    const notes = logNotes.trim();
    if (!notes || callLogSaving) return;
    const durationInput = logDuration;
    const durationMin = Number(durationInput);
    const outcome = logOutcome;
    const requestId = ++callRequestIdRef.current;
    const occurredAt = new Date().toISOString();
    const optimisticTimelineItem: TimelineItem = {
      at: occurredAt,
      kind: "call_logged",
      label: "Call logged",
      detail: [
        callOutcomeLabel(outcome),
        Number.isFinite(durationMin) && durationMin > 0 ? `${durationMin}:00` : null,
        "You",
      ].filter(Boolean).join(" · "),
      call: {
        id: `optimistic-call-${requestId}`,
        provider: "manual",
        status: "COMPLETED",
        outcome,
        durationSec: Number.isFinite(durationMin) && durationMin > 0
          ? Math.round(durationMin * 60)
          : null,
        transcript: notes,
        summary: null,
        recordingUrl: null,
        transferredTo: null,
        authorLabel: "You",
      },
    };

    setCallLogError(null);
    setCallLogSaving(true);
    onTimelineChange((current) => [optimisticTimelineItem, ...current]);
    setShowLogCall(false);
    setLogNotes("");
    setLogDuration("");

    void (async () => {
      try {
        const result = await logManualCall(contactId, {
          outcome,
          notes,
          durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : undefined,
        });
        if (!mountedRef.current || requestId !== callRequestIdRef.current) return;
        if (!result.ok) {
          onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
          setShowLogCall(true);
          setLogOutcome(outcome);
          setLogNotes(notes);
          setLogDuration(durationInput);
          setCallLogError(result.reason);
          onProfileRefresh();
          return;
        }
        onProfileRefresh();
        await onTimelineRefresh("Call log");
      } catch (error: unknown) {
        if (!mountedRef.current || requestId !== callRequestIdRef.current) return;
        onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
        setShowLogCall(true);
        setLogOutcome(outcome);
        setLogNotes(notes);
        setLogDuration(durationInput);
        setCallLogError(error instanceof Error ? error.message : "Could not log call");
        onProfileRefresh();
      } finally {
        if (mountedRef.current && requestId === callRequestIdRef.current) {
          setCallLogSaving(false);
        }
      }
    })();
  }

  function prefillVoicemailSms(): void {
    const firstName = contactName.trim().split(/\s+/)[0] || "there";
    setSmsDraft(`Hi ${firstName}, I just left you a voicemail. Feel free to call or text me back when you have a moment.`);
    setActiveTab("sms");
  }

  async function sendSms(): Promise<void> {
    const body = smsDraft.trim();
    if (!body || smsSending || smsBlockedReason) return;
    const requestId = ++smsRequestIdRef.current;
    const optimisticId = `optimistic-sms-${requestId}`;
    const createdAt = new Date().toISOString();
    const optimisticMessage: SmsMessageDTO = {
      id: optimisticId,
      direction: "OUTBOUND",
      body: body.slice(0, 640),
      status: "QUEUED",
      error: null,
      authorLabel: "You",
      createdAt,
    };
    const optimisticTimelineItem: TimelineItem = {
      at: createdAt,
      kind: "sms_outbound",
      label: "SMS sent",
      detail: `${optimisticMessage.body.slice(0, 200)} · You`,
    };

    setSmsDraft("");
    setSmsError(null);
    setSmsSending(true);
    setMessages((current) => [...current, optimisticMessage]);
    onTimelineChange((current) => [optimisticTimelineItem, ...current]);

    try {
      const result = await sendSmsToLead(contactId, body);
      if (!mountedRef.current || requestId !== smsRequestIdRef.current) return;
      if (result.ok) {
        setMessages((current) => current.map((message) =>
          message.id === optimisticId ? result.message : message
        ));
        onTimelineChange((current) => current.map((item) =>
          item === optimisticTimelineItem
            ? {
                ...item,
                at: result.message.createdAt,
                label: result.message.status === "FAILED" ? "SMS failed" : "SMS sent",
                detail: result.message.authorLabel
                  ? `${result.message.body.slice(0, 200)} · ${result.message.authorLabel}`
                  : result.message.body.slice(0, 200),
              }
            : item
        ));
        onProfileRefresh();
        await onTimelineRefresh("SMS");
      } else {
        const reason = smsReasonLabel(result.reason, Boolean(phone));
        setSmsError(reason);
        onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
        setMessages((current) => current.map((message) =>
          message.id === optimisticId ? { ...message, status: "FAILED", error: reason } : message
        ));
        onProfileRefresh();
      }
    } catch (error: unknown) {
      if (!mountedRef.current || requestId !== smsRequestIdRef.current) return;
      const reason = error instanceof Error ? error.message : "SMS send failed";
      setSmsError(reason);
      onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
      setMessages((current) => current.map((message) =>
        message.id === optimisticId ? { ...message, status: "FAILED", error: reason } : message
      ));
      onProfileRefresh();
    } finally {
      if (mountedRef.current && requestId === smsRequestIdRef.current) setSmsSending(false);
    }
  }

  function saveNote(): void {
    const body = noteDraft.trim();
    if (!body || noteSaving) return;
    const requestId = ++noteRequestIdRef.current;
    const createdAt = new Date().toISOString();
    const optimisticNote: NoteDTO = {
      id: `optimistic-note-${requestId}`,
      body,
      authorLabel: "You",
      kind: "MANUAL",
      createdAt,
    };
    const optimisticTimelineItem: TimelineItem = {
      at: createdAt,
      kind: "note",
      label: "Note",
      detail: `You: ${body}`,
    };

    setNoteDraft("");
    setNoteError(null);
    setNoteSaving(true);
    setJournal((current) => [optimisticNote, ...current]);
    onTimelineChange((current) => [optimisticTimelineItem, ...current]);

    void (async () => {
      try {
        const note = await addContactNote(contactId, body);
        if (!mountedRef.current || requestId !== noteRequestIdRef.current) return;
        setJournal((current) => current.map((item) => item.id === optimisticNote.id ? note : item));
        onTimelineChange((current) => current.map((item) =>
          item === optimisticTimelineItem
            ? { ...item, at: note.createdAt, detail: `${note.authorLabel}: ${note.body}` }
            : item
        ));
        onProfileRefresh();
        await onTimelineRefresh("Note");
      } catch (error: unknown) {
        if (!mountedRef.current || requestId !== noteRequestIdRef.current) return;
        setJournal((current) => current.filter((note) => note.id !== optimisticNote.id));
        onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
        setNoteDraft((current) => current || body);
        setNoteError(error instanceof Error ? error.message : "Could not add note");
        onProfileRefresh();
      } finally {
        if (mountedRef.current && requestId === noteRequestIdRef.current) setNoteSaving(false);
      }
    })();
  }

  function removeNote(id: string): void {
    const removedNote = journal.find((note) => note.id === id);
    setJournal((current) => current.filter((note) => note.id !== id));
    void (async () => {
      try {
        await deleteContactNote(id);
        if (!mountedRef.current) return;
        onProfileRefresh();
        await onTimelineRefresh("Note deletion");
      } catch (error: unknown) {
        if (!mountedRef.current) return;
        if (removedNote) {
          setJournal((current) => current.some((note) => note.id === id)
            ? current
            : [removedNote, ...current]
          );
        }
        setNoteError(error instanceof Error ? error.message : "Could not delete note");
        onProfileRefresh();
      }
    })();
  }

  async function draftEmail(): Promise<void> {
    if (emailDrafting || emailSending || emailDisabledReason) return;
    setEmailDrafting(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      const result = await draftOutreachEmailAction(contactId);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setEmailError(result.error);
        return;
      }
      setEmailSubject(result.draft.subject);
      setEmailHtml(result.draft.html);
      setEmailMode("html");
    } catch (error: unknown) {
      if (mountedRef.current) {
        setEmailError(error instanceof Error ? error.message : "Could not draft outreach email");
      }
    } finally {
      if (mountedRef.current) setEmailDrafting(false);
    }
  }

  async function sendEmail(): Promise<void> {
    const subject = emailSubject.trim();
    const html = emailHtml.trim();
    if (!subject || !html || emailDrafting || emailSending || emailDisabledReason) return;
    const requestId = ++emailRequestIdRef.current;
    const optimisticTimelineItem: TimelineItem = {
      at: new Date().toISOString(),
      kind: "email_sent",
      label: "Email sent",
      detail: subject,
    };
    setEmailSending(true);
    setEmailError(null);
    setEmailSuccess(null);
    onTimelineChange((current) => [optimisticTimelineItem, ...current]);
    try {
      const result = await sendOneOffEmailAction(contactId, subject, html, emailMode);
      if (!mountedRef.current || requestId !== emailRequestIdRef.current) return;
      if (!result.ok) {
        onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
        setEmailError(result.error);
        onProfileRefresh();
        await onTimelineRefresh("Email");
        return;
      }
      setEmailSubject("");
      setEmailHtml("");
      setEmailMode("plain");
      setEmailSuccess(`Email sent to ${email}.`);
      onProfileRefresh();
      await onTimelineRefresh("Email");
    } catch (error: unknown) {
      if (!mountedRef.current || requestId !== emailRequestIdRef.current) return;
      onTimelineChange((current) => current.filter((item) => item !== optimisticTimelineItem));
      setEmailError(error instanceof Error ? error.message : "Could not send email");
      onProfileRefresh();
    } finally {
      if (mountedRef.current && requestId === emailRequestIdRef.current) setEmailSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Outreach</h2>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-xs font-bold transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "call" && (
        <div className="space-y-3">
          {!showLogCall ? (
            <button
              type="button"
              onClick={() => setShowLogCall(true)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Log a completed call
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap gap-2">
                <select
                  value={logOutcome}
                  onChange={(event) => setLogOutcome(event.target.value as CallOutcome)}
                  disabled={callLogSaving}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  {CALL_OUTCOMES.map((outcome) => (
                    <option key={outcome} value={outcome}>{CALL_OUTCOME_LABELS[outcome]}</option>
                  ))}
                </select>
                <input
                  value={logDuration}
                  onChange={(event) => setLogDuration(event.target.value)}
                  disabled={callLogSaving}
                  placeholder="Minutes"
                  inputMode="numeric"
                  className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <textarea
                value={logNotes}
                onChange={(event) => setLogNotes(event.target.value)}
                disabled={callLogSaving}
                rows={3}
                placeholder="What was said — notes or a pasted transcript…"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={saveLoggedCall}
                  disabled={callLogSaving || !logNotes.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
                >
                  {callLogSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save call
                </button>
                {logOutcome === "voicemail_left" && (
                  <button
                    type="button"
                    onClick={prefillVoicemailSms}
                    disabled={Boolean(smsBlockedReason)}
                    title={smsDisabledReason ?? "Prefill a follow-up text"}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Prefill follow-up SMS
                  </button>
                )}
              </div>
            </div>
          )}
          {callLogError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{callLogError}</p>}
        </div>
      )}

      {activeTab === "sms" && (
        <div>
          {smsOptOutAt && (
            <p className="mb-3 inline-block rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              SMS opt-out — replies STOP
            </p>
          )}
          {messages.length === 0 ? (
            <p className="mb-3 text-xs text-slate-400">No SMS messages yet.</p>
          ) : (
            <div className="mb-4 max-h-96 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
              {messages.map((message) => {
                const outbound = message.direction === "OUTBOUND";
                const failed = outbound && message.status === "FAILED";
                return (
                  <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] ${outbound ? "text-right" : "text-left"}`}>
                      <div className={`inline-block whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-sm ${
                        outbound
                          ? "bg-primary/10 text-slate-800 dark:text-slate-100"
                          : "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                      }`}>
                        {message.body}
                      </div>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                        {message.authorLabel && `${message.authorLabel} · `}
                        {message.status.toLowerCase()} · {fmtDateTime(message.createdAt)}
                      </p>
                      {failed && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{message.error ?? "Message delivery failed"}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-start gap-2">
            <textarea
              value={smsDraft}
              onChange={(event) => setSmsDraft(event.target.value.slice(0, 640))}
              rows={3}
              maxLength={640}
              disabled={Boolean(smsBlockedReason) || smsSending}
              placeholder="Write a text message…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => void sendSms()}
              disabled={Boolean(smsBlockedReason) || smsSending || !smsDraft.trim()}
              title={smsDisabledReason ?? (smsDraft.trim() ? "Send SMS" : "Write a message to send")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {smsSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className={`text-xs ${smsDisabledReason ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
              {smsDisabledReason ?? "Plain text · 640 characters maximum"}
            </p>
            <span className="text-[11px] text-slate-400">{smsDraft.length}/640</span>
          </div>
          {smsError && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{smsError}</p>}
        </div>
      )}

      {activeTab === "email" && (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-slate-400">Recipient</p>
            <p className={`text-sm ${emailDisabledReason ? "text-slate-400" : "text-slate-700 dark:text-slate-200"}`}>
              {email.trim() || "No email address"}
            </p>
            {emailDisabledReason && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{emailDisabledReason}</p>}
          </div>
          <input
            value={emailSubject}
            onChange={(event) => setEmailSubject(event.target.value)}
            disabled={Boolean(emailDisabledReason) || emailSending}
            placeholder="Subject"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
          />
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
            {(["plain", "html"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setEmailMode(mode)}
                disabled={Boolean(emailDisabledReason) || emailSending}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 ${
                  emailMode === mode
                    ? "bg-primary text-white"
                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {mode === "plain" ? "Plain text" : "HTML"}
              </button>
            ))}
          </div>
          <textarea
            ref={emailBodyRef}
            value={emailHtml}
            onChange={(event) => setEmailHtml(event.target.value)}
            onFocus={() => {
              emailBodyFocusedRef.current = true;
            }}
            disabled={Boolean(emailDisabledReason) || emailSending}
            rows={8}
            placeholder={emailMode === "plain" ? "Email body" : "Email body (HTML)"}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
          />
          <div className="flex flex-wrap gap-1.5">
            {MERGE_FIELD_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => insertEmailMergeField(token)}
                disabled={Boolean(emailDisabledReason) || emailSending}
                className="rounded-full border border-slate-200 px-2 py-1 font-mono text-[10px] text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                {token}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Preview</p>
            <div className="prose prose-sm min-h-24 max-w-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {!emailPreviewIsEmpty && emailPreviewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: emailPreviewHtml }} />
              ) : (
                <p className="text-xs text-slate-400">Preview appears here.</p>
              )}
              {!emailPreviewIsEmpty && emailPreviewError && (
                <p className="mt-2 text-xs text-slate-400">{emailPreviewError}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void draftEmail()}
              disabled={Boolean(emailDisabledReason) || emailDrafting || emailSending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {emailDrafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {emailDrafting ? "Drafting…" : "Draft with AI"}
            </button>
            <button
              type="button"
              onClick={() => void sendEmail()}
              disabled={Boolean(emailDisabledReason) || emailDrafting || emailSending || !emailSubject.trim() || !emailHtml.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {emailSending ? "Sending…" : "Send"}
            </button>
          </div>
          {emailError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{emailError}</p>}
          {emailSuccess && <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">{emailSuccess}</p>}
        </div>
      )}

      {activeTab === "note" && (
        <div>
          <div className="mb-3 flex gap-2">
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              disabled={noteSaving}
              rows={2}
              placeholder="Call summary, next step, context for whoever follows up…"
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={saveNote}
              disabled={noteSaving || !noteDraft.trim()}
              className="inline-flex self-start items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {noteSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Add
            </button>
          </div>
          {noteError && <p role="alert" className="mb-3 text-xs text-rose-600 dark:text-rose-400">{noteError}</p>}
          {journal.length === 0 ? (
            <p className="text-xs text-slate-400">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {journal.map((note) => (
                <li key={note.id} className="group flex gap-2 border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
                  <div className="flex-1">
                    <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{note.body}</p>
                    <p className="text-[11px] text-slate-400">
                      {note.authorLabel} · {fmtDateTime(note.createdAt)}
                      {note.kind === "DRIP_TASK" && " · follow-up task"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeNote(note.id)}
                    aria-label="Delete note"
                    className="self-start text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
