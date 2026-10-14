"use server";

import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { assertAdmin, assertStaff, staffIdentity } from "@/lib/adminGuard";

export type SetUserCallAvailabilityResult =
  | { ok: true; available: boolean }
  | { ok: false; error: string };

async function currentStaffId(): Promise<string> {
  // Auth reads are bounded by the lifetime of the enclosing server-action request.
  await assertStaff();
  const identity = await staffIdentity();
  if (!identity.id) {
    throw new Error("Authenticated staff session is missing a user id");
  }
  return identity.id;
}

export async function setCallAvailability(value: boolean): Promise<boolean> {
  const userId = await currentStaffId();
  if (typeof value !== "boolean") {
    throw new Error("Call availability must be a boolean");
  }

  // The database update is bounded by the server-action request lifetime.
  const user = await prisma.user.update({
    where: { id: userId },
    data: { isAvailableForCalls: value },
    select: { isAvailableForCalls: true },
  });
  return user.isAvailableForCalls;
}

export async function setUserCallAvailability(
  userId: string,
  available: boolean,
): Promise<SetUserCallAvailabilityResult> {
  try {
    await assertAdmin();

    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return { ok: false, error: "Choose a call-team member to update" };
    }
    if (typeof available !== "boolean") {
      return { ok: false, error: "Call availability must be a boolean" };
    }

    const user = await prisma.user.update({
      where: { id: normalizedUserId },
      data: { isAvailableForCalls: available },
      select: { isAvailableForCalls: true },
    });
    revalidatePath("/admin/call-team");
    return { ok: true, available: user.isAvailableForCalls };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update call availability",
    };
  }
}

export async function getCallAvailability(): Promise<boolean> {
  const userId = await currentStaffId();
  // The database lookup is bounded by the server-component request lifetime.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAvailableForCalls: true },
  });
  if (!user) {
    throw new Error("Authenticated staff user no longer exists");
  }
  return user.isAvailableForCalls;
}
