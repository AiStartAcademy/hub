import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { LearningPathForm } from "@/components/admin/LearningPathForm";
import { LearningPathItemsManager } from "@/components/admin/LearningPathItemsManager";
import { hasAnyRole } from "@/lib/roles";
import { canSendCohortMessages } from "@/lib/cohortMessages/actionGuard";

export const metadata = {
  title: "Manage Learning Paths",
};

export default async function CohortLearningPathsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasAnyRole(session.user, ["ADMIN", "INSTRUCTOR"])) {
    redirect("/dashboard");
  }

  const resolvedParams = await params;
  const cohortId = resolvedParams.id;

  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      learningPaths: {
        orderBy: { order: "asc" },
        include: { _count: { select: { items: true } } },
      },
    },
  });

  if (!cohort) redirect("/admin/cohorts");

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Learning Paths</h1>
          {canSendCohortMessages(session.user) && (
            <Link
              href={`/admin/cohorts/${cohortId}/messages`}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Messages
            </Link>
          )}
        </div>
        <p className="text-gray-500">
          Manage custom lesson sequences for cohort: {cohort.title}
        </p>
      </div>

      {cohort.learningPaths.length > 0 && (
        <div className="space-y-6">
          {cohort.learningPaths.map((path) => (
            <div key={path.id} className="rounded-lg border bg-gray-50 p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{path.title}</h2>
                  {path.description && (
                    <p className="text-sm text-gray-600 mt-1">{path.description}</p>
                  )}
                </div>
                <div className="text-sm text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
                  {path._count.items} lessons
                </div>
              </div>

              <div className="mt-6 border-t pt-4">
                <h4 className="mb-4 text-sm font-semibold text-gray-700">Path Curriculum</h4>
                <LearningPathItemsManager pathId={path.id} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 border-t pt-8">
        <LearningPathForm cohortId={cohortId} />
      </div>
    </div>
  );
}
