// src/components/chat/ChatSignInNotice.tsx
//
// Shown when RocketChatService.createIframeToken() returns null. That is not an
// error: it means this person set their own Rocket.Chat password, so the
// deterministic shadow-account login no longer works for them. Embedding the
// iframe anyway loads Rocket.Chat logged-out, which renders a confusing
// "Room not found" — so we offer a real sign-in instead.

export function ChatSignInNotice({
  chatUrl,
  channelName,
  compact = false,
}: {
  chatUrl?: string;
  channelName?: string;
  compact?: boolean;
}) {
  const href = chatUrl
    ? `${chatUrl.replace(/\/+$/, "")}${channelName ? `/group/${encodeURIComponent(channelName)}` : "/home"}`
    : null;

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "h-full p-6" : "p-6"}`}>
      <div className="max-w-md rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Sign in to chat</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          You set your own chat password, so we can&apos;t sign you in automatically.
          Open chat and log in once — it stays signed in after that.
        </p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
          >
            Open chat
          </a>
        )}
      </div>
    </div>
  );
}
