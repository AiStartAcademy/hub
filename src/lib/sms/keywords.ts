export const STOP_KEYWORDS = new Set([
  "CANCEL",
  "QUIT",
  "STOP",
  "OPTOUT",
  "UNSUBSCRIBE",
  "STOPALL",
  "REVOKE",
  "END",
]);

export const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

/**
 * The Contact write an inbound keyword causes, or null for ordinary replies.
 * It applies to EVERY contact holding the sender's number: STOP is a statement
 * about the phone, and two contacts can share one.
 */
export function smsOptOutWrite(
  action: "stop" | "start" | null,
  now: Date
): { smsOptOutAt: Date | null } | null {
  if (action === "stop") return { smsOptOutAt: now };
  if (action === "start") return { smsOptOutAt: null };
  return null;
}

export function smsKeywordAction(value: string): "stop" | "start" | null {
  const keyword = value.trim().toUpperCase();
  if (STOP_KEYWORDS.has(keyword)) return "stop";
  if (START_KEYWORDS.has(keyword)) return "start";
  return null;
}
