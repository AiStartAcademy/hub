import { ArrowRight, Sparkles, UserRound, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { MembershipPlanCard } from "@/components/MembershipPlans";
import { getMembershipEntitlements } from "@/lib/entitlements";
import { getUserPod, type UserPodCoach, type UserPodMember } from "@/lib/pods";
import { prisma } from "@/lib/prisma";
import { provisionPodChannel, podGroupName } from "@/lib/memberChat";
import { RocketChatService } from "@/lib/rocketchat";
import { RocketChatEmbed } from "@/components/chat/RocketChatEmbed";

// Server component: provisions the pod's RocketChat group (idempotent) and
// embeds it with a seamless-login token. Degrades to a note on RC downtime.
async function PodChatSection({
  podId,
  podSlug,
  userId,
}: {
  podId: string;
  podSlug: string;
  userId: string;
}) {
  let authToken: string | null = null;
  if (process.env.RC_URL) {
    await provisionPodChannel(podId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user) authToken = await RocketChatService.createIframeToken(user.email);
  }

  if (!process.env.RC_URL || !authToken) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Pod Chat</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
          Chat is warming up — refresh in a minute, or ping us if it stays offline.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
      <div className="p-6 pb-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Pod Chat</h2>
      </div>
      <div className="h-[560px]">
        <RocketChatEmbed
          chatUrl={process.env.RC_URL}
          authToken={authToken}
          channelName={podGroupName(podSlug)}
        />
      </div>
    </section>
  );
}

export const metadata = { title: "My Pod" };
export const dynamic = "force-dynamic";

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getDisplayName(name: string | null, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : fallback;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "PM";
}

function Avatar({
  image,
  label,
}: {
  image: string | null | undefined;
  label: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt={label}
        className="h-12 w-12 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
      {getInitials(label)}
    </div>
  );
}

function CoachCard({ coach }: { coach: UserPodCoach | null }) {
  if (!coach) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Coach</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
              A coach will be assigned here when your pod is ready.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const coachName = getDisplayName(coach.name, "Pod coach");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-4">
        <Avatar image={coach.image} label={coachName} />
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Coach</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">{coachName}</p>
        </div>
      </div>
    </section>
  );
}

function MemberRow({
  member,
  index,
}: {
  member: UserPodMember;
  index: number;
}) {
  const memberName = getDisplayName(member.user.name, `Pod member ${index + 1}`);
  const isLead = member.role === "lead";

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar image={member.user.image} label={memberName} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{memberName}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
            Joined {member.joinedAt.toLocaleDateString("en-US")}
          </p>
        </div>
      </div>

      {isLead ? (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          Lead
        </span>
      ) : null}
    </div>
  );
}

export default async function MemberPodPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { has } = await getMembershipEntitlements(session.user.id, session.user);

  if (!has.pod) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
          <MobileMenuButton />
          <Users className="h-5 w-5 flex-shrink-0 text-slate-400" />
          <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
            My Pod
          </h1>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Pods are part of Accelerator membership
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-300">
                Pods are small accountability groups with a dedicated coach and a shared roster of
                peers. Upgrade to Accelerator to unlock pod placement and support.
              </p>
            </section>

            <section className="grid gap-6">
              <MembershipPlanCard tier="ACCELERATOR" highlight />
            </section>
          </div>
        </main>
      </div>
    );
  }

  const pod = await getUserPod(session.user.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Users className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">My Pod</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          {pod ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {formatStatus(pod.status)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        {pod.members.length}/{pod.capacity} members
                      </span>
                    </div>
                    <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
                      {pod.name}
                    </h2>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
                      Your pod is where you stay accountable, compare notes, and get direct
                      support as you build.
                    </p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                    <Sparkles className="h-5 w-5" />
                  </div>
                </div>
              </section>

              <CoachCard coach={pod.coach} />

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Roster</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                      {pod.members.length} of {pod.capacity} seats filled.
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                </div>

                {pod.members.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
                      No roster yet
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
                      Members will appear here as soon as your pod is fully assigned.
                    </p>
                  </div>
                ) : (
                  <div className="mt-6 grid gap-3">
                    {pod.members.map((member, index) => (
                      <MemberRow key={member.user.id} member={member} index={index} />
                    ))}
                  </div>
                )}
              </section>

              <PodChatSection podId={pod.id} podSlug={pod.slug} userId={session.user.id} />
            </>
          ) : (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <Users className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
              <h2 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
                You&apos;ll be placed in a pod soon
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-300">
                Pod assignments happen in batches. Once your group is ready, your coach and roster
                will show up here automatically.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
