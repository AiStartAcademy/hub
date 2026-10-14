"use client";

import { useEffect } from "react";

/**
 * Global click tracker.
 *
 * Attaches a single delegated click listener to the document and pushes a
 * structured `ui_click` event to window.dataLayer for every interactive
 * element (buttons, links, inputs, [role=button], [data-track]). GTM can then
 * pick up `ui_click` from the dataLayer and forward it to GA4 as an event.
 *
 * To give an element an explicit, stable event name, add a data attribute:
 *   <button data-track="enroll_cohort">Enroll</button>
 * The value lands in the `label` field. Otherwise a label is derived from the
 * element's text / aria-label / title / name.
 */

type DataLayerEvent = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: DataLayerEvent[];
  }
}

// Elements we consider "clickable" for analytics purposes.
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="link"]',
  "summary",
  "input[type=submit]",
  "input[type=button]",
  "[data-track]",
].join(",");

function truncate(value: string, max = 100): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function deriveLabel(el: HTMLElement): string {
  const explicit = el.getAttribute("data-track");
  if (explicit) return explicit;

  const aria = el.getAttribute("aria-label");
  if (aria) return truncate(aria);

  const title = el.getAttribute("title");
  if (title) return truncate(title);

  const text = el.textContent;
  if (text && text.trim()) return truncate(text);

  const name = el.getAttribute("name") || el.getAttribute("value");
  if (name) return truncate(name);

  // Fall back to an icon-only button's first img/svg alt or aria.
  const img = el.querySelector("img[alt]");
  if (img) return truncate(img.getAttribute("alt") || "");

  return "(no label)";
}

export default function AnalyticsClicks() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const el = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
      if (!el) return;

      const tag = el.tagName.toLowerCase();
      const isLink = tag === "a" || el.getAttribute("role") === "link";
      const href = el.getAttribute("href") || undefined;

      // Categorize by nearest landmark for coarse grouping (nav, header, etc.).
      const region =
        el.closest("nav") ? "nav" :
        el.closest("header") ? "header" :
        el.closest("footer") ? "footer" :
        el.closest("aside") ? "sidebar" :
        el.closest("form") ? "form" :
        el.closest('[role="dialog"]') ? "dialog" :
        "content";

      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "ui_click",
        click_label: deriveLabel(el),
        click_element: tag,
        click_id: el.id || undefined,
        click_classes: el.className && typeof el.className === "string"
          ? truncate(el.className, 120)
          : undefined,
        click_region: region,
        click_href: href,
        click_is_external:
          isLink && href
            ? /^https?:\/\//i.test(href) && !href.includes(window.location.host)
            : undefined,
        page_path: window.location.pathname,
      });
    };

    // Capture phase so we still record clicks even if a handler stops propagation.
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  return null;
}
