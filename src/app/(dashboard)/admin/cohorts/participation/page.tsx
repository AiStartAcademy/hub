// src/app/(dashboard)/admin/cohorts/participation/page.tsx
// Instructor participation overview: every tracked (ENROLLMENT | IN_PROGRESS)
// cohort × its instructors × confirmation status × per-session availability,
// with the outreach workflow (draft → approve → send → nudge) inline.

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { hasAnyRole } from "@/lib/roles";
import { getParticipationStatus } from "@/lib/instructorParticipation";
import { listChangeRequests } from "@/lib/instructorSchedule";
import ParticipationClient from "./ParticipationClient";
import NegotiationInbox from "./NegotiationInbox";

export const metadata = { title: "Instructor Participation | Admin" };
export const dynamic = "force-dynamic";

export default async function ParticipationPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  const cohorts = await getParticipationStatus();
  const outreaches = await prisma.instructorOutreach.findMany({
    where: { cohortId: { in: cohorts.map((c) => c.cohortId) } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cohortId: true,
      subject: true,
      status: true,
      approvedAt: true,
      sentAt: true,
      createdAt: true,
      _count: { select: { sends: true } },
    },
  });

  // Unconfirmed-first ordering: the cohorts that need attention float to the top.
  const sorted = [...cohorts].sort((a, b) => b.unconfirmedCount - a.unconfirmedCount);

  const changeRequests = await listChangeRequests();

  return (
    <>
    <NegotiationInbox requests={changeRequests} />
    <ParticipationClient
      cohorts={sorted.map((c) => ({
        ...c,
        startDate: c.startDate?.toISOString() ?? null,
        endDate: c.endDate?.toISOString() ?? null,
        sessions: c.sessions.map((s) => ({ ...s, date: s.date.toISOString() })),
        instructors: c.instructors.map((i) => ({
          ...i,
          invitedAt: i.invitedAt?.toISOString() ?? null,
          respondedAt: i.respondedAt?.toISOString() ?? null,
          sessionResponses: i.sessionResponses.map((s) => ({
            ...s,
            date: s.date.toISOString(),
          })),
        })),
      }))}
      outreaches={outreaches.map((o) => ({
        id: o.id,
        cohortId: o.cohortId,
        subject: o.subject,
        status: o.status,
        approvedAt: o.approvedAt?.toISOString() ?? null,
        sentAt: o.sentAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
        sendCount: o._count.sends,
      }))}
    />
    </>
  );
}
