// src/app/(dashboard)/courses/[programId]/components/AccessCta.tsx
//
// The single call-to-action for a viewer who does NOT have access to a program.
// Which CTA appears is decided by `accessRouteFor` in @/lib/programAccess, so
// the button always matches what the server will actually allow — we never
// render a self-enroll button whose action would refuse (see SELF_ENROLL_MODES).

import Link from "next/link";
import { Lock, ShieldCheck, ShoppingCart, Ticket } from "lucide-react";
import { brand } from "@/config/brand";
import type { AccessRoute } from "@/lib/programAccess";
import { EnrollButton } from "./EnrollButton";

const BUTTON_CLASS =
  "px-3 sm:px-5 py-2 bg-primary hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-primary text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-primary/20 hover:shadow-lg flex items-center justify-center gap-1.5 min-h-[44px]";

function formatCoursePrice(priceCents: number): string {
  const fractionDigits = priceCents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(priceCents / 100);
}

export function AccessCta({
  route,
  programId,
  priceCents,
}: {
  route: AccessRoute;
  programId: string;
  priceCents?: number | null;
}) {
  if (route === "self-enroll") {
    return <EnrollButton programId={programId} />;
  }

  if (route === "sign-in") {
    return (
      <Link href={`/register?callbackUrl=${encodeURIComponent(`/courses/${programId}`)}`} className={BUTTON_CLASS}>
        <span className="hidden sm:inline">Sign up to Access</span>
        <span className="sm:hidden">Sign up</span>
      </Link>
    );
  }

  if (route === "buy-course") {
    // The route can be called independently, so a missing price must stay safe and legible.
    const price =
      priceCents != null && priceCents > 0
        ? formatCoursePrice(priceCents)
        : null;

    return (
      <Link href="/self-paced" className={BUTTON_CLASS}>
        <ShoppingCart className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline">
          {price ? `Get the course — ${price}` : "Get the course"}
        </span>
        <span className="sm:hidden">{price ?? "Get the course"}</span>
      </Link>
    );
  }

  if (route === "membership") {
    return (
      <Link href="/cohorts#membership" className={BUTTON_CLASS}>
        <ShieldCheck className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline">Included with membership</span>
        <span className="sm:hidden">Membership</span>
      </Link>
    );
  }

  if (route === "buy-cohort-seat") {
    return (
      <Link href="/cohorts" className={BUTTON_CLASS}>
        <Ticket className="h-4 w-4 flex-shrink-0" />
        <span className="hidden sm:inline">Get a cohort seat</span>
        <span className="sm:hidden">Get a seat</span>
      </Link>
    );
  }

  // request-access (accessMode "direct") — granted by staff, nothing to self-serve.
  return (
    <span
      className="px-3 sm:px-5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 min-h-[44px]"
      title={`Access to this course is granted by the ${brand.shortName} team.`}
    >
      <Lock className="h-4 w-4 flex-shrink-0" />
      <span className="hidden sm:inline">Invite only</span>
      <span className="sm:hidden">Invite</span>
    </span>
  );
}
