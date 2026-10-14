import twilio from "twilio";
import { getSecret } from "@/lib/secrets";

type TwilioClient = ReturnType<typeof twilio>;

let client: TwilioClient | null = null;

export async function getTwilioClient(): Promise<TwilioClient> {
  if (client) return client;

  const [accountSidValue, authTokenValue] = await Promise.all([
    getSecret("TWILIO_ACCOUNT_SID"),
    getSecret("TWILIO_AUTH_TOKEN"),
  ]);
  const accountSid = accountSidValue?.trim();
  const authToken = authTokenValue?.trim();

  if (!accountSid) {
    throw new Error(
      "TWILIO_ACCOUNT_SID is not configured; set it in Settings → Integrations or the server environment"
    );
  }
  if (!authToken) {
    throw new Error(
      "TWILIO_AUTH_TOKEN is not configured; set it in Settings → Integrations or the server environment"
    );
  }

  client = twilio(accountSid, authToken);
  return client;
}

export async function getTwilioNumber(): Promise<string> {
  const value = (await getSecret("TWILIO_PHONE_NUMBER"))?.trim();
  if (!value) {
    throw new Error(
      "TWILIO_PHONE_NUMBER is not configured; set it in Settings → Integrations or the server environment"
    );
  }
  return value;
}

async function requiredTwilioSecret(key: string): Promise<string> {
  // Managed-secret reads are same-database lookups bounded by the enclosing request.
  const value = (await getSecret(key))?.trim();
  if (!value) {
    throw new Error(
      `${key} is not configured; set it in Settings → Integrations or the server environment`
    );
  }
  return value;
}

export async function getTwilioVoiceCredentials(): Promise<{
  accountSid: string;
  authToken: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
}> {
  // Managed-secret reads are same-database lookups bounded by the enclosing request.
  const [accountSid, authToken, apiKeySid, apiKeySecret, twimlAppSid] = await Promise.all([
    requiredTwilioSecret("TWILIO_ACCOUNT_SID"),
    requiredTwilioSecret("TWILIO_AUTH_TOKEN"),
    requiredTwilioSecret("TWILIO_API_KEY_SID"),
    requiredTwilioSecret("TWILIO_API_KEY_SECRET"),
    requiredTwilioSecret("TWILIO_TWIML_APP_SID"),
  ]);
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    throw new Error("TWILIO_ACCOUNT_SID has an invalid shape");
  }
  if (!/^SK[0-9a-f]{32}$/i.test(apiKeySid)) {
    throw new Error("TWILIO_API_KEY_SID has an invalid shape");
  }
  if (!/^AP[0-9a-f]{32}$/i.test(twimlAppSid)) {
    throw new Error("TWILIO_TWIML_APP_SID has an invalid shape");
  }
  return { accountSid, authToken, apiKeySid, apiKeySecret, twimlAppSid };
}

export async function getTwilioRecordingCredentials(): Promise<{
  accountSid: string;
  authToken: string;
}> {
  // Managed-secret reads are same-database lookups bounded by the enclosing request.
  const [accountSid, authToken] = await Promise.all([
    requiredTwilioSecret("TWILIO_ACCOUNT_SID"),
    requiredTwilioSecret("TWILIO_AUTH_TOKEN"),
  ]);
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    throw new Error("TWILIO_ACCOUNT_SID has an invalid shape");
  }
  return { accountSid, authToken };
}

export async function sendSms({
  to,
  body,
  statusCallback,
}: {
  to: string;
  body: string;
  statusCallback?: string;
}): Promise<string> {
  const [twilioClient, from] = await Promise.all([getTwilioClient(), getTwilioNumber()]);
  const message = await twilioClient.messages.create({
    to,
    from,
    body,
    ...(statusCallback ? { statusCallback } : {}),
  });
  if (typeof message.sid !== "string" || !message.sid.trim()) {
    throw new Error("Twilio message create returned an invalid response without a message SID");
  }
  return message.sid;
}
