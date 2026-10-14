import prisma from "@/lib/prisma";
import {
  createCallRecordingGetHandler,
  type CallRecordingDependencies,
} from "@/lib/calls/routeHandlers";
import { requireMcpToken } from "@/lib/mcpApi";
import { getTwilioRecordingCredentials } from "@/lib/twilio/client";

export const dynamic = "force-dynamic";

const dependencies: CallRecordingDependencies = {
  authorize: requireMcpToken,
  findCall: (id) =>
    prisma.contactCall.findUnique({
      where: { id },
      select: { recordingUrl: true },
    }),
  getCredentials: getTwilioRecordingCredentials,
  fetchRecording: fetch,
};

export const GET = createCallRecordingGetHandler(dependencies);
