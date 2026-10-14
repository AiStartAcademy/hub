// src/components/Sidebar.tsx

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  LayoutDashboard, Users, BookOpen, Settings, LogOut,
  X, ShieldAlert, FolderOpen, ClipboardList, BarChart3,
  PackageOpen, Download, Brain, ShieldCheck, FileText, Bot, KeyRound,
  MessageSquareQuote, MapPin, Receipt, DollarSign, GraduationCap, Send, CalendarDays, Crown, Ticket, PhoneCall,
  WalletCards, MessagesSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { brand } from "@/config/brand";
import ReportIssueButton from "./ReportIssueButton";
import { useSidebar } from "./SidebarContext";
import { MANAGE_ROLES, hasAnyRole, hasRole, primaryRole } from "@/lib/roles";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, authRequired: true },
  { href: "/members", label: "Members", icon: Crown, authRequired: true },
  { href: "/chat", label: "Chat", icon: MessagesSquare, authRequired: true },
  { href: "/cohorts", label: "Cohorts", icon: Users, authRequired: false },
  { href: "/courses", label: "Courses", icon: BookOpen, authRequired: false },
  { href: "/instructors", label: "Instructors", icon: GraduationCap, authRequired: false },
  // Mentors tab hidden 2026-07: one visible roster (/instructors) with a Mentor badge
  // + booking on mentor cards. The /mentors route itself stays live (public, indexed).
  // { href: "/mentors", label: "Mentors", icon: UserRound, authRequired: false },
  { href: "/mind-health", label: "Mind Health", icon: Brain, authRequired: false },
  { href: "/testimonials", label: "Testimonials", icon: MessageSquareQuote, authRequired: false },
  { href: "/locations", label: "Locations", icon: MapPin, authRequired: false },
  { href: "/verify", label: "Verify Certificate", icon: ShieldCheck, authRequired: false },
  { href: "/purchases", label: "Purchases", icon: Receipt, authRequired: true },
];

function useUnreadChat(sessionActive: boolean): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!sessionActive) return;

    let cancelled = false;

    async function fetchUnread(): Promise<void> {
      try {
        const response = await fetch("/api/chat/unread");
        const data: unknown = await response.json();
        const apiError = typeof data === "object" && data !== null && "error" in data
          ? data.error
          : null;

        if (!response.ok || apiError) {
          throw new Error(typeof apiError === "string" ? apiError : "Failed to load unread chat count");
        }
        if (typeof data !== "object" || data === null || !("unread" in data) || typeof data.unread !== "number") {
          throw new Error("Unread chat count returned an invalid response");
        }
        if (!cancelled) setUnread(Math.max(0, Math.floor(data.unread)));
      } catch {
        // Unread failures intentionally degrade to zero so navigation remains usable.
        if (!cancelled) setUnread(0);
      }
    }

    const handleFocus = (): void => {
      void fetchUnread();
    };

    void fetchUnread();
    const intervalId = window.setInterval(fetchUnread, 60000);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [sessionActive]);

  return sessionActive ? unread : 0;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const [userImage, setUserImage] = useState<string | null>(null);
  const unread = useUnreadChat(Boolean(session));

  useEffect(() => {
    if (session?.user) {
      fetch("/api/me")
        .then(res => res.json())
        .then(data => setUserImage(data.image))
        .catch(err => console.error("Failed to fetch sidebar user image", err));
    }
  }, [session]);

  const isActive = (href: string) => pathname.startsWith(href);
  const displayRole = primaryRole(session?.user);
  const isAdmin = hasRole(session?.user, "ADMIN");

  const renderNavContent = (unreadCount: number) => (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-[#D9DEE8] dark:border-[#2e3560]">
        <Image src={brand.assets.logo} alt={brand.name} width={36} height={36} className="rounded-xl" />
        <span className="ml-3 font-bold text-lg tracking-tight text-[#11131D] dark:text-[#F8F9FA]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {brand.name}
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-1">
        {navItems.filter(item => !item.authRequired || session).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                active
                  ? "bg-primary/10 text-primary dark:bg-primary/20 shadow-sm"
                  : "text-[#6C757D] hover:text-[#11131D] hover:bg-[#EEF1F6] dark:text-[#9AA3B2] dark:hover:text-[#F8F9FA] dark:hover:bg-white/5"
              }`}
            >
              <Icon className={`mr-3 h-5 w-5 transition-colors ${active ? "text-primary" : "text-[#9AA3B2] group-hover:text-[#6C757D] dark:group-hover:text-[#F8F9FA]"}`} />
              {item.label}
              {item.href === "/chat" && unreadCount > 0 ? (
                <span className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold">{unreadCount > 99 ? "99+" : unreadCount}</span>
              ) : (
                active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              )}
            </Link>
          );
        })}

        {hasAnyRole(session?.user, MANAGE_ROLES) && (
          <Link href="/media" onClick={() => setMobileOpen(false)}
            className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${isActive("/media") ? "bg-primary/10 text-primary dark:bg-primary/20 shadow-sm" : "text-[#6C757D] hover:text-[#11131D] hover:bg-[#EEF1F6] dark:text-[#9AA3B2] dark:hover:text-[#F8F9FA] dark:hover:bg-white/5"}`}
          >
            <FolderOpen className={`mr-3 h-5 w-5 transition-colors ${isActive("/media") ? "text-primary" : "text-[#9AA3B2] group-hover:text-[#6C757D] dark:group-hover:text-[#F8F9FA]"}`} />
            Library
            {isActive("/media") && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
          </Link>
        )}

        <Link href="/assets" onClick={() => setMobileOpen(false)}
          className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${isActive("/assets") ? "bg-primary/10 text-primary dark:bg-primary/20 shadow-sm" : "text-[#6C757D] hover:text-[#11131D] hover:bg-[#EEF1F6] dark:text-[#9AA3B2] dark:hover:text-[#F8F9FA] dark:hover:bg-white/5"}`}
        >
          <PackageOpen className={`mr-3 h-5 w-5 transition-colors ${isActive("/assets") ? "text-primary" : "text-[#9AA3B2] group-hover:text-[#6C757D] dark:group-hover:text-[#F8F9FA]"}`} />
          Assets
          {isActive("/assets") && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
        </Link>

        {hasAnyRole(session?.user, ["TEAM_MEMBER", "ADMIN"]) && (
          <Link href="/onboarding-responses" onClick={() => setMobileOpen(false)}
            className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${isActive("/onboarding-responses") ? "bg-primary/10 text-primary dark:bg-primary/20 shadow-sm" : "text-[#6C757D] hover:text-[#11131D] hover:bg-[#EEF1F6] dark:text-[#9AA3B2] dark:hover:text-[#F8F9FA] dark:hover:bg-white/5"}`}
          >
            <BarChart3 className={`mr-3 h-5 w-5 transition-colors ${isActive("/onboarding-responses") ? "text-primary" : "text-[#9AA3B2] group-hover:text-[#6C757D] dark:group-hover:text-[#F8F9FA]"}`} />
            Responses
            {isActive("/onboarding-responses") && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
          </Link>
        )}

        {isAdmin && (
          <div className="pt-4 mt-4 border-t border-[#D9DEE8] dark:border-[#2e3560]">
            <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9AA3B2]">Admin</p>
            {[
              { href: "/admin/users", label: "Users", Icon: ShieldAlert },
              { href: "/admin/members", label: "Members", Icon: Crown },
              { href: "/admin/onboarding", label: "Onboarding", Icon: ClipboardList },
              { href: "/admin/contacts", label: "Leads", Icon: Users },
              { href: "/admin/call-team", label: "Call Team", Icon: PhoneCall },
              { href: "/admin/venue-events", label: "Venue", Icon: CalendarDays },
              { href: "/admin/cohorts/participation", label: "Teaching", Icon: GraduationCap },
              { href: "/admin/contacts/campaigns", label: "Drip", Icon: Send },
              { href: "/admin/sales", label: "Sales", Icon: DollarSign },
              { href: "/admin/coupons", label: "Coupons", Icon: Ticket },
              { href: "/admin/content", label: "Content", Icon: FileText },
              { href: "/admin/agents", label: "Agents", Icon: Bot },
              { href: "/admin/integrations", label: "Integrations", Icon: KeyRound },
              { href: "/admin/billing", label: "Billing", Icon: WalletCards },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${isActive(href) ? "bg-rose-500/10 text-rose-500 shadow-sm" : "text-[#6C757D] hover:text-[#11131D] hover:bg-[#EEF1F6] dark:text-[#9AA3B2] dark:hover:text-[#F8F9FA] dark:hover:bg-white/5"}`}
              >
                <Icon className={`mr-3 h-5 w-5 transition-colors ${isActive(href) ? "text-rose-500" : "text-[#9AA3B2] group-hover:text-[#6C757D] dark:group-hover:text-[#F8F9FA]"}`} />
                {label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className="px-3 pb-2">
        <ReportIssueButton />
      </div>

      {/* User profile */}
      <div className="p-4 border-t border-[#D9DEE8] dark:border-[#2e3560]">
        {session ? (
          <div className="flex items-center">
            <Link 
              href="/settings"
              onClick={() => setMobileOpen(false)}
              className="flex items-center flex-1 min-w-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 p-1.5 -ml-1.5 rounded-lg transition-colors cursor-pointer group"
              title="Go to Profile Settings"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-semibold text-sm shadow-md uppercase overflow-hidden border border-slate-200 dark:border-slate-700 flex-shrink-0 group-hover:ring-2 group-hover:ring-primary/50 transition-all">
                {userImage
                  ? <img src={userImage} alt="User avatar" className="w-full h-full object-cover" />
                  : session.user?.name?.[0] || session.user?.email?.[0] || "U"
                }
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#11131D] dark:text-[#F8F9FA] truncate group-hover:text-primary transition-colors">{session.user?.name || "User"}</p>
                <p className="text-xs text-[#6C757D] dark:text-[#9AA3B2] capitalize">{displayRole.toLowerCase().replace("_", " ")}</p>
              </div>
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="p-2 w-[44px] h-[44px] rounded-lg text-[#9AA3B2] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors ml-1 flex items-center justify-center flex-shrink-0"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Link href="/login" className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30">
            <LogOut className="h-4 w-4 rotate-180" />
            Sign In
          </Link>
        )}
      </div>

      <div className="px-5 pb-3 flex gap-3 text-[10px] text-[#9AA3B2] dark:text-[#9AA3B2]/70">
        <Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
        <span>·</span>
        <Link href="/terms" className="hover:text-primary transition-colors">Terms</Link>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-[#1B1F3B] border-r border-[#D9DEE8] dark:border-[#2e3560] flex flex-col transform transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-[#EEF1F6] dark:hover:bg-white/5 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Close menu"
        >
          <X className="h-5 w-5 text-[#6C757D]" />
        </button>
        {renderNavContent(unread)}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-white dark:bg-[#1B1F3B] border-r border-[#D9DEE8] dark:border-[#2e3560] flex-col">
        {renderNavContent(unread)}
      </aside>
    </>
  );
}
