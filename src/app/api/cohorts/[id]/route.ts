import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uniqueCohortSlug } from "@/lib/slug";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { buildProgramsRelation, resolveRawProgramUpdate } from "@/lib/cohortRawProgram";
import { parseMemberEventType } from "@/lib/memberEvents";

const PUBLIC_STATUSES = ["ENROLLMENT", "IN_PROGRESS", "COMPLETE"];
type SessionUser = { id?: string; role?: string };

// GET /api/cohorts/[id]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;
  const userId = sessionUser?.id;
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

  try {
    const { id } = await params;
    // `id` may be a cuid or a clean-URL slug — resolve either.
    const cohort = await prisma.cohort.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      include: {
        groups: {
          orderBy: { createdAt: "asc" },
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                    role: true,
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
            _count: { select: { members: true } },
          },
        },
        sessions: { orderBy: { order: "asc" }, include: { linkedSession: { select: { cohort: { select: { id: true, title: true } } } } } },
        instructors: {
          select: {
             id: true,
             name: true,
             email: true,
             image: true,
             role: true,
             bio: true,
          }
        },
        programs: {
          include: {
            modules: {
              orderBy: { order: "asc" },
              include: {
                lessons: { orderBy: { order: "asc" }, select: { id: true, name: true, type: true, duration: true, order: true } },
                assessments: { orderBy: { order: "asc" }, select: { id: true, name: true, order: true } },
              }
            }
          }
        },
        enrollments: {
          select: { userId: true }
        },
        // Materials:
        materials: { 
          orderBy: { order: "asc" } 
        },
        // ==========================
        learningPaths: {
          orderBy: { order: "asc" },
          include: {
            items: {
              orderBy: { order: "asc" },
              include: {
                lesson: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    duration: true,
                    module: {
                      select: { id: true, programId: true }
                    }
                  }
                }
              }
            }
          }
        },
      },
    });

    if (!cohort) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Check if the current user is enrolled (via group membership or an
    // enrollment record). Guests and non-enrolled students receive a deliberately
    // restricted public response below; the full workspace shape contains PII and
    // private learning/material URLs.
    const isEnrolled = userId
      ? cohort.groups.some((g) => g.members.some((m) => m.userId === userId)) ||
        cohort.enrollments.some((e) => e.userId === userId)
      : false;

    // Access control for non-managers
    if (!canManage) {
      const isPubliclyVisible = PUBLIC_STATUSES.includes(cohort.status);

      // Enrolled students can access cohort regardless of status (COMPLETE, ARCHIVED, etc.)
      if (!isPubliclyVisible && !isEnrolled) {
        return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
      }
    }

    // Calculate totalMembers and seats from all groups
    const totalMembers = cohort.groups.reduce(
      (sum, group) => sum + group.members.length,
      0
    );
    const seats = cohort.groups.reduce(
      (sum, group) => sum + group.seats,
      0
    );

    // Fetch user progress (completed lessons and assessments)
    let completedLessonIds: string[] = [];
    let completedAssessmentIds: string[] = [];

    if (userId) {
      try {
        // Get completed lessons for this cohort using raw SQL
        const lessonProgressRows = await prisma.$queryRaw<{ lessonId: string }[]>`
          SELECT DISTINCT "lessonId" FROM "LessonProgress"
          WHERE "userId" = ${userId} AND "cohortId" = ${cohort.id}
        `;
        completedLessonIds = lessonProgressRows.map(row => row.lessonId);
      } catch (err) {
        console.warn("Failed to fetch lesson progress:", err);
      }

      try {
        // Get completed assessments for this cohort
        const assessmentSubmissions = await prisma.assessmentSubmission.findMany({
          where: {
            userId,
            cohortId: cohort.id
          },
          select: { assessmentId: true },
          distinct: ["assessmentId"]
        });
        completedAssessmentIds = assessmentSubmissions.map(as => as.assessmentId);
      } catch (err) {
        console.warn("Failed to fetch assessment submissions:", err);
      }
    }

    const response = {
      ...cohort,
      totalMembers,
      seats,
      completedLessonIds,
      completedAssessmentIds
    };

    if (canManage || isEnrolled) {
      return NextResponse.json(response);
    }

    // Public response: keep the fields needed by the marketing/detail UI, but
    // never expose student identities, private meeting/recording links, course
    // materials, internal learning paths, or enrollment identifiers.
    return NextResponse.json({
      ...response,
      zoomLink: null,
      zoomMeetingId: null,
      rawProgramId: null,
      rocketchatGroupId: null,
      groups: cohort.groups.map((group) => ({
        ...group,
        members: [],
      })),
      sessions: cohort.sessions.map((cohortSession) => ({
        ...cohortSession,
        meetingLink: null,
        recordingLink: null,
        zoomOccurrenceId: null,
        linkedSessionId: null,
        linkedSession: null,
      })),
      instructors: cohort.instructors.map((instructor) => ({
        id: instructor.id,
        name: instructor.name,
        image: instructor.image,
        bio: instructor.bio,
        email: "",
        role: "INSTRUCTOR",
      })),
      enrollments: [],
      programs: [],
      materials: [],
      learningPaths: [],
      completedLessonIds: [],
      completedAssessmentIds: [],
    });
  } catch (error) {
    logger.error({ err: error }, "Fetch cohort error:");
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Something went wrong", details: errorMessage }, { status: 500 });
  }
}

// PUT /api/cohorts/[id]
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionUser = session.user as SessionUser;
  const userId = sessionUser.id;

  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;

    // Check if instructor is assigned to this cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const cohort = await prisma.cohort.findUnique({
        where: { id },
        include: { instructors: { select: { id: true } } },
      });

      if (!cohort) {
        return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
      }

      const isAssigned = cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }
    const body = await req.json();
    const {
      title,
      description,
      cover,
      status,
      deliveryMode,
      location,
      zoomLink,
      startDate,
      endDate,
      startTime,
      endTime,
      timezone,
      tools,
      certificate,
      leadMagnet,
      leadMagnetCta,
      memberEventType,
      programIds,
    } = body;

    const mirrored = parseMemberEventType(memberEventType);
    if (!mirrored.ok) {
      return NextResponse.json(
        { error: "memberEventType must be WEEKLY_QA, COACHING, DEAL_DESK, BUILD_SPRINT or null" },
        { status: 400 }
      );
    }
    const rawProgram = await resolveRawProgramUpdate(prisma, {
      cohortId: id,
      input: body.rawProgramId,
      user: session.user,
    });
    if (!rawProgram.ok) {
      return NextResponse.json({ error: rawProgram.error }, { status: rawProgram.status });
    }
    const programsRelation = buildProgramsRelation(programIds, rawProgram.connectProgramId);

    // Slug: set explicitly when provided; otherwise backfill once if missing.
    // Kept stable across ordinary title edits so existing public URLs don't break.
    const current = await prisma.cohort.findUnique({
      where: { id },
      select: { slug: true, title: true },
    });
    const slugData =
      body.slug !== undefined && body.slug !== null && String(body.slug).trim()
        ? { slug: await uniqueCohortSlug(String(body.slug), id) }
        : !current?.slug
          ? { slug: await uniqueCohortSlug((title ?? current?.title ?? "cohort").trim() || "cohort", id) }
          : {};

    const cohort = await prisma.cohort.update({
      where: { id },
      data: {
        ...slugData,
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(description !== undefined ? {
          description: description?.trim() || null,
        } : {}),
        ...(cover !== undefined ? { cover: cover?.trim() || null } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(deliveryMode !== undefined ? { deliveryMode } : {}),
        ...(location !== undefined ? { location: location?.trim() || null } : {}),
        ...(zoomLink !== undefined ? { zoomLink: zoomLink?.trim() || null } : {}),
        ...(startDate !== undefined ? {
          startDate: startDate ? new Date(startDate) : null,
        } : {}),
        ...(endDate !== undefined ? {
          endDate: endDate ? new Date(endDate) : null,
        } : {}),
        ...(startTime !== undefined ? { startTime: startTime?.trim() || null } : {}),
        ...(endTime !== undefined ? { endTime: endTime?.trim() || null } : {}),
        ...(timezone !== undefined ? { timezone: timezone?.trim() || "PT" } : {}),
        ...(tools !== undefined ? { tools: tools?.trim() || null } : {}),
        ...(certificate !== undefined ? { certificate: Boolean(certificate) } : {}),
        ...(leadMagnet !== undefined ? { leadMagnet: Boolean(leadMagnet) } : {}),
        ...(leadMagnetCta !== undefined ? { leadMagnetCta: leadMagnetCta?.trim() || null } : {}),
        ...(rawProgram.rawProgramId !== undefined ? { rawProgramId: rawProgram.rawProgramId } : {}),
        ...(programsRelation ? { programs: programsRelation } : {}),
        ...(mirrored.value !== undefined ? { memberEventType: mirrored.value } : {}),
      },
    });

    return NextResponse.json(cohort);
  } catch (error) {
    // Lost race on the unique rawProgramId after the pre-check: report as a conflict.
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "That program is already the raw recordings program of another cohort" },
        { status: 409 }
      );
    }
    logger.error({ err: error }, "Update cohort error:");
    return NextResponse.json(
      { error: "Failed to update cohort" },
      { status: 500 }
    );
  }
}

// PATCH /api/cohorts/[id] — same partial-update semantics as PUT (fields left out are untouched).
export const PATCH = PUT;

// DELETE /api/cohorts/[id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }


  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only ADMIN and TEAM_MEMBER can delete cohorts, not INSTRUCTOR
  if (!hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    return NextResponse.json({ error: "Only admins can delete cohorts" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const deleteRaw = url.searchParams.get("deleteRaw") === "true";

    const cohort = await prisma.cohort.findUnique({
      where: { id },
      select: { rawProgramId: true }
    });

    if (!cohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }

    if (deleteRaw && cohort.rawProgramId) {
      // Delete both records in one transaction (Program modules cascade via onDelete: Cascade in the Prisma schema)
      await prisma.$transaction([
        prisma.cohort.delete({ where: { id } }),
        prisma.program.delete({ where: { id: cohort.rawProgramId } })
      ]);
      logger.info(`[COHORTS] Deleted cohort ${id} and its raw course`);
    } else {
      await prisma.cohort.delete({ where: { id } });
      logger.info(`[COHORTS] Deleted cohort ${id}; raw course retained`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Delete cohort error:");
    return NextResponse.json(
      { error: "Failed to delete cohort" },
      { status: 500 }
    );
  }
}
