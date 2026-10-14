import { NextResponse } from "next/server";
import { assertStaff } from "@/lib/adminGuard";
import { getTwilioRecordingCredentials } from "@/lib/twilio/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const RECORDING_SID_PATTERN = /^RE[0-9a-f]{32}$/;
const TWILIO_FETCH_TIMEOUT_MS = 30_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sid: string }> }
): Promise<Response> {
  try {
    // Auth and managed-secret reads are bounded by the enclosing route request.
    await assertStaff();
    const { sid } = await params;
    if (!RECORDING_SID_PATTERN.test(sid)) {
      return NextResponse.json({ error: "Invalid Twilio recording SID" }, { status: 400 });
    }

    const { accountSid, authToken } = await getTwilioRecordingCredentials();
    const authorization = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64");
    const upstreamUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`;
    const upstream = await fetch(upstreamUrl, {
      headers: { Authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(TWILIO_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!upstream.ok) {
      // The fetch timeout also bounds cancellation of an unexpected upstream response body.
      await upstream.body?.cancel();
      logger.error(
        { sid, upstreamStatus: upstream.status },
        "[twilio recording proxy] upstream request failed"
      );
      const status = upstream.status === 404 ? 404 : 502;
      return NextResponse.json(
        { error: status === 404 ? "Recording not found" : "Unable to fetch recording" },
        { status }
      );
    }
    if (!upstream.body) {
      logger.error({ sid }, "[twilio recording proxy] upstream returned no response body");
      return NextResponse.json({ error: "Recording response was empty" }, { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recording proxy failure";
    logger.error({ err: error }, "[twilio recording proxy] request failed");
    return NextResponse.json(
      { error: message === "Unauthorized" ? "Unauthorized" : "Unable to fetch recording" },
      { status: message === "Unauthorized" ? 401 : 500 }
    );
  }
}
