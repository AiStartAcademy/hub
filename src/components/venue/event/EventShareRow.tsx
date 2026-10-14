"use client";

// Share + add-to-calendar row. Client-side only because copy-to-clipboard needs
// the browser; the Google Calendar template URL and the .ics href are computed
// on the server and passed in, so nothing here re-derives event times.

import { useState, type JSX } from "react";

export function EventShareRow({
  title,
  eventUrl,
  icsHref,
  googleCalendarUrl,
}: {
  title: string;
  eventUrl: string;
  icsHref: string;
  googleCalendarUrl: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked (insecure context, denied permission). The link is
      // visible in the address bar anyway — failing quietly beats an alert().
    }
  };

  const shareText = encodeURIComponent(title);
  const shareUrl = encodeURIComponent(eventUrl);

  const linkClass =
    "inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

  return (
    <div className="flex flex-wrap gap-2">
      <a className={linkClass} href={icsHref}>
        Add to calendar
      </a>
      <a className={linkClass} href={googleCalendarUrl} rel="noopener noreferrer" target="_blank">
        Google Calendar
      </a>
      <button className={linkClass} onClick={copyLink} type="button">
        {copied ? "Link copied" : "Copy link"}
      </button>
      <a
        className={linkClass}
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        LinkedIn
      </a>
      <a
        className={linkClass}
        href={`https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        X
      </a>
    </div>
  );
}
