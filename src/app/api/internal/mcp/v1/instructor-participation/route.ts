// GET  /api/internal/mcp/v1/instructor-participation?cohortId=…
//   Participation rollup: tracked cohorts × instructors × status × session availability.
// POST /api/internal/mcp/v1/instructor-participation
//   { action: "sync" | "draft" | "approve" | "send" | "nudge", cohortId?, outreachId?, subject?, body?, only?, force? }
//
// Token-guarded like every /mcp/v1 route; all writes sit behind mcpWritesEnabled().
// The human approval gate lives in hub-mcp's dryRun→previewId→confirm flow — by the
// time "approve"/"send" reaches this route, the operator has confirmed the preview.

import prisma from "@/lib/prisma";
import {
  boundedParam,
  MCP_DETAIL_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";
import { logger } from "@/lib/logger";
import { getParticipationStatus, syncCohortInstructors } from "@/lib/instructorParticipation";
import { sendOutreach, renderInstructorEmail } from "@/lib/instructorOutreach";
import {
  proposeSchedule,
  unassignSession,
  listChangeRequests,
  acceptChangeRequest,
  counterAssignment,
  confirmAssignment,
  getInstructorSchedule,
} from "@/lib/instructorSchedule";
import { syncCohortSessionToGcal } from "@/lib/googleCalendar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const cohortId = boundedParam(url, "cohortId", 128);

  try {
    const cohorts = await getParticipationStatus(cohortId ?? undefined);
    // Response tokens are capability URLs — only expose them via admin UI, not MCP reads.
    const items = cohorts.map((c) => ({
      ...c,
      instructors: c.instructors.map(({ responseToken: _t, ...i }) => i),
    }));
    const outreaches = await prisma.instructorOutreach.findMany({
      where: cohortId ? { cohortId } : { cohort: { status: { in: ["ENROLLMENT", "IN_PROGRESS"] } } },
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
    const changeRequests = await listChangeRequests();
    return mcpJsonLimited({ items, outreaches, changeRequests }, MCP_DETAIL_MAX_BYTES);
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(`[mcp:${correlationId}] instructor-participation GET failed`);
    return mcpJson({ error: "Participation query failed", correlationId }, 500);
  }
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;
  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return mcpError("Invalid JSON body", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const cohortId = typeof body.cohortId === "string" ? body.cohortId : undefined;
  const outreachId = typeof body.outreachId === "string" ? body.outreachId : undefined;

  try {
    switch (action) {
      case "sync": {
        if (!cohortId) return mcpError("cohortId required", 400);
        await syncCohortInstructors(cohortId);
        const count = await prisma.cohortInstructor.count({ where: { cohortId } });
        return mcpJson({ ok: true, cohortId, instructorRecords: count });
      }

      case "draft": {
        if (!cohortId) return mcpError("cohortId required", 400);
        const subject = typeof body.subject === "string" ? body.subject.trim() : "";
        const emailBody = typeof body.body === "string" ? body.body.trim() : "";
        if (!subject || !emailBody) return mcpError("subject and body required", 400);
        const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true } });
        if (!cohort) return mcpError("Cohort not found", 404);
        const outreach = await prisma.instructorOutreach.create({
          data: { cohortId, subject, body: emailBody, createdBy: "mcp" },
        });
        return mcpJson({ ok: true, outreachId: outreach.id, status: outreach.status });
      }

      case "preview": {
        if (!outreachId) return mcpError("outreachId required", 400);
        const outreach = await prisma.instructorOutreach.findUnique({
          where: { id: outreachId },
          include: {
            cohort: {
              select: {
                title: true,
                startDate: true,
                endDate: true,
                sessions: {
                  orderBy: [{ date: "asc" }, { order: "asc" }],
                  select: { title: true, date: true, startTime: true, endTime: true, timezone: true },
                },
              },
            },
          },
        });
        if (!outreach) return mcpError("Outreach not found", 404);
        const records = await prisma.cohortInstructor.findMany({
          where: { cohortId: outreach.cohortId },
          include: {
            instructor: { select: { name: true, email: true } },
            assignments: {
              select: {
                session: {
                  select: { title: true, date: true, startTime: true, endTime: true, timezone: true },
                },
              },
            },
          },
        });
        const sample = records[0];
        // Render the sample against the SAME session-scoping rule sendOutreach
        // uses, or the preview an admin approves wouldn't be the email that goes out.
        const sampleSessions = sample?.assignments.length
          ? sample.assignments
              .map((a) => a.session)
              .sort((a, b) => a.date.getTime() - b.date.getTime())
          : outreach.cohort.sessions;
        const rendered = sample
          ? renderInstructorEmail(outreach, {
              instructorName: sample.instructor.name,
              instructorEmail: sample.instructor.email,
              cohortTitle: outreach.cohort.title,
              cohortStart: outreach.cohort.startDate,
              cohortEnd: outreach.cohort.endDate,
              sessions: sampleSessions,
              responseToken: "sample-token",
            })
          : null;
        return mcpJsonLimited(
          {
            outreachId,
            status: outreach.status,
            recipients: records.map((r) => ({
              email: r.instructor.email,
              status: r.status,
              // Surfacing the per-person session count makes a mis-scoped
              // proposal visible at approval time rather than in someone's inbox.
              assignedSessions: r.assignments.length,
            })),
            sampleFor: sample?.instructor.email ?? null,
            sampleSubject: rendered?.subject ?? null,
            sampleHtml: rendered?.html ?? null,
          },
          MCP_DETAIL_MAX_BYTES
        );
      }

      case "approve": {
        if (!outreachId) return mcpError("outreachId required", 400);
        await prisma.instructorOutreach.update({
          where: { id: outreachId },
          data: { status: "APPROVED", approvedAt: new Date() },
        });
        return mcpJson({ ok: true, outreachId, status: "APPROVED" });
      }

      case "send": {
        if (!outreachId) return mcpError("outreachId required", 400);
        const only = Array.isArray(body.only)
          ? (body.only as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined;
        const result = await sendOutreach(outreachId, { only, force: body.force === true });
        return mcpJson({ ok: true, outreachId, result });
      }

      case "nudge": {
        if (!cohortId) return mcpError("cohortId required", 400);
        const outreach = await prisma.instructorOutreach.findFirst({
          where: { cohortId, status: { in: ["APPROVED", "SENT"] } },
          orderBy: { createdAt: "desc" },
        });
        if (!outreach) return mcpError("No approved outreach for this cohort", 400);
        const pending = await prisma.cohortInstructor.findMany({
          where: { cohortId, status: "PENDING" },
          select: { id: true },
        });
        if (!pending.length) return mcpJson({ ok: true, nudged: 0, note: "Nobody is pending" });
        const result = await sendOutreach(outreach.id, { only: pending.map((p) => p.id) });
        return mcpJson({ ok: true, outreachId: outreach.id, result });
      }

      // ── v2: per-session schedule negotiation ───────────────────────
      case "propose": {
        if (!cohortId) return mcpError("cohortId required", 400);
        const instructorIds = Array.isArray(body.instructorIds)
          ? (body.instructorIds as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined;
        // Scope to the sessions this person actually teaches. Omit for the
        // whole-cohort case.
        const sessionIds = Array.isArray(body.sessionIds)
          ? (body.sessionIds as unknown[]).filter((v): v is string => typeof v === "string")
          : undefined;
        const result = await proposeSchedule(cohortId, instructorIds, sessionIds);
        if (result.unknownSessionIds.length) {
          return mcpError(
            `sessionIds not in cohort ${cohortId}: ${result.unknownSessionIds.join(", ")}`,
            400
          );
        }
        return mcpJson({ ok: true, cohortId, ...result });
      }

      case "unassign": {
        const cohortInstructorId =
          typeof body.cohortInstructorId === "string" ? body.cohortInstructorId : "";
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        if (!cohortInstructorId || !sessionId) {
          return mcpError("cohortInstructorId and sessionId required", 400);
        }
        const result = await unassignSession(cohortInstructorId, sessionId);
        if (!result.ok) return mcpError(result.error ?? "Unassign failed", 400);
        return mcpJson({ ok: true, cohortInstructorId, sessionId });
      }

      case "list_changes": {
        return mcpJsonLimited({ changeRequests: await listChangeRequests() }, MCP_DETAIL_MAX_BYTES);
      }

      case "respond_change": {
        const assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : "";
        if (!assignmentId) return mcpError("assignmentId required", 400);
        const decision = typeof body.decision === "string" ? body.decision : "";
        if (decision === "accept") {
          const result = await acceptChangeRequest(assignmentId);
          return result.ok ? mcpJson({ ok: true, assignmentId }) : mcpError(result.error ?? "Failed", 400);
        }
        if (decision === "counter") {
          const adminNote = typeof body.adminNote === "string" ? body.adminNote : "";
          if (!adminNote.trim()) return mcpError("adminNote required when countering", 400);
          await counterAssignment(assignmentId, adminNote);
          return mcpJson({ ok: true, assignmentId, status: "PROPOSED" });
        }
        if (decision === "confirm") {
          const result = await confirmAssignment(assignmentId);
          return result.ok ? mcpJson({ ok: true, assignmentId, gcal: result.gcal }) : mcpError("Assignment not found", 404);
        }
        return mcpError("decision must be accept, counter, or confirm", 400);
      }

      case "gcal_sync": {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        if (sessionId) {
          const result = await syncCohortSessionToGcal(sessionId);
          return mcpJson({ ok: result.outcome !== "failed", ...result });
        }
        if (!cohortId) return mcpError("sessionId or cohortId required", 400);
        const sessions = await prisma.cohortSession.findMany({
          where: { cohortId, assignments: { some: { status: "CONFIRMED" } } },
          select: { id: true },
        });
        const outcomes: Record<string, string> = {};
        for (const s of sessions) {
          outcomes[s.id] = (await syncCohortSessionToGcal(s.id)).outcome;
        }
        return mcpJson({ ok: true, cohortId, synced: sessions.length, outcomes });
      }

      case "schedule": {
        const instructorId = typeof body.instructorId === "string" ? body.instructorId : "";
        if (!instructorId) return mcpError("instructorId required", 400);
        const view = await getInstructorSchedule({ userId: instructorId });
        if (!view) return mcpError("Instructor not found", 404);
        // The schedule token is a capability URL — never hand it to MCP callers.
        const { scheduleToken: _t, ...instructor } = view.instructor;
        return mcpJsonLimited({ ...view, instructor }, MCP_DETAIL_MAX_BYTES);
      }

      default:
        return mcpError(
          "action must be one of: sync, draft, preview, approve, send, nudge, propose, unassign, list_changes, respond_change, gcal_sync, schedule",
          400
        );
    }
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] instructor-participation ${action} failed (${error instanceof Error ? error.message : "unknown"})`
    );
    return mcpJson({ error: `Action ${action} failed`, correlationId }, 500);
  }
}
