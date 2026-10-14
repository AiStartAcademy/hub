// src/lib/chat/embedUrl.ts
//
// Pure URL/origin helpers for the Rocket.Chat iframe. Extracted from the
// component so the origin check is unit-testable — the previous inline check
// was a prefix test that a lookalike domain could satisfy.

/** Strict origin equality. Returns false rather than throwing on a bad chatUrl. */
export function isTrustedChatOrigin(chatUrl: string, origin: string): boolean {
  try {
    return new URL(chatUrl).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Build the iframe src. `path` defaults to the single-group view; pass "/home"
 * to embed the full Rocket.Chat app (its own channel list).
 *
 * NOTE: the resume token travels in the query string. That is Rocket.Chat's own
 * iframe-SSO contract, so it lands in history/referrers — tracked as a follow-up.
 */
export function buildChatEmbedUrl(input: {
  chatUrl: string;
  channelName?: string;
  path?: string;
  authToken: string | null;
}): string {
  const base = input.chatUrl.replace(/\/+$/, "");
  const path =
    input.path ?? `/group/${encodeURIComponent(input.channelName ?? "")}`;
  const query = input.authToken
    ? `?resumeToken=${encodeURIComponent(input.authToken)}`
    : "";
  return `${base}${path}${query}`;
}
