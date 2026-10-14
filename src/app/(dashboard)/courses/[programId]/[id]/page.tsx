// src/app/(dashboard)/courses/[programId]/[id]/page.tsx

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ArrowLeft, Edit, Eye } from "lucide-react";
import ContentEditor from "./ContentEditor";
import LessonViewer from "./LessonViewer";
import AssessmentTaker from "./AssessmentTaker";
import AssessmentStats from "./AssessmentStats";
import { checkProgramAccess } from "@/lib/programAccess";
import { ShareButton } from "../../components/ShareButton";
import { MobileMenuButton } from '@/components/MobileMenuButton';
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { answerKeyForViewer, stripQuizAnswerKey } from "@/lib/answerKey";

export default async function CourseItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string; id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { programId, id } = await params;
  const resolvedSearchParams = await searchParams;
  const session = await auth();

  const userId = (session?.user as any)?.id as string | undefined;
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);
  const isEditMode = canManage && resolvedSearchParams.mode === "edit";

  // ── extended include with quiz ──────────────────────────────────────
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    include: {
      module: { include: { program: true } },
      videos: {
        orderBy: [{ isPrimary: "desc" }, { language: "asc" }],
      },
      quiz: {
        include: {
          items: {
            orderBy: { order: "asc" },
            include: {
              options: { orderBy: { order: "asc" } },
            },
          },
          // the current user's latest attempt (when signed in)
          submissions: userId
            ? {
                where: { userId },
                orderBy: { attemptNumber: "desc" },
                take: 1,
                include: {
                  answers: {
                    include: { selectedOptions: true },
                  },
                },
              }
            : false,
        },
      },
    },
  });

  const assessment = await prisma.assessment.findUnique({
    where: { id },
    include: {
      module: { include: { program: true } },
      items: { include: { options: true } },
    },
  });

  if (!lesson && !assessment) notFound();

  const item = lesson || assessment!;
  const itemType = lesson ? "lesson" : "assessment";
  const program = item.module.program;

  const isProgramLocked = program.locked;

  const lessonForViewer =
    canManage || !lesson
      ? lesson
      : { ...lesson, quiz: stripQuizAnswerKey(lesson.quiz) };

  if (!canManage) {
    console.log(`[CourseItemPage] Checking access for userId=${userId ?? "guest"} to program ${programId}`);
    const { hasAccess, isPublicNoAuth, needsConsent } = await checkProgramAccess(
      programId,
      userId
    );

    // Entitled, just hasn't signed the policies yet — send them to sign, not away.
    if (needsConsent) {
      redirect(`/consent?next=${encodeURIComponent(`/courses/${programId}/${id}`)}`);
    }

    if (!hasAccess) {
      // If course requires auth and user is guest — send to register, carrying
      // the intended lesson so they land back here after signing up instead of
      // on a generic dashboard.
      if (!userId) {
        const callbackUrl = `/courses/${programId}/${id}`;
        console.log(`[CourseItemPage] Guest denied, redirecting to /register?callbackUrl=${callbackUrl}`);
        redirect(`/register?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      console.log(`[CourseItemPage] Access denied for userId=${userId}, redirecting to course page`);
      redirect(`/courses/${programId}`);
    }

    console.log(`[CourseItemPage] Access granted for userId=${userId ?? "guest"}, isPublicNoAuth=${isPublicNoAuth}`);
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 flex-shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-2 overflow-hidden">
          <MobileMenuButton />
          <Link
            href={`/courses/${programId}`}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400 rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="h-4 w-4 text-slate-500" />
          </Link>
          {/* Breadcrumb: hidden on mobile, visible from sm */}
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 flex-shrink-0">
            <Link href="/courses" className="hover:text-primary transition-colors">
              Courses
            </Link>
            <ChevronRight className="h-3 w-3 text-slate-300" />
            <Link
              href={`/courses/${programId}`}
              className="hover:text-primary transition-colors truncate max-w-[100px]"
            >
              {item.module.program.name}
            </Link>
            <ChevronRight className="h-3 w-3 text-slate-300" />
            <span className="truncate max-w-[150px]">{item.module.name}</span>
            <ChevronRight className="h-3 w-3 text-slate-300" />
            <span className="text-slate-900 dark:text-white truncate max-w-[360px]">
              {item.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <ShareButton programId={programId} programName={item.name} />
          {canManage && itemType === "lesson" && (
            isEditMode ? (
              <Link
                href={`/courses/${programId}/${id}`}
                className="flex items-center gap-1.5 px-3 md:px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-white focus-visible:ring-2 focus-visible:ring-primary transition-all min-h-[44px]"
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Preview</span>
              </Link>
            ) : (
              <Link
                href={`/courses/${programId}/${id}?mode=edit`}
                className="flex items-center gap-1.5 px-3 md:px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-white focus-visible:ring-2 focus-visible:ring-primary transition-all min-h-[44px]"
              >
                <Edit className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit Content</span>
              </Link>
            )
          )}
          {canManage && itemType === "assessment" && (
            <Link
              href={`/courses/${programId}/${id}/edit`}
              className="flex items-center gap-1.5 px-3 md:px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-white focus-visible:ring-2 focus-visible:ring-primary transition-all min-h-[44px]"
            >
              <span className="hidden sm:inline">Edit Questions</span>
              <Edit className="h-3.5 w-3.5 sm:hidden" />
            </Link>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto md:p-8">
        {lesson && (
          isEditMode ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-8">
                <ContentEditor lesson={lesson} />
              </div>
            </div>
          ) : (
            // ── userId for the quiz ──
            <LessonViewer 
              key={lesson.id}
              lesson={lessonForViewer!}
              userId={session?.user?.id}
              courseName={lesson.module.program.name} // Course name
              moduleName={lesson.module.name}         // Module name
            />
          )
        )}
        {assessment && (
          canManage ? (
            <AssessmentStats assessment={assessment} />
          ) : (
            <AssessmentTaker
              assessment={answerKeyForViewer(assessment, { canManage })}
            />
          )
        )}
      </div>
    </div>
  );
}
