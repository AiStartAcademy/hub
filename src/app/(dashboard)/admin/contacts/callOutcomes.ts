// Plain (non-"use server") module so these can be imported by client components.
// A "use server" file may only export async functions.

export const CALL_OUTCOMES = [
  "connected",
  "no_answer",
  "voicemail_left",
  "text_sent",
  "callback",
  "not_interested",
  "qualified",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Connected",
  no_answer: "No answer",
  voicemail_left: "Voicemail left",
  text_sent: "Text sent",
  callback: "Callback",
  not_interested: "Not interested",
  qualified: "Qualified",
};

export function isCallOutcome(value: string): value is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(value);
}

export function callOutcomeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return isCallOutcome(value) ? CALL_OUTCOME_LABELS[value] : value;
}

export function manualCallStatusForOutcome(
  outcome: CallOutcome
): "VOICEMAIL" | "COMPLETED" {
  return outcome === "voicemail_left" ? "VOICEMAIL" : "COMPLETED";
}
