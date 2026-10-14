import { CheckCircle2, Clock3, ExternalLink, Flag, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { MembershipPlanCard } from "@/components/MembershipPlans";
import { getMembershipEntitlements } from "@/lib/entitlements";
import { ensureMilestones, getLadder, type MilestoneLadderItem } from "@/lib/milestones";
import { MilestoneReportForm } from "./MilestoneReportForm";

export const metadata = { title: "Milestones" };
export const dynamic = "force-dynamic";

const TOTAL_MILESTONES = 6;

type RungState = "verified" | "pending" | "open";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getRungState(item: MilestoneLadderItem): RungState {
  if (!item.achievement) return "open";
  if (item.achievement.status === "verified") return "verified";
  if (item.achievement.status === "pending") return "pending";

  // Unexpected statuses still render as pending so members can re-submit evidence safely.
  return "pending";
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;

  return (
    <div className="mt-4">
      <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-slate-900 transition-all dark:bg-slate-100"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function MilestoneShell({
  children,
  badge,
}: {
  children: React.ReactNode;
  badge?: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Flag className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
          Milestones
        </h1>
        {badge ? (
          <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 sm:inline-block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {badge}
          </span>
        ) : null}
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}

function RungCard({ item }: { item: MilestoneLadderItem }) {
  const state = getRungState(item);
  const evidenceUrl = normalizeOptionalText(item.achievement?.evidenceUrl);
  const note = normalizeOptionalText(item.achievement?.note);

  const stateStyles =
    state === "verified"
      ? {
          card: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30",
          icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
          label: "Verified",
          labelClass:
            "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
          description:
            "This rung has been verified and now counts toward your ladder progress.",
        }
      : state === "pending"
        ? {
            card: "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30",
            icon: <Clock3 className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
            label: "Pending",
            labelClass:
              "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
            description: "Awaiting verification from the team. You can re-submit more evidence below.",
          }
        : {
            card: "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",
            icon: <Flag className="h-5 w-5 text-slate-400 dark:text-slate-500" />,
            label: "Open",
            labelClass:
              "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
            description: "When you hit this milestone, submit your proof here for review.",
          };

  return (
    <section className={`rounded-2xl border p-6 shadow-sm ${stateStyles.card}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {stateStyles.icon}
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{item.title}</h2>
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${stateStyles.labelClass}`}
            >
              {stateStyles.label}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
            {item.description || stateStyles.description}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          Rung {item.order + 1}
        </div>
      </div>

      {item.achievement ? (
        <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <p>
            Achieved on{" "}
            <span className="font-semibold text-slate-900 dark:text-white">
              {formatDate(item.achievement.achievedAt)}
            </span>
          </p>

          {state === "pending" ? (
            <p className="font-medium text-amber-700 dark:text-amber-300">Awaiting verification</p>
          ) : null}

          {evidenceUrl ? (
            <a
              href={evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-medium text-slate-700 hover:underline dark:text-slate-200"
            >
              View submitted evidence
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}

          {note ? <p className="rounded-lg bg-white/80 p-3 text-sm dark:bg-slate-950/60">{note}</p> : null}
        </div>
      ) : null}

      {state !== "verified" ? (
        <MilestoneReportForm milestoneKey={item.key} evidenceUrl={evidenceUrl} note={note} />
      ) : null}
    </section>
  );
}

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { snap, has } = await getMembershipEntitlements(session.user.id, session.user);
  const badge = snap.tier ? snap.tier.replace("_", " ") : null;

  if (!has.milestoneLadder) {
    return (
      <MilestoneShell badge={badge}>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Unlock the milestone ladder
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
                Track verified wins, submit evidence for review, and build your progression inside
                the Accelerator membership.
              </p>
            </div>
          </div>
        </section>

        <MembershipPlanCard tier="ACCELERATOR" highlight />
      </MilestoneShell>
    );
  }

  await ensureMilestones();
  const ladder = await getLadder(session.user.id);
  const items = [...ladder.items].sort((left, right) => left.order - right.order);

  return (
    <MilestoneShell badge={badge}>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Verified progress
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
              {ladder.verifiedCount} of {TOTAL_MILESTONES} milestones complete
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
              Each verified rung marks a concrete business milestone. Pending submissions remain
              editable until the team reviews them.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Submit proof on open or pending milestones to keep your ladder moving.
          </div>
        </div>

        <ProgressBar value={ladder.verifiedCount} total={TOTAL_MILESTONES} />
      </section>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Flag className="mx-auto mb-4 h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            No milestones are available yet
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
            The ladder seed did not load correctly. Refresh the page and try again.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <RungCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </MilestoneShell>
  );
}
