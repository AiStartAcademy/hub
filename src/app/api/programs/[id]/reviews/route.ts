import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: programId } = await params;

    // Fetch all reviews for the program with user info
    const reviews = await prisma.courseReview.findMany({
      where: { programId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate average rating
    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum: number, r) => sum + r.rating, 0) / reviews.length
        : 0;

    return NextResponse.json({
      reviews: reviews.map((r) => ({
        id: r.id,
        userId: r.userId,
        rating: r.rating,
        text: r.text,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        user: r.user,
      })),
      averageRating: Number(avgRating.toFixed(1)),
      count: reviews.length,
    });
  } catch (error) {
    logger.error({ err: error }, "GET /api/programs/[id]/reviews error:");
    return NextResponse.json(
      { error: "Failed to fetch reviews" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: programId } = await params;
    const user = session.user as { id: string; role?: string };
    const userId = user.id;
    const userRole = user.role;
    const { rating, text } = await req.json();

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    // Check if program exists
    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        modules: {
          include: {
            lessons: true,
            assessments: true,
          },
        },
      },
    });

    if (!program) {
      return NextResponse.json(
        { error: "Program not found" },
        { status: 404 }
      );
    }

    const isStaff = userRole === "ADMIN" || userRole === "TEAM_MEMBER" || userRole === "INSTRUCTOR";

    if (!isStaff) {
      // Get all cohort IDs for this user + program
      const enrollments = await prisma.enrollment.findMany({
        where: {
          userId,
          cohort: {
            programs: {
              some: {
                id: programId,
              }
            }
          },
          status: "active",
        },
        select: { cohortId: true },
      });

      if (enrollments.length === 0) {
        return NextResponse.json(
          { error: "Not enrolled in any cohort for this program" },
          { status: 403 }
        );
      }

      const cohortIds = enrollments.map((e) => e.cohortId);

      // Count total lessons + assessments
      const totalLessons = program.modules.reduce(
        (sum, m) => sum + m.lessons.length,
        0
      );
      const totalAssessments = program.modules.reduce(
        (sum, m) => sum + m.assessments.length,
        0
      );
      const totalItems = totalLessons + totalAssessments;

      if (totalItems === 0) {
        return NextResponse.json(
          { error: "Program has no lessons or assessments" },
          { status: 400 }
        );
      }

      // Count completed items across all cohorts
      const completedLessons = await prisma.lessonProgress.findMany({
        where: {
          userId,
          cohortId: { in: cohortIds },
        },
        select: { lessonId: true },
        distinct: ["lessonId"],
      });

      const completedAssessments = await prisma.assessmentSubmission.findMany({
        where: {
          userId,
          cohortId: { in: cohortIds },
        },
        select: { assessmentId: true },
        distinct: ["assessmentId"],
      });

      const completedItems =
        completedLessons.length + completedAssessments.length;
      const progress = (completedItems / totalItems) * 100;

      if (progress < 90) {
        return NextResponse.json(
          {
            error: "You must complete at least 90% of the course to leave a review",
            progress,
          },
          { status: 403 }
        );
      }
    }

    // Check if user already has a review
    const existingReview = await prisma.courseReview.findUnique({
      where: {
        userId_programId: { userId, programId },
      },
    });

    let review;
    if (existingReview) {
      // Update existing review
      review = await prisma.courseReview.update({
        where: { id: existingReview.id },
        data: {
          rating,
          text: text || null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              email: true,
            },
          },
        },
      });
    } else {
      // Create new review
      review = await prisma.courseReview.create({
        data: {
          userId,
          programId,
          rating,
          text: text || null,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              email: true,
            },
          },
        },
      });
    }

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "POST /api/programs/[id]/reviews error:");
    return NextResponse.json(
      { error: "Failed to create review" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: programId } = await params;
    const userId = (session.user as unknown as { id: string }).id;
    const { rating, text } = await req.json();

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    // Find and verify ownership
    const review = await prisma.courseReview.findUnique({
      where: {
        userId_programId: { userId, programId },
      },
    });

    if (!review) {
      return NextResponse.json(
        { error: "Review not found" },
        { status: 404 }
      );
    }

    // Update review
    const updatedReview = await prisma.courseReview.update({
      where: { id: review.id },
      data: {
        rating,
        text: text || null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(updatedReview);
  } catch (error) {
    logger.error({ err: error }, "PUT /api/programs/[id]/reviews error:");
    return NextResponse.json(
      { error: "Failed to update review" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: programId } = await params;
    const userId = (session.user as unknown as { id: string }).id;

    // Find and verify ownership
    const review = await prisma.courseReview.findUnique({
      where: {
        userId_programId: { userId, programId },
      },
    });

    if (!review) {
      return NextResponse.json(
        { error: "Review not found" },
        { status: 404 }
      );
    }

    // Delete review
    await prisma.courseReview.delete({
      where: { id: review.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "DELETE /api/programs/[id]/reviews error:");
    return NextResponse.json(
      { error: "Failed to delete review" },
      { status: 500 }
    );
  }
}
