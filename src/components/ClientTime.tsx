"use client";

import { useEffect, useState } from "react";

export default function ClientTime({ isoString, fallback }: { isoString: string; fallback: string }) {
  const [time, setTime] = useState("");

  useEffect(() => {
    if (!isoString) return;
    if (isoString.includes("T") && isoString.includes("Z")) {
      const d = new Date(isoString);
      if (!isNaN(d.getTime())) {
        const formatted = `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        setTime(formatted);
      }
    }
  }, [isoString]);

  // Until hydration, render the server-provided fallback
  // to keep the layout stable and avoid a hydration error; it then switches to local time.
  if (!time) {
    return <span>{fallback}</span>;
  }

  return <span>{time}</span>;
}