// src/app/(dashboard)/testimonials/page.tsx

import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { MessageSquareQuote } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import TestimonialsSection from "@/components/TestimonialsSection";

export const metadata: Metadata = {
  title: `Testimonials · ${brand.name}`,
};

export default function TestimonialsPage() {
  return (
    <>
      {/* Header */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MobileMenuButton />
          <div className="min-w-0">
            <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
              <MessageSquareQuote className="h-5 w-5 text-primary" />
              Testimonials
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              What our students say about the bootcamp
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 md:p-8">
        <div className="max-w-7xl mx-auto animate-fade-in">
          <TestimonialsSection />
        </div>
      </div>
    </>
  );
}
