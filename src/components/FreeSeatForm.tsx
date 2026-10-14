"use client";
// Shared registration form for any $0 seat — the lead-magnet cohorts and the
// free Group tiers on a normal cohort. One component so the two public surfaces
// (the /cohorts list card and the cohort detail rail) cannot drift apart; the
// `variant` only swaps class names so each surface keeps its own styling.
//
// Server contract: POST /api/cohorts/<slug|id>/register-free
//   body    { name?, email?, waiverAccepted?, groupId? }
//   200     { ok: true, enrolled: true, cohortUrl, joinLink? }   (joinLink: signed-in only)
//   4xx/429 { error }
import { useState } from "react";
import { useSession } from "next-auth/react";
import { brand } from "@/config/brand";
import { trackEvent } from "@/lib/analytics";

/** A $0 group is free. Negative is defensive — it must never reach Stripe either. */
export function isFreeTier(tier: { price: number } | null | undefined): boolean {
  return !!tier && tier.price <= 0;
}

export interface FreeSeatInput {
  name: string;
  email: string;
  waiverAccepted: boolean;
  groupId?: string;
  authenticated: boolean;
}

/**
 * Request body for register-free. A signed-in caller never sends name/email:
 * the route takes identity from the session, so sending them would only invite
 * someone to register a seat under a different address than their account.
 */
export function freeSeatRequestBody({
  name,
  email,
  waiverAccepted,
  groupId,
  authenticated,
}: FreeSeatInput): Record<string, unknown> {
  const body: Record<string, unknown> = { waiverAccepted };
  if (!authenticated) {
    body.name = name.trim();
    body.email = email.trim();
  }
  if (groupId) body.groupId = groupId;
  return body;
}

/**
 * Client-side gate before the POST — the route re-validates everything. Returns
 * the message to show inline, or null when the submission may go out.
 */
export function validateFreeSeat(input: {
  name: string;
  email: string;
  waiverAccepted: boolean;
  requiresWaiver: boolean;
  authenticated: boolean;
}): string | null {
  if (!input.authenticated) {
    if (!input.name.trim()) return "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      return "Please enter a valid email address.";
    }
  }
  if (input.requiresWaiver && !input.waiverAccepted) {
    return "Please accept the visitor waiver to register.";
  }
  return null;
}

/**
 * Success copy. A guest is told to check their inbox — the join link is never
 * rendered for an unverified email address, only mailed to it.
 */
export function freeSeatSuccessCopy({
  authenticated,
  joinLink,
}: {
  authenticated: boolean;
  joinLink?: string | null;
}): { message: string; joinLink: string | null } {
  if (!authenticated) {
    return {
      message: "✓ You're in — check your email for the join link and your account setup link.",
      joinLink: null,
    };
  }
  return { message: "✓ You're in.", joinLink: joinLink ?? null };
}

const FALLBACK_ERROR = "Could not register. Please try again.";

/** Existing class names on each surface — the component adds no styling of its own. */
const CLASSES = {
  list: {
    form: "cq-reg",
    input: "cq-in",
    waiver: "cq-waiver",
    button: "cq-btn cq-reg-btn",
    error: "cq-mem-err",
    done: "cq-reg-done",
    hint: "cq-hint",
  },
  detail: {
    form: "cd-free",
    input: "cd-in",
    waiver: "cd-waiver",
    button: "cd-btn",
    error: "cd-err",
    done: "cd-ok",
    hint: "cd-hint",
  },
} as const;

export interface FreeSeatFormProps {
  /** Cohort slug or id — goes straight into the register-free URL. */
  cohortRef: string;
  /** The chosen free Group. Omitted for lead-magnet cohorts (no tier picker). */
  groupId?: string;
  /** In-person seats meet at the venue, so the visitor waiver applies. */
  requiresWaiver: boolean;
  ctaLabel?: string | null;
  /** GA4 item_name for the generate_lead event. */
  trackingItemName: string;
  variant: "list" | "detail";
}

export default function FreeSeatForm({
  cohortRef,
  groupId,
  requiresWaiver,
  ctaLabel,
  trackingItemName,
  variant,
}: FreeSeatFormProps) {
  const cls = CLASSES[variant];
  const { status } = useSession();
  const authenticated = status === "authenticated";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ cohortUrl: string; joinLink: string | null } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const invalid = validateFreeSeat({ name, email, waiverAccepted, requiresWaiver, authenticated });
    if (invalid) {
      setError(invalid);
      setState("error");
      return;
    }
    setState("loading");
    setError("");
    try {
      const res = await fetch(`/api/cohorts/${cohortRef}/register-free`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          freeSeatRequestBody({ name, email, waiverAccepted, groupId, authenticated })
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        trackEvent("generate_lead", {
          conversion_kind: "free_cohort",
          item_name: trackingItemName,
        });
        setResult({
          cohortUrl: typeof data.cohortUrl === "string" ? data.cohortUrl : `/cohorts/${cohortRef}`,
          joinLink: typeof data.joinLink === "string" ? data.joinLink : null,
        });
        setState("done");
        return;
      }
      setError(typeof data.error === "string" && data.error ? data.error : FALLBACK_ERROR);
      setState("error");
    } catch {
      setError(FALLBACK_ERROR);
      setState("error");
    }
  }

  if (state === "done") {
    const copy = freeSeatSuccessCopy({ authenticated, joinLink: result?.joinLink });
    return (
      <div className={cls.form}>
        <p className={cls.done}>{copy.message}</p>
        {copy.joinLink && (
          <a className={cls.button} href={copy.joinLink} target="_blank" rel="noreferrer">
            Join Zoom →
          </a>
        )}
        {authenticated && result?.cohortUrl && (
          <p className={cls.hint}>
            <a href={result.cohortUrl}>Open cohort →</a>
          </p>
        )}
      </div>
    );
  }

  const waiverField = requiresWaiver && (
    <label className={cls.waiver}>
      <input
        type="checkbox"
        checked={waiverAccepted}
        onChange={(e) => setWaiverAccepted(e.target.checked)}
        required
      />
      <span>
        I have read and agree to the{" "}
        <a href="/waiver" target="_blank" rel="noopener noreferrer">
          {brand.wordmark} visitor waiver
        </a>
        .
      </span>
    </label>
  );

  return (
    <form className={cls.form} onSubmit={submit}>
      {!authenticated && (
        <>
          <input
            className={cls.input}
            type="text"
            placeholder="Your name"
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className={cls.input}
            type="email"
            placeholder="Email"
            autoComplete="email"
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </>
      )}
      {waiverField}
      <button
        className={cls.button}
        data-track="register_free"
        type="submit"
        disabled={state === "loading"}
      >
        {state === "loading"
          ? "Saving…"
          : authenticated
            ? "Reserve my seat — free"
            : `${ctaLabel || "Save your spot — free"} →`}
      </button>
      {state === "error" && error && <p className={cls.error}>{error}</p>}
    </form>
  );
}
