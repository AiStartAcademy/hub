// src/app/(dashboard)/assets/page.tsx

import type { Metadata } from "next";
import { Suspense } from "react";
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

// Public-facing — override the dashboard group's noindex default.
export const metadata: Metadata = {
  title: "Assets",
  description:
    `Free ${brand.name} resources and materials available for download — templates, guides, and tools for AI automation.`,
  alternates: { canonical: "/assets" },
  openGraph: {
    title: `Assets — ${brand.name}`,
    description:
      `Free ${brand.name} resources and materials available for download.`,
    url: "/assets",
    type: "website",
  },
  robots: { index: true, follow: true },
};
import { getDownloadableFiles } from "../media/actions";
import AssetCards from "./AssetCards";
import { MobileMenuButton } from "@/components/MobileMenuButton";

export default async function AssetsPage() {
  const session = await auth();
  const files = await getDownloadableFiles();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 flex-shrink-0 z-10 transition-colors gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MobileMenuButton />
          <div className="min-w-0">
            <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate">
              Assets
            </h1>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
              Materials available for download
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-8">
        <Suspense>
          <AssetCards
            files={files}
            isAuthenticated={!!session?.user}
            canEdit={hasAnyRole(session?.user, MANAGE_ROLES)}
          />
        </Suspense>
      </main>
    </div>
  );
}
