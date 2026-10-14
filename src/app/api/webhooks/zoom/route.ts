import { NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { handleZoomRecordingCompleted } from "@/lib/sessionSeries";
import { verifyZoomWebhookSignature } from "@/lib/zoomWebhookSignature";

type ZoomWebhookBody = {
  event?: string;
  payload?: {
    plainToken?: string;
    object?: {
      id?: string | number;
      start_time?: string;
      share_url?: string;
    };
  };
};

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const body = JSON.parse(rawBody) as ZoomWebhookBody;
    const eventType = typeof body.event === "string" ? body.event : "unknown";
    const secret = process.env.ZOOM_WEBHOOK_SECRET;

    if (!secret) {
      logger.error("Zoom Webhook Secret is missing");
      return new NextResponse("Internal Server Error", { status: 500 });
    }

    const verificationResult = verifyZoomWebhookSignature({
      rawBody,
      signature: req.headers.get("x-zm-signature"),
      timestamp: req.headers.get("x-zm-request-timestamp"),
      secret,
    });

    if (!verificationResult.ok) {
      logger.warn(
        { eventType, reason: verificationResult.reason },
        "[Zoom Webhook] Signature verification failed"
      );
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 1. Endpoint validation (challenge-response)
    if (body.event === "endpoint.url_validation") {
      const plainToken = body.payload?.plainToken;

      if (typeof plainToken !== "string") {
        throw new Error("Zoom endpoint validation payload is missing plainToken");
      }

      const signature = crypto
        .createHmac("sha256", secret)
        .update(plainToken)
        .digest("hex");

      return NextResponse.json({
        plainToken: plainToken,
        encryptedToken: signature,
      });
    }

    // 2. Recording completed
    if (body.event === "recording.completed") {
      const payload = body.payload?.object;

      if (payload) {
        const meetingIdValue = payload.id;

        if (meetingIdValue !== undefined) {
          const meetingId = meetingIdValue.toString();
          await handleZoomRecordingCompleted({
            meetingId,
            recordingStart: typeof payload.start_time === "string" ? payload.start_time : "",
            recordingLink: typeof payload.share_url === "string" ? payload.share_url : "",
          });
        } else {
          // Event has no meeting ID: nothing to sync.
        }
      } else {
        // Event has no object: nothing to sync.
      }
    }
    // Other events are ignored on purpose but acknowledged.

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    logger.error({ err: error }, "Zoom webhook error:");
    return new NextResponse("Bad Request", { status: 400 });
  }
}
