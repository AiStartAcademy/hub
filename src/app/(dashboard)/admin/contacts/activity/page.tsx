// src/app/(dashboard)/admin/contacts/activity/page.tsx

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { Mail, Calendar, Download, MonitorPlay, Activity, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Lead Activity Log | Admin" };

type EventType = "ASSET_DOWNLOAD" | "LESSON_VIEW";

interface ParsedMetadata {
  mediaId?: string;
  fileName?: string;
  lessonId?: string;
  lessonTitle?: string;
  courseName?: string;
  moduleName?: string; 
}

export default async function ContactsActivityLogPage() {
  const session = await auth();
  
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  // Fetch all contacts with their events, ordered by newly created
  const contacts = await prisma.contact.findMany({
    include: {
      events: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 z-10 gap-3 shadow-sm">
        <MobileMenuButton />
        <Activity className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white">
          <span className="hidden sm:inline">Lead Activity Log</span>
          <span className="sm:hidden">Activity Log</span>
        </h1>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/admin/contacts"
            className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary transition-colors bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm min-h-[44px]"
          >
            <ArrowLeft className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Back to Leads</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm border-dashed">
              <Activity className="h-12 w-12 mb-4 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">No activity yet</p>
              <p className="text-xs mt-1 text-slate-500">Events will appear here when leads interact with content.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase tracking-widest font-black text-slate-400">
                    <tr>
                      <th className="px-6 py-4">Contact</th>
                      <th className="px-6 py-4">First Captured</th>
                      <th className="px-6 py-4 w-1/2">Activity Pipeline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 bg-white dark:bg-slate-900">
                    {contacts.map((contact) => (
                      <tr key={contact.id} id={contact.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors scroll-mt-20">
                        
                        {/* 1. User Info */}
                        <td className="px-6 py-4 align-top">
                          <p className="font-bold text-slate-900 dark:text-white mb-1">
                            {contact.name || "Unknown"}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Mail className="h-3 w-3 shrink-0" />
                            <a href={`mailto:${contact.email}`} className="hover:text-primary transition-colors truncate">
                              {contact.email}
                            </a>
                          </div>
                        </td>

                        {/* 2. Registration Date */}
                        <td className="px-6 py-4 align-top">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                            <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span>{format(new Date(contact.createdAt), "MMM d, yyyy")}</span>
                          </div>
                          <span className="text-xs text-slate-400 mt-1 block">
                            {format(new Date(contact.createdAt), "h:mm a")}
                          </span>
                        </td>

                        {/* 3. Event History */}
                        <td className="px-6 py-4 align-top whitespace-normal">
                          <div className="space-y-2">
                            {contact.events.map((evt) => {
                              let meta: ParsedMetadata = {};
                              try { meta = JSON.parse(evt.metadata); } catch(e) {}
                              
                              const isDownload = evt.type === "ASSET_DOWNLOAD";
                              const Icon = isDownload ? Download : MonitorPlay;

                              return (
                                <div key={evt.id} className="flex flex-col sm:flex-row sm:items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                  <div className={`shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-lg shadow-sm ${isDownload ? 'bg-white dark:bg-slate-800 text-primary border border-primary/10' : 'bg-white dark:bg-slate-800 text-purple-500 border border-purple-500/10'}`}>
                                    <Icon className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <p className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                                        {isDownload ? "Downloaded File" : "Viewed Lesson"}
                                      </p>
                                      <span className="text-[10px] font-medium text-slate-400">
                                        {format(new Date(evt.createdAt), "MMM d, HH:mm")}
                                      </span>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed truncate">
                                      {isDownload 
                                        ? <span className="text-slate-700 dark:text-slate-200 font-medium break-words">
                                            {meta.fileName || "Unknown File"}
                                          </span>
                                        : (
                                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-snug">
                                            <span className="text-slate-500 dark:text-slate-400 font-medium break-words">
                                              {meta.courseName || "Public Course"} 
                                            </span>
                                            <span className="text-slate-300 dark:text-slate-600 opacity-50 shrink-0">/</span>
                                            
                                            {meta.moduleName && (
                                              <>
                                                <span className="text-slate-500 dark:text-slate-400 font-medium break-words">
                                                  {meta.moduleName}
                                                </span>
                                                <span className="text-slate-300 dark:text-slate-600 opacity-50 shrink-0">/</span>
                                              </>
                                            )}
                                            
                                            <span className="font-semibold text-slate-800 dark:text-slate-100 break-words">
                                              {meta.lessonTitle || "Lesson"}
                                            </span>
                                          </div>
                                        )
                                      }
                                    </p>
                                    
                                    {/* UTM Tracking data if any */}
                                    {(evt.utmSource || evt.utmMedium) && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {evt.utmSource && <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">src: {evt.utmSource}</span>}
                                        {evt.utmMedium && <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">med: {evt.utmMedium}</span>}
                                        {evt.utmCampaign && <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">cmp: {evt.utmCampaign}</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}