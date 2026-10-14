// src/components/MobileMenuButton.tsx

"use client";

import { Menu } from "lucide-react";
import { useSidebar } from "./SidebarContext";

export function MobileMenuButton() {
  const { toggle } = useSidebar();
  return (
    <button
      onClick={toggle}
      className="md:hidden p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
      aria-label="Open navigation menu"
    >
      <Menu className="h-5 w-5 text-slate-700 dark:text-slate-200" />
    </button>
  );
}