// /api/me/export/route.ts

import { brand } from "@/config/brand";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  try {
    // Gather all user data across the entire schema
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: false, // Exclude base64 blob from JSON export for size
        role: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        certificates: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Enrollments
    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      select: {
        id: true,
        cohortId: true,
        source: true,
        status: true,
        createdAt: true,
        cohort: {
          select: { title: true },
        },
      },
    });

    // Group memberships
    const groupMembers = await prisma.groupMember.findMany({
      where: { userId },
      select: {
        id: true,
        groupId: true,
        createdAt: true,
        group: {
          select: {
            name: true,
            cohort: { select: { title: true } },
          },
        },
      },
    });

    // Assessment submissions
    const submissions = await prisma.assessmentSubmission.findMany({
      where: { userId },
      select: {
        id: true,
        assessmentId: true,
        cohortId: true,
        status: true,
        totalScore: true,
        createdAt: true,
        updatedAt: true,
        assessment: {
          select: { name: true },
        },
        cohort: {
          select: { title: true },
        },
        answers: {
          select: {
            id: true,
            itemId: true,
            textAnswer: true,
            points: true,
            item: {
              select: { questionText: true, type: true },
            },
            selectedOptions: {
              select: {
                option: {
                  select: { text: true },
                },
              },
            },
          },
        },
      },
    });

    // Sessions (auth sessions — metadata only)
    const sessions = await prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        expires: true,
      },
    });

    // Accounts (OAuth providers)
    const accounts = await prisma.account.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        type: true,
        scope: true,
        // Exclude sensitive tokens
      },
    });

    // Cohorts taught (for instructors)
    const taughtCohorts = await prisma.cohort.findMany({
      where: {
        instructors: { some: { id: userId } },
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    const exportData = {
      exportDate: new Date().toISOString(),
      exportVersion: "1.0",
      user,
      enrollments: enrollments.map((e) => ({
        ...e,
        cohortTitle: e.cohort.title,
        cohort: undefined,
      })),
      groupMemberships: groupMembers.map((g) => ({
        id: g.id,
        groupId: g.groupId,
        groupName: g.group.name,
        cohortTitle: g.group.cohort.title,
        createdAt: g.createdAt,
      })),
      assessmentSubmissions: submissions.map((s) => ({
        id: s.id,
        assessmentName: s.assessment.name,
        cohortTitle: s.cohort?.title ?? null,
        status: s.status,
        totalScore: s.totalScore,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        answers: s.answers.map((a) => ({
          id: a.id,
          question: a.item.questionText,
          type: a.item.type,
          textAnswer: a.textAnswer,
          points: a.points,
          selectedOptions: a.selectedOptions.map((o) => o.option.text),
        })),
      })),
      taughtCohorts,
      authSessions: sessions,
      connectedAccounts: accounts.map((a) => ({
        id: a.id,
        provider: a.provider,
        type: a.type,
      })),
    };

    // Return as downloadable JSON file
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${brand.ids.dataExportFilePrefix}-${user.id}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Data export error:");
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 }
    );
  }
}
