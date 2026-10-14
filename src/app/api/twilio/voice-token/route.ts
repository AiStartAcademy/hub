import { NextResponse } from "next/server";
import twilio from "twilio";
import { assertStaff, staffIdentity } from "@/lib/adminGuard";
import { getTwilioVoiceCredentials } from "@/lib/twilio/client";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    // Auth and managed-secret reads are bounded by the enclosing request lifetime.
    await assertStaff();
    // The second auth read supplies attribution and is bounded by the request lifetime.
    const identityRecord = await staffIdentity();
    if (!identityRecord.id) {
      throw new Error("Authenticated staff session is missing a user id");
    }

    // Managed-secret reads are same-database work bounded by the request lifetime.
    const credentials = await getTwilioVoiceCredentials();
    const identity = `closer-${identityRecord.id}`;
    const token = new twilio.jwt.AccessToken(
      credentials.accountSid,
      credentials.apiKeySid,
      credentials.apiKeySecret,
      { identity, ttl: 3600 }
    );
    token.addGrant(
      new twilio.jwt.AccessToken.VoiceGrant({
        outgoingApplicationSid: credentials.twimlAppSid,
        incomingAllow: true,
      })
    );
    const jwt = token.toJwt();
    if (typeof jwt !== "string" || jwt.split(".").length !== 3) {
      throw new Error("Twilio access token generation returned an invalid JWT");
    }
    return NextResponse.json({ token: jwt, identity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown token generation failure";
    console.error("[twilio voice token] failed to issue browser token", error);
    return NextResponse.json(
      { error: `Unable to issue Twilio voice token: ${message}` },
      { status: message === "Unauthorized" ? 401 : 500 }
    );
  }
}
