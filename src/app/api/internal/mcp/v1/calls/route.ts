import prisma from "@/lib/prisma";
import { createCallsGetHandler, type CallsGetDependencies } from "@/lib/calls/routeHandlers";
import { requireMcpToken } from "@/lib/mcpApi";

export const dynamic = "force-dynamic";

const dependencies: CallsGetDependencies = {
  authorize: requireMcpToken,
  findCalls: (query) =>
    prisma.contactCall.findMany({
      where: {
        provider: query.provider,
        ...(query.providerCallId ? { providerCallId: query.providerCallId } : {}),
        ...(query.since ? { startedAt: { gte: query.since } } : {}),
        ...(query.needsTranscript
          ? {
              recordingUrl: { not: null },
              OR: [{ transcript: null }, { transcript: "" }],
            }
          : {}),
      },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        provider: true,
        providerCallId: true,
        direction: true,
        status: true,
        durationSec: true,
        startedAt: true,
        recordingUrl: true,
        transcript: true,
        contactId: true,
        authorLabel: true,
        contact: { select: { name: true } },
      },
    }),
};

export const GET = createCallsGetHandler(dependencies);
