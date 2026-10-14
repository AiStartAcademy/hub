import { logger } from "@/lib/logger";
import { hasTwilioAuthToken, verifyTwilioWebhook } from "@/lib/twilio/verify";

export type VerifiedTwilioRequest =
  | { ok: true; params: Record<string, string> }
  | { ok: false; response: Response };

export function twimlResponse(status = 200): Response {
  return new Response("<Response/>", {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function verifiedTwilioParams(
  req: Request,
  webhook: string
): Promise<VerifiedTwilioRequest> {
  let hasAuthToken: boolean;
  try {
    hasAuthToken = await hasTwilioAuthToken();
  } catch (error) {
    logger.error({ err: error, webhook }, "[twilio webhook] auth token lookup failed");
    return { ok: false, response: twimlResponse(500) };
  }
  if (!hasAuthToken) {
    logger.error(
      { webhook },
      "[twilio webhook] TWILIO_AUTH_TOKEN is not set — refusing request"
    );
    return { ok: false, response: twimlResponse(500) };
  }
  if (!req.headers.get("x-twilio-signature")) {
    logger.warn({ webhook }, "[twilio webhook] missing signature");
    return { ok: false, response: twimlResponse(401) };
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (error) {
    logger.error({ err: error, webhook }, "[twilio webhook] invalid form body");
    return { ok: false, response: twimlResponse(400) };
  }

  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") {
      logger.error({ webhook, key }, "[twilio webhook] form body contained a file");
      return { ok: false, response: twimlResponse(400) };
    }
    params[key] = value;
  }

  let verified: boolean;
  try {
    verified = await verifyTwilioWebhook(req, params);
  } catch (error) {
    logger.error({ err: error, webhook }, "[twilio webhook] signature verification failed");
    return { ok: false, response: twimlResponse(500) };
  }
  if (!verified) {
    logger.warn({ webhook }, "[twilio webhook] invalid or missing signature");
    return { ok: false, response: twimlResponse(401) };
  }

  return { ok: true, params };
}
