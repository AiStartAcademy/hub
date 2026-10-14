// src/app/(dashboard)/admin/members/pods/page.tsx
//
// Pod management: create pods, assign/remove Accelerator members, set coach,
// and (re-)provision each pod's RocketChat channel.

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { Users, ArrowLeft, MessageCircle } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import {
  createPod,
  updatePod,
  assignPodMember,
  removePodMember,
  resyncPodChat,
} from "../actions";

export const metadata = { title: "Pods | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPodsPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");

  const [pods, coaches] = await Promise.all([
    prisma.pod.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        coach: { select: { id: true, name: true, email: true } },
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { OR: [{ roles: { contains: "INSTRUCTOR" } }, { roles: { contains: "ADMIN" } }, { role: { in: ["INSTRUCTOR", "ADMIN"] } }] },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Link href="/admin/members" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Users className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Pods</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Create pod</h2>
            <form action={createPod} className="flex gap-2">
              <input name="name" required placeholder="Pod name (e.g. August Builders)"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90">Create</button>
            </form>
          </div>

          {pods.map((pod) => (
            <div key={pod.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{pod.name}</h3>
                  <p className="text-xs text-slate-500">
                    pod-{pod.slug} · {pod.members.length}/{pod.capacity} members ·{" "}
                    {pod.rocketchatGroupId ? "chat provisioned" : "no chat channel yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={updatePod} className="flex items-center gap-2">
                    <input type="hidden" name="podId" value={pod.id} />
                    <select name="status" defaultValue={pod.status}
                      className="px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                      <option value="forming">forming</option>
                      <option value="active">active</option>
                      <option value="archived">archived</option>
                    </select>
                    <select name="coachId" defaultValue={pod.coach?.id ?? ""}
                      className="px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                      <option value="">No coach</option>
                      {coaches.map((c) => (
                        <option key={c.id} value={c.id}>{c.name ?? c.email}</option>
                      ))}
                    </select>
                    <button type="submit" className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Save</button>
                  </form>
                  <form action={resyncPodChat}>
                    <input type="hidden" name="podId" value={pod.id} />
                    <button type="submit" className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <MessageCircle className="h-3 w-3" /> Sync chat
                    </button>
                  </form>
                </div>
              </div>

              <div className="space-y-1">
                {pod.members.map((pm) => (
                  <div key={pm.id} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-slate-900 dark:text-white">{pm.user.name ?? "Unnamed"}</span>
                      <span className="text-[11px] text-slate-500 ml-2">{pm.user.email}</span>
                    </div>
                    <form action={removePodMember}>
                      <input type="hidden" name="podMemberId" value={pm.id} />
                      <button type="submit" className="text-xs text-red-600 hover:underline">Remove</button>
                    </form>
                  </div>
                ))}
                <form action={assignPodMember} className="flex gap-2 pt-1">
                  <input type="hidden" name="podId" value={pod.id} />
                  <input name="email" type="email" required placeholder="Add member by email"
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90">Add</button>
                </form>
              </div>
            </div>
          ))}
          {pods.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">No pods yet — create the first one above.</p>
          )}
        </div>
      </main>
    </div>
  );
}
