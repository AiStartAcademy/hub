import { ArrowRight, CalendarDays, Clock3, PlayCircle, Video } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { MembershipPlanCard } from "@/components/MembershipPlans";
import { getMembershipEntitlements } from "@/lib/entitlements";
import {
  getPastCourseCallEvents,
  getPastMemberEvents,
  getUpcomingCourseCallEvents,
  getUpcomingMemberEvents,
  type MemberEventItem,
} from "@/lib/memberEvents";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { getUserPod } from "@/lib/pods";
import { hasCourseCallAccess } from "@/lib/selfPaced";

export const metadata = { title: "Member Calls" };
export const dynamic = "force-dynamic";

const EVENT_TYPE_LABELS: Record<string, string> = {
  COACHING: "Coaching Call",
  DEAL_DESK: "Deal Desk",
  BUILD_SPRINT: "Build Sprint",
  WEEKLY_QA: "Weekly Q&A",
};

function formatEventType(type: string): string {
  return EVENT_TYPE_LABELS[type] || type;
}

function formatEventDate(date: Date): string {
  // `date` is a UTC-midnight day key for both MemberEvent rows (date input) and
  // mirrored cohort sessions (local day), so it must be read back in UTC — the
  // server's own zone would shift a Sunday session to "Saturday" on a PT box.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function EventCard({
  event,
  linkLabel,
  linkHref,
}: {
  event: MemberEventItem;
  linkLabel?: string;
  linkHref?: string | null;
}) {
  const actionHref = linkHref?.trim() ? linkHref : null;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {formatEventType(event.type)}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              {event.status}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">{event.title}</h3>
          <div className="mt-3 flex flex-col gap-2 text-sm text-slate-500 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 flex-shrink-0 text-slate-400" />
              <span>{formatEventDate(event.date)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 flex-shrink-0 text-slate-400" />
              <span>
                {event.startTime} - {event.endTime} {event.timezone}
              </span>
            </div>
          </div>
        </div>
        <Video className="h-5 w-5 flex-shrink-0 text-slate-300 dark:text-slate-600" />
      </div>

      {event.description ? (
        <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-300">
          {event.description}
        </p>
      ) : null}

      {actionHref && linkLabel ? (
        <a
          href={actionHref}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
        >
          {linkLabel}
          <ArrowRight className="h-4 w-4" />
        </a>
      ) : null}
    </article>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
      <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">{title}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{description}</p>
    </div>
  );
}

export default async function MemberCallsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { snap } = await getMembershipEntitlements(session.user.id, session.user);
  const isStaff = hasAnyRole(session.user, MANAGE_ROLES);
  const pod = await getUserPod(session.user.id);
  const podIds = pod ? [pod.id] : [];
  let hasCourseAccess = false;

  if (!snap.isMember && !isStaff) {
    hasCourseAccess = await hasCourseCallAccess(session.user.id);
  }

  if (!snap.isMember && !isStaff && !hasCourseAccess) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
          <MobileMenuButton />
          <Video className="h-5 w-5 flex-shrink-0 text-slate-400" />
          <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
            Member Calls
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Join live calls, office hours, and member workshops
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-300">
                Membership unlocks the live calendar plus recordings from eligible sessions. Pick
                the tier that matches the support and access you want.
              </p>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <MembershipPlanCard tier="MENTOR_NETWORK" />
              <MembershipPlanCard tier="ACCELERATOR" highlight />
            </section>
          </div>
        </main>
      </div>
    );
  }

  const isCourseBuyer = !snap.isMember && !isStaff && hasCourseAccess;
  let upcomingEvents: MemberEventItem[];
  let pastEvents: MemberEventItem[];

  if (isCourseBuyer) {
    upcomingEvents = await getUpcomingCourseCallEvents({ podIds });
    pastEvents = await getPastCourseCallEvents({ podIds });
  } else {
    upcomingEvents = await getUpcomingMemberEvents(snap, { podIds });
    pastEvents = await getPastMemberEvents(snap, { podIds });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Video className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
          Member Calls
        </h1>
        <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 sm:inline-block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {isCourseBuyer ? "Course access" : snap.tier || (isStaff ? "Staff preview" : "Member")}
        </span>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {isStaff && !snap.isMember ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Staff preview is showing the members calls area without an active subscription.
            </section>
          ) : null}

          {isCourseBuyer ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Weekly check-in calls are included with your self-paced course — the full calls
              calendar comes with membership.
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Upcoming</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  Your next live sessions and office hours.
                </p>
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {upcomingEvents.length} scheduled
              </span>
            </div>

            {upcomingEvents.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No upcoming events"
                  description="New sessions will appear here as soon as they are scheduled for your tier."
                />
              </div>
            ) : (
              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {upcomingEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    linkLabel="Join"
                    linkHref={event.meetingLink}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Past</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  {isCourseBuyer
                    ? "Replay available weekly check-in sessions included with your course."
                    : "Replay available sessions from your membership history."}
                </p>
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                {pastEvents.length} completed
              </span>
            </div>

            {pastEvents.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No past events"
                  description="Completed sessions with available access will show up here after they wrap."
                />
              </div>
            ) : (
              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {pastEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    linkLabel="Watch recording"
                    linkHref={event.recordingLink}
                  />
                ))}
              </div>
            )}
          </section>

          {isCourseBuyer ? (
            <section className="grid gap-6 lg:grid-cols-2">
              <MembershipPlanCard tier="MENTOR_NETWORK" />
              <MembershipPlanCard tier="ACCELERATOR" highlight />
            </section>
          ) : null}

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <PlayCircle className="h-4 w-4" />
            Recordings appear only when access is included for your tier and a recording is
            available.
          </div>
        </div>
      </main>
    </div>
  );
}
