import { PhoneCall } from "lucide-react";
import { redirect } from "next/navigation";

import { MobileMenuButton } from "@/components/MobileMenuButton";
import { CRM_STAFF_ROLES } from "@/lib/adminGuard";
import { auth } from "@/lib/auth";
import {
  parseRingStrategy,
  parseRouteChain,
  validateRoutingNumbers,
} from "@/lib/calls/inboundRouting";
import prisma from "@/lib/prisma";
import { getRoles, hasAnyRole, hasRole } from "@/lib/roles";
import { getSecret } from "@/lib/secrets";
import CallTeamClient, { type CallTeamMember } from "./CallTeamClient";
import RoutingChainEditor from "./RoutingChainEditor";

export const metadata = { title: "Call Team | Admin" };
export const dynamic = "force-dynamic";

const RECENT_CALL_WINDOW_DAYS = 30;

function recentCallCutoff(): Date {
  return new Date(Date.now() - RECENT_CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export default async function CallTeamPage() {
  const session = await auth();
  if (!session || !hasRole(session.user, "ADMIN")) {
    redirect("/dashboard");
  }

  // SQLite cannot query JSON-array membership exactly. Match the legacy role
  // and rough JSON candidates, then use the shared role helper for exactness.
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: [...CRM_STAFF_ROLES] } },
        ...CRM_STAFF_ROLES.map((role) => ({ roles: { contains: role } })),
      ],
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
      isAvailableForCalls: true,
    },
  });
  const callTeam = candidates.filter((user) => hasAnyRole(user, CRM_STAFF_ROLES));
  const userIds = callTeam.map((user) => user.id);
  const recentCallGroups = userIds.length === 0
    ? []
    : await prisma.contactCall.groupBy({
        by: ["authorId"],
        where: {
          authorId: { in: userIds },
          createdAt: { gte: recentCallCutoff() },
        },
        _count: true,
      });
  const recentCallCounts = new Map(
    recentCallGroups.map((group) => [group.authorId, group._count]),
  );
  const members: CallTeamMember[] = callTeam.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    roles: getRoles(user),
    isAvailableForCalls: user.isAvailableForCalls,
    recentCallCount: recentCallCounts.get(user.id) ?? 0,
  }));
  const [routeChainValue, ringStrategyValue, forwardNumber, vapiNumber, twilioNumber] =
    await Promise.all([
      getSecret("INBOUND_ROUTE_CHAIN"),
      getSecret("CLOSER_RING_STRATEGY"),
      getSecret("INBOUND_FORWARD_NUMBER"),
      getSecret("VAPI_INBOUND_NUMBER"),
      getSecret("TWILIO_PHONE_NUMBER"),
    ]);
  const routingNumbers = validateRoutingNumbers({
    twilioNumber,
    forwardNumber,
    vapiNumber,
  });
  const forwardLoopWarning = routingNumbers.errors.some((message) =>
    message.includes("INBOUND_FORWARD_NUMBER must not match TWILIO_PHONE_NUMBER"),
  );
  const vapiLoopWarning = routingNumbers.errors.some((message) =>
    message.includes("VAPI_INBOUND_NUMBER must not match TWILIO_PHONE_NUMBER"),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <PhoneCall className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <div>
          <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
            Call Team
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
            Manage who receives browser softphone calls
          </p>
        </div>
        <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline-block dark:border-slate-700 dark:bg-slate-800">
          {members.length} members
        </span>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <RoutingChainEditor
            initialSteps={parseRouteChain(routeChainValue)}
            initialRingStrategy={parseRingStrategy(ringStrategyValue)}
            hasVapiNumber={Boolean(vapiNumber?.trim())}
            hasForwardNumber={Boolean(forwardNumber?.trim())}
            vapiLoopWarning={vapiLoopWarning}
            forwardLoopWarning={forwardLoopWarning}
          />
          <CallTeamClient members={members} />
        </div>
      </main>
    </div>
  );
}
