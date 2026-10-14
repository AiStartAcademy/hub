import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BookOpen, ExternalLink, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { getMembershipEntitlements, tierAtLeast } from "@/lib/entitlements";
import { MEMBERSHIP_TIER_CONFIG } from "@/lib/membershipTiers";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Member Library" };
export const dynamic = "force-dynamic";

type LibraryResource = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  url: string;
  category: string | null;
  minTier: string;
};

function formatTierLabel(tier: string): string {
  if (tier === "MENTOR_NETWORK" || tier === "ACCELERATOR") {
    return MEMBERSHIP_TIER_CONFIG[tier].label;
  }

  return tier;
}

function normalizeCategory(category: string | null): string {
  const trimmed = category?.trim();
  return trimmed ? trimmed : "General";
}

export default async function MembersLibraryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { snap } = await getMembershipEntitlements(session.user.id, session.user);
  const isStaff = hasAnyRole(session.user, MANAGE_ROLES);
  const resources = await prisma.memberResource.findMany({
    where: { published: true },
    orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      url: true,
      category: true,
      minTier: true,
    },
  });

  const grouped = resources.reduce<Map<string, Array<LibraryResource & { locked: boolean }>>>(
    (map, resource) => {
      const category = normalizeCategory(resource.category);
      const locked = !tierAtLeast(snap, resource.minTier);
      const existing = map.get(category) || [];
      existing.push({ ...resource, locked });
      map.set(category, existing);
      return map;
    },
    new Map(),
  );

  const categories = Array.from(grouped.keys()).sort((left, right) => {
    if (left === "General") return 1;
    if (right === "General") return -1;
    return left.localeCompare(right);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <BookOpen className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
          Member Library
        </h1>
        {snap.tier ? (
          <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 sm:inline-block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {formatTierLabel(snap.tier)}
          </span>
        ) : isStaff ? (
          <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 sm:inline-block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Staff preview
          </span>
        ) : null}
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {!snap.isMember && !isStaff ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Upgrade to unlock the full resource library
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Locked resources stay visible so you can see what is included at each membership
                tier.
              </p>
              <a
                href="/members#upgrade"
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
              >
                View membership options
                <ArrowRight className="h-4 w-4" />
              </a>
            </section>
          ) : isStaff && !snap.isMember ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Staff preview is showing the library without an active subscription.
            </section>
          ) : null}

          {resources.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
                No resources yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Published library resources will appear here.
              </p>
            </section>
          ) : (
            <div className="space-y-6">
              {categories.map((category) => (
                <section
                  key={category}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">{category}</h2>
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      {grouped.get(category)?.length || 0} items
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {grouped.get(category)?.map((resource) =>
                      resource.locked ? (
                        <div
                          key={resource.id}
                          className="rounded-xl border border-dashed border-slate-200 p-5 dark:border-slate-700"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-slate-900 dark:text-white">
                                  {resource.title}
                                </p>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                  {resource.type}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-500">
                                {resource.description || "Upgrade to unlock this resource."}
                              </p>
                            </div>
                            <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                          </div>
                          <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                            Requires {formatTierLabel(resource.minTier)}
                          </p>
                          <a
                            href="/members#upgrade"
                            className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                          >
                            Upgrade
                            <ArrowRight className="h-4 w-4" />
                          </a>
                        </div>
                      ) : (
                        <a
                          key={resource.id}
                          href={resource.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group rounded-xl border border-slate-200 p-5 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-slate-900 dark:text-white">
                                  {resource.title}
                                </p>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                  {resource.type}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-500">
                                {resource.description || "Open this member resource."}
                              </p>
                            </div>
                            <ExternalLink className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400 transition group-hover:text-slate-500" />
                          </div>
                          <div className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                            <span>{formatTierLabel(resource.minTier)}</span>
                          </div>
                        </a>
                      ),
                    ) || null}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className="text-xs text-slate-400">
            Need membership changes? Go back to{" "}
            <Link href="/members#upgrade" className="font-medium text-primary hover:underline">
              the members home upgrade section
            </Link>
            .
          </div>
        </div>
      </main>
    </div>
  );
}
