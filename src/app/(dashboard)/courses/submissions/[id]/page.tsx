import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { getSubmission } from "../../actions";
import SubmissionReviewer from "./SubmissionReviewer";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { MobileMenuButton } from '@/components/MobileMenuButton';
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canManage = hasAnyRole(session.user, MANAGE_ROLES);

  if (!canManage) {
    // Maybe allow students to see their own?
    // For now, only managers can review.
    redirect("/cohorts");
  }

  const submission: any = await getSubmission(id);
  if (!submission) notFound();

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 flex-shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <MobileMenuButton />
          <BackButton />
          {/* Breadcrumb: hidden on mobile */}
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 min-w-0">
            <span className="flex-shrink-0">Submissions</span>
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
            <span className="text-slate-900 dark:text-white truncate max-w-[120px] md:max-w-[200px]">
              {submission.user.name || submission.user.email}
            </span>
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
            <span className="text-slate-900 dark:text-white uppercase truncate max-w-[120px] md:max-w-[200px]">
              {submission.assessment.name}
            </span>
          </div>
        </div>
      </header>
      
      <div className="flex-1 overflow-auto md:p-8">
        <SubmissionReviewer submission={submission} />
      </div>
    </div>
  );
}
