// src/app/(dashboard)/courses[programId]/page.tsx

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, LayoutList, FileText, Clock, FileQuestion, PlayCircle, Lock, Edit3 } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { CourseOverviewCard } from "./components/CourseOverviewCard";
import Link from "next/link";
import { ModuleCreateButton } from "./components/ModuleCreateButton";
import { LessonCreateButton } from "./components/LessonCreateButton";
import { AssessmentCreateButton } from "./components/AssessmentCreateButton";
import { CourseEditButton } from "../components/CourseEditButton";
import { ModuleEditButton } from "./components/ModuleEditButton";
import { LessonEditButton } from "./components/LessonEditButton";
import { AssessmentEditButton } from "./components/AssessmentEditButton";
import { ShareButton } from "../components/ShareButton";
import { ReviewsSection } from "@/components/ReviewsSection";
import { checkProgramAccess, accessRouteFor } from "@/lib/programAccess";
import { AccessCta } from "./components/AccessCta";
import { ModuleAccordion } from './components/ModuleAccordion';
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { ProgramMaterials } from "./components/ProgramMaterials";

export default async function ProgramDetailPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const isGuest = !userId;
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      modules: {
        include: {
          lessons: { orderBy: { order: "asc" } },
        assessments: { 
          orderBy: { order: "asc" },
          include: {
            module: { select: { programId: true } }
          }
        },
        },
        orderBy: { order: "asc" },
      },
      materials: { orderBy: { order: "asc" } },
    },
  });

  if (!program) {
    notFound();
  }

  const programs = await prisma.program.findMany({
    where: { status: { not: "archived" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const isLocked = program.locked;

  // Check access using unified helper
  let hasAccess = canManage;
  if (!canManage) {
    const { hasAccess: access, needsConsent } = await checkProgramAccess(
      programId,
      userId
    );
    // Entitled but hasn't accepted the current policies — send them to sign rather than
    // rendering a "buy a seat" CTA at someone who already paid for one.
    if (needsConsent) {
      redirect(`/consent?next=${encodeURIComponent(`/courses/${programId}`)}`);
    }
    hasAccess = access;
  }

  // How this viewer would get access, if they don't have it. Keeps the CTA in
  // lockstep with what `enrollInProgram` will actually permit.
  const isSellable = program.priceCents != null && program.priceCents > 0;
  const accessRoute = accessRouteFor(program.accessMode, !isGuest, {
    sellable: isSellable,
  });

  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        {/* Left: mobile menu + breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          <MobileMenuButton />
          <Link href="/courses" className="hidden sm:block text-slate-500 hover:text-primary transition-colors flex-shrink-0 text-sm">
            Courses
          </Link>
          <ChevronRight className="hidden sm:block h-4 w-4 text-slate-300 flex-shrink-0" />
          <h1 className="text-sm sm:text-base md:text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight truncate">
            {program.name}
          </h1>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ShareButton programId={program.id} programName={program.name} />
          {!hasAccess && !isLocked && (
            <AccessCta
              route={accessRoute}
              programId={program.id}
              priceCents={program.priceCents}
            />
          )}
          {canManage && <CourseEditButton program={program as any} />}
          {canManage && <ModuleCreateButton program={program} />}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-5xl mx-auto space-y-8">
          <CourseOverviewCard
            name={program.name}
            description={program.description}
            status={program.status}
            isLocked={isLocked}
            moduleCount={program.modules.length}
          />

          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <LayoutList className="h-5 w-5 text-primary" />
              Course Modules
            </h2>

            {program.modules.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                <LayoutList className="h-12 w-12 mx-auto text-slate-200 dark:text-slate-800 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No modules yet</h3>
                <p className="text-slate-500">Add your first module to begin building the course.</p>
              </div>
            ) : (
              <ModuleAccordion
                modules={program.modules}
                programId={programId}
                hasAccess={hasAccess}
                canManage={canManage}
                programs={programs}
              />
            )}
          </div>

          {hasAccess && (
            <ProgramMaterials
              programId={programId}
              materials={program.materials}
              canManage={canManage}
            />
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md">
            <ReviewsSection programId={programId} currentUserId={userId} />
          </div>
        </div>
      </div>
    </div>
  );
}
