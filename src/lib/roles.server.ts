import "server-only";

import prisma from "@/lib/prisma";

import { getRoles, type RoleValue, serializeRoles } from "./roles";

export async function addRole(userId: string, role: RoleValue): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      roles: true,
    },
  });

  if (!user) {
    throw new Error(`Cannot add role ${role} to missing user ${userId}`);
  }

  const currentRoles = getRoles(user);
  if (currentRoles.includes(role)) {
    return;
  }

  const nextRoles = [...currentRoles, role];
  const primaryRole = nextRoles[0];
  if (!primaryRole) {
    throw new Error(`Cannot add role ${role} to user ${userId} without a primary role`);
  }

  const updateResult = await prisma.user.updateMany({
    where: { id: userId },
    data: {
      role: primaryRole,
      roles: serializeRoles(nextRoles),
    },
  });

  if (updateResult.count === 0) {
    throw new Error(`Cannot add role ${role} to missing user ${userId}`);
  }
}
