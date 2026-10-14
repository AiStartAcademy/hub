"use server";

// Server action behind the tokenized public instructor-response page.
// The responseToken is the only auth: unguessable (cuid), scoped to one
// cohort×instructor record, and it can only write that record's own
// confirmation state — same trust model as Contact.unsubscribeToken.

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const STATUSES = new Set(["CONFIRMED", "DECLINED"]);
const AVAILABILITIES = new Set(["AVAILABLE", "UNAVAILABLE", "TENTATIVE", "UNKNOWN"]);

export type InstructorResponseInput = {
  token: string;
  status: string; // CONFIRMED | DECLINED
  notes?: string;
  sessionResponses?: { sessionId: string; availability: string; note?: string }[];
};

export async function submitInstructorResponse(input: InstructorResponseInput) {
  const token = typeof input.token === "string" ? input.token : "";
  const record = await prisma.cohortInstructor.findUnique({
    where: { responseToken: token },
    select: { id: true, cohortId: true },
  });
  if (!record) return { ok: false as const, error: "Invalid link" };
  if (!STATUSES.has(input.status)) return { ok: false as const, error: "Invalid status" };

  const validSessions = await prisma.cohortSession.findMany({
    where: { cohortId: record.cohortId },
    select: { id: true },
  });
  const validSessionIds = new Set(validSessions.map((s) => s.id));

  await prisma.cohortInstructor.update({
    where: { id: record.id },
    data: {
      status: input.status,
      respondedAt: new Date(),
      notes: (input.notes ?? "").slice(0, 2000) || null,
    },
  });

  for (const sr of input.sessionResponses ?? []) {
    if (!validSessionIds.has(sr.sessionId) || !AVAILABILITIES.has(sr.availability)) continue;
    await prisma.cohortSessionInstructorResponse.upsert({
      where: { cohortInstructorId_sessionId: { cohortInstructorId: record.id, sessionId: sr.sessionId } },
      create: {
        cohortInstructorId: record.id,
        sessionId: sr.sessionId,
        availability: sr.availability,
        note: (sr.note ?? "").slice(0, 1000) || null,
      },
      update: {
        availability: sr.availability,
        note: (sr.note ?? "").slice(0, 1000) || null,
      },
    });
  }

  revalidatePath(`/instructor-response/${token}`);
  return { ok: true as const };
}
