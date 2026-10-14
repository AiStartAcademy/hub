import prisma from "@/lib/prisma";
import { createCallPatchHandler, type CallPatchDependencies } from "@/lib/calls/routeHandlers";
import { mcpWritesEnabled, requireMcpToken } from "@/lib/mcpApi";

export const dynamic = "force-dynamic";

const dependencies: CallPatchDependencies = {
  authorize: requireMcpToken,
  writesEnabled: mcpWritesEnabled,
  findCall: (id) =>
    prisma.contactCall.findUnique({
      where: { id },
      select: { transcript: true },
    }),
  updateCall: async (id, data) => {
    await prisma.contactCall.update({ where: { id }, data });
  },
};

export const PATCH = createCallPatchHandler(dependencies);
