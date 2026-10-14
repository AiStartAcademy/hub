import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import MediaManager from "./components/MediaManager";
import { MobileMenuButton } from '@/components/MobileMenuButton';
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";

export default async function MediaPage() {
  const session = await auth();
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

  if (!canManage) {
    redirect("/dashboard");
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 z-10 transition-colors shadow-sm">
        <MobileMenuButton />
        <div className="ml-2 md:ml-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Library
          </h1>
          <p className="hidden sm:block text-xs font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
            Manage your assets and learning materials
          </p>
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <MediaManager />
      </main>
    </div>
  );
}
