import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock3,
  Lock,
  type LucideIcon,
  PlayCircle,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import {
  MembershipPlanCard,
  MembershipPlans,
  fmtMembershipPrice,
} from "@/components/MembershipPlans";
import { getMemberHomeData } from "@/lib/members";
import {
  MEMBERSHIP_TIER_CONFIG,
  type MembershipTier,
} from "@/lib/membershipTiers";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Members" };
export const dynamic = "force-dynamic";

const TOTAL_MILESTONES = 6;

const LOCKED_BENEFITS: Array<{
  key: "coachingCalls" | "dealDesk" | "buildSprint";
  title: string;
  description: string;
}> = [
  {
    key: "coachingCalls",
    title: "Coaching calls",
    description: "Bring blockers to live coaching and get tactical feedback faster.",
  },
  {
    key: "dealDesk",
    title: "Deal desk",
    description: "Workshop offers, pricing, and GTM decisions with the team.",
  },
  {
    key: "buildSprint",
    title: "Build sprint",
    description: "Ship with structured sprint support and live accountability.",
  },
];

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Event dates are UTC-midnight day keys (MemberEvent date input, mirrored cohort
// sessions' local day), so read them back in UTC or a PT server shifts them a day.
function formatDayKey(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatClockRange(startTime: string, endTime: string, timezone: string): string {
  return `${startTime} - ${endTime} ${timezone}`;
}

function formatTierLabel(tier: string | null | undefined): string {
  if (tier === "MENTOR_NETWORK" || tier === "ACCELERATOR") {
    return MEMBERSHIP_TIER_CONFIG[tier].label;
  }

  return tier || "Members";
}

function LockedCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
          <Icon className="h-5 w-5 text-slate-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
          <a
            href="/members#upgrade"
            className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
          >
            Upgrade
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  href,
}: {
  icon: LucideIcon;
  title: string;
  href: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        <Icon className="h-5 w-5 text-slate-500" />
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <Link
        href={href}
        className="ml-auto inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
      >
        View all
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export default async function MembersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { snap, has, upcomingEvents, pod, ladder, libraryPreview, recordings } =
    await getMemberHomeData(session.user.id, session.user);
  const isStaff = hasAnyRole(session.user, MANAGE_ROLES);
  const isNonMember = !snap.isMember && !isStaff;
  const callsUnlocked =
    has.weeklyQa || has.coachingCalls || has.dealDesk || has.buildSprint;
  const currentTierLabel = snap.tier
    ? MEMBERSHIP_TIER_CONFIG[snap.tier as MembershipTier].label
    : isStaff
      ? "Staff preview"
      : "Guest";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Users className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Members</h1>
        <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 sm:inline-block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {currentTierLabel}
        </span>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {snap.inGrace ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
              <span className="font-bold">Payment issue:</span> update billing in{" "}
              <Link href="/settings" className="font-bold underline underline-offset-2">
                Settings
              </Link>
              . Access stays active during your grace period.
            </div>
          ) : null}

          {isNonMember ? (
            <section
              id="upgrade"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="max-w-3xl">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Member access
                </span>
                <h2 className="mt-4 text-3xl font-bold text-slate-900 dark:text-white">
                  Join the members area to unlock calls, resources, and accountability.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                  Start with Access To All Recordings at{" "}
                  {fmtMembershipPrice(MEMBERSHIP_TIER_CONFIG.MENTOR_NETWORK.amountCents)}
                  /mo, or step into Accelerator for hands-on coaching and build support.
                </p>
              </div>

              <div className="mt-8">
                <MembershipPlans />
              </div>
            </section>
          ) : (
            <>
              {isStaff && !snap.isMember ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  Staff preview is showing the member home without an active subscription.
                </div>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
                      Member home
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                      {snap.tier === "ACCELERATOR"
                        ? "Your accelerator workspace"
                        : "Your weekly operating hub"}
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                      Track what is coming up, what you have unlocked, and where to go next.
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                      Current plan
                    </p>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
                      {currentTierLabel}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {snap.currentPeriodEnd
                        ? `Current period ends ${formatDate(snap.currentPeriodEnd)}.`
                        : "Membership access is active from your current role or plan."}
                    </p>
                  </div>
                </div>
              </section>

              <div className="grid gap-6 xl:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {callsUnlocked ? (
                    <>
                      <SectionHeader
                        icon={CalendarDays}
                        title="Upcoming calls"
                        href="/members/calls"
                      />
                      {upcomingEvents.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                          No calls are scheduled for you right now.
                        </div>
                      ) : (
                        <ul className="space-y-3">
                          {upcomingEvents.slice(0, 3).map((event) => (
                            <li
                              key={event.id}
                              className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                                    {event.title}
                                  </p>
                                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                                    {event.type}
                                  </p>
                                </div>
                                <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-300">
                                  {formatTierLabel(event.minTier)}
                                </span>
                              </div>
                              <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                                <Clock3 className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                {formatDayKey(event.date)} ·{" "}
                                {formatClockRange(
                                  event.startTime,
                                  event.endTime,
                                  event.timezone,
                                )}
                              </p>
                              {event.description ? (
                                <p className="mt-2 text-sm text-slate-500">{event.description}</p>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">
                                  Join from the calls page when the session opens.
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <LockedCard
                      icon={CalendarDays}
                      title="Upcoming calls"
                      description="Unlock live calls, guided feedback, and sprint sessions from your member schedule."
                    />
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {has.milestoneLadder ? (
                    <>
                      <SectionHeader
                        icon={Target}
                        title="Milestone ladder"
                        href="/members/milestones"
                      />
                      {ladder.items.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                          No milestone steps are configured yet.
                        </div>
                      ) : (
                        <>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">
                              {ladder.verifiedCount} of {TOTAL_MILESTONES} verified
                            </p>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (ladder.verifiedCount / TOTAL_MILESTONES) * 100,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                          <ul className="mt-4 space-y-3">
                            {ladder.items.slice(0, 3).map((item) => (
                              <li
                                key={item.id}
                                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                                      {item.title}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-500">
                                      {item.description || "Track this milestone inside the ladder."}
                                    </p>
                                  </div>
                                  <span
                                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                                      item.achievement?.verifiedById
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                        : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                    }`}
                                  >
                                    {item.achievement?.verifiedById ? "Verified" : "In progress"}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  ) : (
                    <LockedCard
                      icon={Target}
                      title="Milestone ladder"
                      description="Unlock the verified milestone ladder to track momentum and progress."
                    />
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {has.memberLibrary ? (
                    <>
                      <SectionHeader
                        icon={BookOpen}
                        title="Library preview"
                        href="/members/library"
                      />
                      {libraryPreview.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                          No library resources are published yet.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {libraryPreview.map((resource) =>
                            resource.locked ? (
                              <div
                                key={resource.id}
                                className="rounded-xl border border-dashed border-slate-200 p-4 dark:border-slate-700"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                                      {resource.title}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-500">
                                      {resource.description || "Upgrade to unlock this resource."}
                                    </p>
                                  </div>
                                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                                </div>
                                <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                                  <span>{resource.type}</span>
                                  <span>·</span>
                                  <span>{formatTierLabel(resource.minTier)}</span>
                                </div>
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
                                href={resource.url || undefined}
                                className="block rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                                      {resource.title}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-500">
                                      {resource.description || "Open this member resource."}
                                    </p>
                                  </div>
                                  <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                                </div>
                                <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                                  <span>{resource.type}</span>
                                  {resource.category ? (
                                    <>
                                      <span>·</span>
                                      <span>{resource.category}</span>
                                    </>
                                  ) : null}
                                </div>
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <LockedCard
                      icon={BookOpen}
                      title="Member library"
                      description="Unlock playbooks, templates, and resource packs curated for members."
                    />
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {has.recordings ? (
                    <>
                      <SectionHeader
                        icon={PlayCircle}
                        title="Recent recordings"
                        href="/members/calls"
                      />
                      {recordings.items.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                          No recordings are available yet.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {recordings.items.slice(0, 3).map((item) =>
                            item.href ? (
                              <a
                                key={item.id}
                                href={item.href}
                                className="block rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
                              >
                                <p className="text-sm font-bold text-slate-900 dark:text-white">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {item.summary || item.context}
                                </p>
                                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                                  {formatDate(item.recordedAt)} · {item.duration} min
                                </p>
                              </a>
                            ) : (
                              <div
                                key={item.id}
                                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                              >
                                <p className="text-sm font-bold text-slate-900 dark:text-white">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {item.summary || item.context}
                                </p>
                                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                                  {formatDate(item.recordedAt)} · {item.duration} min
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <LockedCard
                      icon={PlayCircle}
                      title="Session recordings"
                      description="Unlock the recordings archive to revisit member sessions on demand."
                    />
                  )}
                </section>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {has.pod ? (
                    <>
                      <SectionHeader icon={Users} title="Accountability pod" href="/members/pod" />
                      {pod ? (
                        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">
                            Your pod is active
                          </p>
                          <p className="mt-2 text-sm text-slate-500">
                            Open your pod space for member check-ins, shared accountability, and
                            session details.
                          </p>
                          <Link
                            href="/members/pod"
                            className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                          >
                            Open pod
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                          Your pod assignment has not been published yet.
                        </div>
                      )}
                    </>
                  ) : (
                    <LockedCard
                      icon={Users}
                      title="Accountability pod"
                      description="Unlock pod matching for tighter accountability with your peers."
                    />
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                      <Sparkles className="h-5 w-5 text-slate-500" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      Unlock next
                    </h2>
                  </div>
                  {LOCKED_BENEFITS.filter((benefit) => !has[benefit.key]).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                      Your current plan already includes every live support track shown here.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {LOCKED_BENEFITS.filter((benefit) => !has[benefit.key]).map((benefit) => (
                        <LockedCard
                          key={benefit.key}
                          icon={Lock}
                          title={benefit.title}
                          description={benefit.description}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {snap.tier === "MENTOR_NETWORK" ? (
                <section
                  id="upgrade"
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="max-w-3xl">
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
                      Upgrade path
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                      Add Accelerator when you want hands-on build and deal support.
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Accelerator adds the live coaching, deal desk, and sprint layers above your
                      current Access To All Recordings plan.
                    </p>
                  </div>
                  <div className="mt-8 max-w-xl">
                    <MembershipPlanCard tier="ACCELERATOR" highlight />
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
