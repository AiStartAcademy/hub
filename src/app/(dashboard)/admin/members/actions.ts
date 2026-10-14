// src/app/(dashboard)/admin/members/actions.ts
//
// Admin server actions for the members area. Invariant preserved: the Stripe
// webhook is the sole writer of PAID membership state. Admin actions only
// create/cancel COMP memberships (stripeSessionId = "comp_<cuid>", amount 0),
// which the webhook can never match, and manage pods/milestones/events.
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ADMIN_ROLES, MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { provisionPodChannel } from "@/lib/memberChat";
import {
  grantCompMembership,
  revokeComp,
  type CompTier,
} from "@/lib/membershipAdmin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireRole(roles: readonly string[]) {
  const session = await auth();
  if (!hasAnyRole(session?.user, roles)) {
    throw new Error("Forbidden");
  }
  return session!;
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Comp memberships ────────────────────────────────────────────────────────

export async function compMembership(formData: FormData) {
  const session = await requireRole(ADMIN_ROLES);

  const tier = String(formData.get("tier") ?? "MENTOR_NETWORK");
  if (tier !== "MENTOR_NETWORK" && tier !== "ACCELERATOR") throw new Error("Invalid tier");

  await grantCompMembership({
    email: String(formData.get("email") ?? ""),
    tier: tier as CompTier,
    months: Number(formData.get("months") ?? 0),
    grantedBy: `admin:${session.user!.id}`,
  });
  revalidatePath("/admin/members");
}

export async function revokeCompMembership(formData: FormData) {
  await requireRole(ADMIN_ROLES);
  await revokeComp(String(formData.get("membershipId") ?? ""));
  revalidatePath("/admin/members");
}

// ── Pods ────────────────────────────────────────────────────────────────────

export async function createPod(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Pod name required");

  const base = slugify(name);
  let slug = base;
  for (let i = 2; await prisma.pod.findUnique({ where: { slug } }); i++) {
    slug = `${base}-${i}`;
  }

  await prisma.pod.create({ data: { name, slug } });
  revalidatePath("/admin/members/pods");
}

export async function updatePod(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const podId = String(formData.get("podId") ?? "");
  const status = formData.get("status");
  const coachId = formData.get("coachId");

  await prisma.pod.update({
    where: { id: podId },
    data: {
      ...(typeof status === "string" && ["forming", "active", "archived"].includes(status)
        ? { status }
        : {}),
      ...(typeof coachId === "string" ? { coachId: coachId || null } : {}),
    },
  });
  revalidatePath("/admin/members/pods");
}

export async function assignPodMember(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const podId = String(formData.get("podId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Invalid email");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error("No hub account with that email");

  await prisma.podMember.upsert({
    where: { podId_userId: { podId, userId: user.id } },
    update: { leftAt: null },
    create: { podId, userId: user.id },
  });
  await provisionPodChannel(podId);
  revalidatePath("/admin/members/pods");
}

export async function removePodMember(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const podMemberId = String(formData.get("podMemberId") ?? "");
  await prisma.podMember.update({
    where: { id: podMemberId },
    data: { leftAt: new Date() },
  });
  revalidatePath("/admin/members/pods");
}

export async function resyncPodChat(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const podId = String(formData.get("podId") ?? "");
  const ok = await provisionPodChannel(podId);
  if (!ok) throw new Error("Chat provisioning failed — check RocketChat availability");
  revalidatePath("/admin/members/pods");
}

// ── Milestones ──────────────────────────────────────────────────────────────

export async function reviewMilestoneAchievement(formData: FormData) {
  const session = await requireRole(MANAGE_ROLES);
  const achievementId = String(formData.get("achievementId") ?? "");
  const decision = String(formData.get("decision") ?? "");

  if (decision === "verify") {
    await prisma.milestoneAchievement.update({
      where: { id: achievementId },
      data: { status: "verified", verifiedById: session.user!.id as string },
    });
  } else if (decision === "reject") {
    await prisma.milestoneAchievement.delete({ where: { id: achievementId } });
  } else {
    throw new Error("Invalid decision");
  }
  revalidatePath("/admin/members/milestones");
}

// ── Member events ───────────────────────────────────────────────────────────

const EVENT_TYPES = ["COACHING", "DEAL_DESK", "BUILD_SPRINT", "WEEKLY_QA"];

export async function createMemberEvent(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const type = String(formData.get("type") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const minTier = String(formData.get("minTier") ?? "MENTOR_NETWORK");
  const meetingLink = String(formData.get("meetingLink") ?? "").trim() || null;

  if (!EVENT_TYPES.includes(type)) throw new Error("Invalid event type");
  if (!title) throw new Error("Title required");
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) throw new Error("Invalid date");
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error("Times must be HH:MM");
  }
  if (minTier !== "MENTOR_NETWORK" && minTier !== "ACCELERATOR") throw new Error("Invalid tier");

  await prisma.memberEvent.create({
    data: { type, title, date: parsedDate, startTime, endTime, minTier, meetingLink },
  });
  revalidatePath("/admin/members/events");
  revalidatePath("/members/calls");
}

export async function updateMemberEvent(formData: FormData) {
  await requireRole(MANAGE_ROLES);
  const eventId = String(formData.get("eventId") ?? "");
  const status = formData.get("status");
  const recordingLink = formData.get("recordingLink");

  await prisma.memberEvent.update({
    where: { id: eventId },
    data: {
      ...(typeof status === "string" &&
      ["upcoming", "live", "completed", "canceled"].includes(status)
        ? { status }
        : {}),
      ...(typeof recordingLink === "string"
        ? { recordingLink: recordingLink.trim() || null }
        : {}),
    },
  });
  revalidatePath("/admin/members/events");
  revalidatePath("/members/calls");
}
