import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function DELETE(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  try {
    const body = await req.json();
    const { confirmation } = body;

    // Require explicit confirmation string
    if (confirmation !== "DELETE MY ACCOUNT") {
      return NextResponse.json(
        { error: 'Please type "DELETE MY ACCOUNT" to confirm.' },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, roles: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent admin self-deletion if they are the last admin. Counts anyone
    // holding ADMIN as a primary OR secondary role — a plain `role: "ADMIN"`
    // count would miss multi-role admins and could under-count.
    if (hasRole(user, "ADMIN")) {
      const adminCandidates = await prisma.user.findMany({
        where: { OR: [{ role: "ADMIN" }, { roles: { contains: '"ADMIN"' } }] },
        select: { role: true, roles: true },
      });
      const adminCount = adminCandidates.filter((u) => hasRole(u, "ADMIN")).length;
      if (adminCount <= 1) {
        return NextResponse.json(
          {
            error:
              "Cannot delete the last admin account. Please assign another admin first.",
          },
          { status: 403 }
        );
      }
    }

    // Delete the user — Prisma cascades will handle related records:
    //   - Account (onDelete: Cascade)
    //   - Session (onDelete: Cascade)
    //   - Enrollment (onDelete: Cascade)
    //   - GroupMember (onDelete: Cascade)
    //   - AssessmentSubmission (onDelete: Cascade)
    //     - AssessmentAnswer (onDelete: Cascade)
    //       - SelectedOption (onDelete: Cascade)
    //
    // Relations NOT cascaded (kept for data integrity):
    //   - Cohort instructors (many-to-many, user is just removed)
    //   - OnboardingResponse (no userId field, safe)

    // First, remove user from cohort instructor assignments (implicit m2m)
    const taughtCohorts = await prisma.cohort.findMany({
      where: { instructors: { some: { id: userId } } },
      select: { id: true },
    });

    for (const cohort of taughtCohorts) {
      await prisma.cohort.update({
        where: { id: cohort.id },
        data: {
          instructors: {
            disconnect: { id: userId },
          },
        },
      });
    }

    // Delete the user (cascades handle the rest)
    await prisma.user.delete({
      where: { id: userId },
    });

    return NextResponse.json({
      success: true,
      message: "Your account and all associated data have been permanently deleted.",
    });
  } catch (error) {
    logger.error({ err: error }, "Account deletion error:");
    return NextResponse.json(
      { error: "Failed to delete account. Please try again or contact support." },
      { status: 500 }
    );
  }
}
