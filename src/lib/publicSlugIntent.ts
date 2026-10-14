/**
 * What to do with a user's public handle (`User.slug`) on a profile write.
 *
 * Extracted as a pure decision so it can be tested without a database. It earned that
 * treatment: the first version of this logic keyed the auto-generate branch off the
 * *stored* visibility, which meant an already-public slug-less user got a handle written
 * during an unrelated headline edit — a column the operator's confirmed diff never
 * mentioned. On a tool whose whole safety model is "the human reads the diff", a write
 * the diff omits is the worst class of bug available.
 *
 * The dedupe round-trip (`uniqueUserSlug`) stays with the caller; this only decides intent.
 */

import { hasSlugSafeChars } from "@/lib/slug";
import { isPubliclyReachable } from "@/lib/profileVisibility";

export type PublicSlugIntent =
  /** Don't touch the column. */
  | { action: "leave" }
  /** Set it to null — no public handle. */
  | { action: "clear" }
  /** Slugify + dedupe this base, then store it. */
  | { action: "set"; base: string }
  /** Bad request; `reason` is caller-facing. */
  | { action: "refuse"; reason: string };

export interface PublicSlugInput {
  /** Whether `publicSlug` was present in the request body at all. */
  publicSlugProvided: boolean;
  /** The requested handle; null means "clear it". Ignored when not provided. */
  publicSlug?: string | null;
  /** Visibility THIS request sets, or null/undefined when the request doesn't touch it. */
  requestedVisibility?: string | null;
  /** Visibility currently stored. */
  storedVisibility: string;
  /** Handle currently stored. */
  currentSlug: string | null;
  name: string | null;
  email: string;
}

export function resolvePublicSlugIntent(input: PublicSlugInput): PublicSlugIntent {
  const {
    publicSlugProvided,
    publicSlug,
    requestedVisibility,
    storedVisibility,
    currentSlug,
    name,
    email,
  } = input;

  if (publicSlugProvided) {
    if (publicSlug === null) {
      // Clearing the handle of a profile that is (or is becoming) reachable would leave
      // it published at no address.
      const effective = requestedVisibility ?? storedVisibility;
      if (isPubliclyReachable(effective)) {
        return {
          action: "refuse",
          reason:
            "publicSlug cannot be cleared while profileVisibility is PUBLIC or UNLISTED — the profile would be reachable at no address",
        };
      }
      return { action: "clear" };
    }

    const requested = (publicSlug ?? "").trim();
    if (!requested) {
      return { action: "refuse", reason: "publicSlug cannot be empty" };
    }
    if (!hasSlugSafeChars(requested)) {
      return {
        action: "refuse",
        reason: `publicSlug "${requested}" has no URL-safe characters — pass an ASCII handle`,
      };
    }
    return { action: "set", base: requested };
  }

  // No explicit handle. Auto-generate ONLY when this request is what makes the profile
  // reachable, and only when there is no handle to preserve. Both conditions matter:
  // the first keeps unrelated edits from writing this column, the second keeps a live
  // URL from being silently replaced.
  if (isPubliclyReachable(requestedVisibility) && !currentSlug) {
    if (hasSlugSafeChars(name ?? "")) return { action: "set", base: name as string };
    const localPart = email.split("@")[0] ?? "";
    if (hasSlugSafeChars(localPart)) return { action: "set", base: localPart };
    return {
      action: "refuse",
      reason:
        "could not derive a usable publicSlug from the name or email — pass publicSlug explicitly",
    };
  }

  return { action: "leave" };
}
