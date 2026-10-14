//  src/app/api/cohorts

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uniqueCohortSlug } from "@/lib/slug";
import type { Prisma } from "@/generated/client";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { parseMemberEventType } from "@/lib/memberEvents";

const GUEST_VISIBLE_STATUSES = ["ENROLLMENT", "IN_PROGRESS"];

// GET /api/cohorts — list cohorts (filtered by role)
export async function GET() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; role?: string } | undefined;
  const role = session?.user ? user?.role || "STUDENT" : "GUEST";
  //const userId = user?.id || null;
  const userId = session?.user ? (user?.id ?? null) : null;


  try {
    let where: Prisma.CohortWhereInput = {};

    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      if (hasRole(session?.user, "STUDENT") && userId) {
        // Students see cohorts that are either open to everyone (ENROLLMENT/IN_PROGRESS)
        // or that they are enrolled in (via enrollment or groups), in any status
        where = {
          OR: [
            { status: { in: GUEST_VISIBLE_STATUSES } },
            { enrollments: { some: { userId } } },
            { groups: { some: { members: { some: { userId } } } } }
          ]
        };
      } else {
        // Guests see active statuses only
        where = { status: { in: GUEST_VISIBLE_STATUSES } };
      }
    }

    const cohorts = await prisma.cohort.findMany({
      where,
      include: {
        groups: {
          select: {
            seats: true,
            _count: { select: { members: true } },
          },
        },
        _count: {
          select: {
            groups: true,
            sessions: true,
          },
        },
        instructors: {
          select: {
            id: true,
            name: true,
            image: true,
          }
        },
        programs: {
          select: {
            id: true,
            name: true,
          }
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get cohorts the current user is enrolled in (via Enrollment or GroupMember)
    const enrolledCohortIds = new Set<string>();
    if (userId) {
      const [enrollments, memberships] = await Promise.all([
        prisma.enrollment.findMany({ where: { userId }, select: { cohortId: true } }),
        prisma.groupMember.findMany({
          where: { userId },
          select: { group: { select: { cohortId: true } } },
        }),
      ]);
      enrollments.forEach((e) => enrolledCohortIds.add(e.cohortId));
      memberships.forEach((m) => enrolledCohortIds.add(m.group.cohortId));
    }

    // Live Zoom links are for managers only; the detail route already redacts
    // them, and this list used to hand them to any unauthenticated caller.
    const canSeeLinks = hasAnyRole(session?.user, MANAGE_ROLES);

    // Calculate totalMembers as sum of members across all groups
    const cohortsWithMembers = cohorts.map((cohort) => {
      const totalMembers = cohort.groups.reduce(
        (sum: number, g) => sum + g._count.members,
        0
      );
      const seats = cohort.groups.reduce(
        (sum: number, g) => sum + g.seats,
        0
      );
      const isEnrolled = enrolledCohortIds.has(cohort.id);
      // Remove the nested groups data, keep only _count
      const { groups, ...rest } = cohort;
      return {
        ...rest,
        ...(canSeeLinks ? {} : { zoomLink: null, zoomMeetingId: null }),
        totalMembers,
        seats,
        isEnrolled,
      };
    });

    return NextResponse.json(cohortsWithMembers);
  } catch (error) {
    logger.error({ err: error }, "Fetch cohorts error:");
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

// POST /api/cohorts — create cohort (TEAM_MEMBER, INSTRUCTOR, ADMIN only)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { email?: string; role?: string };
  const role = user.role || "STUDENT";
  
  //if (!MANAGE_ROLES.includes(role)) {

  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
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
      programId,
      programIds,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    const mirrored = parseMemberEventType(memberEventType);
    if (!mirrored.ok) {
      return NextResponse.json(
        { error: "memberEventType must be WEEKLY_QA, COACHING, DEAL_DESK, BUILD_SPRINT or null" },
        { status: 400 }
      );
    }

    const cohort = await prisma.$transaction(async (tx) => {
      const baseTitle = title.trim();
      
      // Create a slug-friendly string for the Cohort name (e.g. "Fall 24" -> "fall-24")
      const safeCohortName = baseTitle
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // 1. Create linked raw course with a default module
      const rawProgram = await tx.program.create({
        data: {
          name: `Recordings (${baseTitle})`,
          // If your Program Prisma schema requires a unique slug, uncomment the next line:
          // slug: `recordings-${safeCohortName}`,
          description: `Raw recordings for ${baseTitle}`,
          status: "raw",
          modules: {
            create: {
              name: "General",
              order: 0,
            }
          }
        },
      });

      // 2. Program IDs for the many-to-many link (regular courses + the raw course)
      const programsToConnect = Array.isArray(programIds) 
        ? programIds.map((id: string) => ({ id })) 
        : [];
      
      // Add the raw course
      programsToConnect.push({ id: rawProgram.id });

      // 3. Create the cohort and link the programs
      const slug = await uniqueCohortSlug(baseTitle);
      return tx.cohort.create({
        data: {
          title: title.trim(),
          slug,
          description: description?.trim() || null,
          cover: cover?.trim() || null,
          status: status || "DRAFT",
          deliveryMode: deliveryMode || "ONLINE",
          location: location?.trim() || null,
          zoomLink: zoomLink?.trim() || null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          startTime: startTime?.trim() || null,
          endTime: endTime?.trim() || null,
          timezone: timezone?.trim() || "PT",
          tools: tools?.trim() || null,
          certificate: certificate !== undefined ? Boolean(certificate) : true,
          leadMagnet: Boolean(leadMagnet),
          leadMagnetCta: leadMagnetCta?.trim() || null,
          memberEventType: mirrored.value ?? null,
          rawProgramId: rawProgram.id,
          programs: {
            connect: programsToConnect
          },
        },
      });
    });

    // Log the error
    logger.info(`[COHORTS] User ${user.email || 'unknown'} created cohort '${cohort.title}' with rawProgramId: ${cohort.rawProgramId}`);

    return NextResponse.json(cohort, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "Create cohort error:");
    return NextResponse.json(
      { error: "Failed to create cohort" },
      { status: 500 }
    );
  }
}
