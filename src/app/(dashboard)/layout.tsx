// src/app/(dashboard)/layout.tsx

import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";
import ConversionTracker from "@/components/ConversionTracker";
import { SidebarProvider } from "@/components/SidebarContext";
import { SoftphoneProvider } from "@/components/softphone/SoftphoneProvider";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getRoles } from "@/lib/roles";

// Authenticated application — never index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const roles = getRoles(session?.user);
  const isCrmStaff = roles.includes("ADMIN") || roles.includes("TEAM_MEMBER");

  // Softphone availability is an enhancement — a broken staff session must not
  // take down the whole dashboard, so degrade to "unavailable" and log instead
  // of throwing.
  let isAvailableForCalls = false;
  if (isCrmStaff) {
    if (!session?.user?.id) {
      console.error("[softphone] CRM staff session is missing a user id — softphone disabled");
    } else {
      const staff = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { isAvailableForCalls: true },
      });
      if (!staff) {
        console.error("[softphone] CRM staff user row not found — softphone disabled");
      } else {
        isAvailableForCalls = staff.isAvailableForCalls;
      }
    }
  }

  const shell = (
    <SidebarProvider>
      <div className="h-screen flex overflow-hidden">
        <Sidebar />
        {/*
          Scrolls vertically: most pages are a plain `div` with no scroll
          container of their own, so `overflow-hidden` here clipped anything
          past the viewport with no way to reach it. Pages that DO manage their
          own scrolling (cohorts ManageView, LessonViewer) size to `h-full`, so
          their content still fits and this container stays inert for them.
        */}
        <main className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden">
          {children}
        </main>
        <ThemeToggle />
      </div>
      <ConversionTracker />
    </SidebarProvider>
  );

  if (!isCrmStaff) return shell;

  return (
    <SoftphoneProvider available={isAvailableForCalls} isCrmStaff={true}>
      {shell}
    </SoftphoneProvider>
  );
}
