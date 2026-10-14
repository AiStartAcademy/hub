import twilio from "twilio";
import { appUrl } from "@/lib/drip/engine";
import { getSecret } from "@/lib/secrets";

export async function hasTwilioAuthToken(): Promise<boolean> {
  return Boolean((await getSecret("TWILIO_AUTH_TOKEN"))?.trim());
}

export async function verifyTwilioWebhook(
  req: Request,
  params: Record<string, string>
): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const authToken = (await getSecret("TWILIO_AUTH_TOKEN"))?.trim();
  if (!authToken) return false;

  const incomingUrl = new URL(req.url);
  const externalUrl = `${appUrl()}${incomingUrl.pathname}${incomingUrl.search}`;

  // Twilio signs the public URL it called. Behind a proxy, req.url is wrong; validation
  // only succeeds when appUrl() matches the exact externally visible origin and scheme.
  return twilio.validateRequest(authToken, signature, externalUrl, params);
}
