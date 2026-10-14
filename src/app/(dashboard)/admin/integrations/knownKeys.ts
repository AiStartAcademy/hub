import { brand } from "@/config/brand";

export const CATEGORIES = ["llm", "mcp", "payments", "comms", "marketing", "endpoints", "other"] as const;
export const KINDS = ["secret", "config"] as const;

export type IntegrationCategory = (typeof CATEGORIES)[number];
export type IntegrationKind = (typeof KINDS)[number];

export interface KnownIntegrationKey {
  key: string;
  label: string;
  category: IntegrationCategory;
  kind: IntegrationKind;
  description: string;
  example: string;
}

export const KNOWN_INTEGRATION_KEYS: readonly KnownIntegrationKey[] = [
  {
    key: "N8N_EXTRACT_AUDIO_WEBHOOK_URL",
    label: "n8n extract-audio webhook",
    category: "endpoints",
    kind: "config",
    description:
      "n8n webhook that extracts audio from a lesson video and calls back to /api/n8n/extract-audio-callback.",
    example: brand.urls.automationsWebhookExample,
  },
  {
    key: "N8N_WEBHOOK_URL",
    label: "n8n course-ingestion webhook",
    category: "endpoints",
    kind: "config",
    description:
      "Existing course-ingestion workflow trigger read in src/app/(dashboard)/courses/actions.ts.",
    example: brand.urls.automationsWebhookExample,
  },
  {
    key: "N8N_WEBHOOK_SECRET",
    label: "n8n inbound callback bearer token",
    category: "other",
    kind: "secret",
    description:
      "Shared bearer token n8n presents on inbound callbacks, including module-callback and extract-audio-callback.",
    example: "a-long-random-string",
  },
  {
    key: "N8N_CALLBACK_SECRET",
    label: "n8n legacy callback secret",
    category: "other",
    kind: "secret",
    description:
      "Existing callback secret used by src/app/api/n8n/callback/route.ts.",
    example: "a-long-random-string",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    category: "llm",
    kind: "secret",
    description:
      "Used by generate-image and program cover generation routes.",
    example: "sk-...",
  },
  {
    key: "META_PIXEL_ID",
    label: "Meta Pixel ID",
    category: "marketing",
    kind: "config",
    description:
      "Meta Events Manager dataset id. Drives BOTH the browser pixel (served to the client via /api/meta-pixel) and server CAPI events (src/lib/serverConversions.ts).",
    example: "1234567890123456",
  },
  {
    key: "META_CAPI_TOKEN",
    label: "Meta Conversions API token",
    category: "marketing",
    kind: "secret",
    description:
      "Events Manager → (pixel) → Settings → Conversions API → Generate access token. Server-side Lead/Purchase reporting.",
    example: "EAAG...",
  },
  {
    key: "META_TEST_EVENT_CODE",
    label: "Meta test event code",
    category: "marketing",
    kind: "config",
    description:
      "Routes CAPI events to Events Manager → Test Events for verification. MUST be deleted after testing — while set, events stay out of live reporting.",
    example: "TEST12345",
  },
  {
    key: "GA4_MEASUREMENT_ID", // gitleaks:allow (env var name, not a key)
    label: "GA4 measurement id",
    category: "marketing",
    kind: "config",
    description:
      "GA4 property stream id for server-side Measurement Protocol conversions.",
    example: "G-XXXXXXXXXX",
  },
  {
    key: "GA4_API_SECRET",
    label: "GA4 Measurement Protocol secret",
    category: "marketing",
    kind: "secret",
    description:
      "GA4 Admin → Data Streams → (hub stream) → Measurement Protocol API secrets → Create.",
    example: "aBcDeFgHiJkLmNoP",
  },
  {
    key: "DRIP_TRACKING_SECRET",
    label: "Email open/click tracking secret",
    category: "comms",
    kind: "secret",
    description:
      "Enables signed email open/click tracking. While unset, email sends still go out but are untracked. Generate one with `openssl rand -hex 32`.",
    example: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
  {
    key: "DRIP_FROM",
    label: "Drip From mailbox",
    category: "comms",
    kind: "config",
    description:
      "Preferred environment name for the From mailbox used by drip, newsletter, and instructor email (for example, a bare address or a formatted mailbox).",
    example: '"Academy" <hello@example.com>',
  },
  {
    key: "DRIP_REPLY_TO",
    label: "Drip Reply-To address",
    category: "comms",
    kind: "config",
    description:
      "Preferred environment name for the Reply-To address used by drip, newsletter, and instructor email.",
    example: "hello@example.com",
  },
  {
    key: "AISA_FROM",
    label: "Legacy drip From mailbox",
    category: "comms",
    kind: "config",
    description:
      "Deprecated environment alias for DRIP_FROM. Kept for existing deployments; use DRIP_FROM for new configuration.",
    example: '"Academy" <hello@example.com>',
  },
  {
    key: "AISA_REPLY_TO",
    label: "Legacy drip Reply-To address",
    category: "comms",
    kind: "config",
    description:
      "Deprecated environment alias for DRIP_REPLY_TO. Kept for existing deployments; use DRIP_REPLY_TO for new configuration.",
    example: "hello@example.com",
  },
  {
    key: "EXTRACT_AUDIO_SERVICE_URL",
    label: "extract-audio service URL",
    category: "endpoints",
    kind: "config",
    description:
      "Private audio-extractor endpoint n8n calls to read lesson video/audio directly in GCS; confirm the deployment hostname before setting it.",
    example: "http://audio-extractor.internal:3000/extract-audio-gcs",
  },
  {
    key: "HUB_INTERNAL_URL",
    label: "hub internal base URL",
    category: "endpoints",
    kind: "config",
    description:
      "Server-only hub base URL used for internal callbacks such as extract-audio, so private-network callers do not need the public hostname.",
    example: "http://hub.internal:3000",
  },
  {
    key: "TWILIO_ACCOUNT_SID",
    label: "Twilio account SID",
    category: "comms",
    kind: "config",
    description: "Twilio account identifier used for messaging, voice access tokens, and recordings.",
    example: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "TWILIO_AUTH_TOKEN",
    label: "Twilio auth token",
    category: "comms",
    kind: "secret",
    description: "Private Twilio credential used by the API client and to verify webhook signatures.",
    example: "0123456789abcdef0123456789abcdef",
  },
  {
    key: "TWILIO_PHONE_NUMBER",
    label: "Twilio phone number",
    category: "comms",
    kind: "config",
    description: "E.164 Twilio number used to send messages and receive routed inbound calls.",
    example: "+14155550123",
  },
  {
    key: "TWILIO_API_KEY_SID",
    label: "Twilio API key SID",
    category: "comms",
    kind: "config",
    description: "Twilio API key identifier used to mint browser softphone access tokens.",
    example: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    key: "TWILIO_API_KEY_SECRET",
    label: "Twilio API key secret",
    category: "comms",
    kind: "secret",
    description: "Private Twilio API key material used to sign browser softphone access tokens.",
    example: "0123456789abcdef0123456789abcdef",
  },
  {
    key: "TWILIO_TWIML_APP_SID",
    label: "Twilio TwiML app SID",
    category: "comms",
    kind: "config",
    description: "Twilio TwiML application identifier assigned to browser softphone voice grants.",
    example: "AP0123456789abcdef0123456789abcdef",
  },
  {
    key: "VAPI_API_KEY",
    label: "Vapi API key",
    category: "comms",
    kind: "secret",
    description: "Private Vapi credential used to create outbound AI calls.",
    example: "vapi-private-key-0123456789abcdef",
  },
  {
    key: "VAPI_PHONE_NUMBER_ID",
    label: "Vapi outbound phone number ID",
    category: "comms",
    kind: "config",
    description: "Vapi phone-number resource identifier used when placing outbound AI calls.",
    example: "6f8f5d4c-3b2a-1908-7654-3210fedcba98",
  },
  {
    key: "VAPI_DEFAULT_ASSISTANT_ID",
    label: "Vapi default assistant ID",
    category: "comms",
    kind: "config",
    description: "Default Vapi assistant resource identifier for calls without an explicit override.",
    example: "12345678-90ab-cdef-1234-567890abcdef",
  },
  {
    key: "VAPI_WEBHOOK_SECRET",
    label: "Vapi webhook secret",
    category: "comms",
    kind: "secret",
    description: "Shared secret required in the x-vapi-secret header on inbound Vapi webhooks.",
    example: "a-long-random-webhook-secret",
  },
  {
    key: "INBOUND_ROUTE_CHAIN",
    label: "Inbound route chain",
    category: "comms",
    kind: "config",
    description: "Ordered, unique JSON array of enabled inbound routing steps.",
    example: '["owner","closers","vapi","forward"]',
  },
  {
    key: "CLOSER_RING_STRATEGY",
    label: "Closer ring strategy",
    category: "comms",
    kind: "config",
    description: "Controls whether available closers ring together or sequentially by least recent answer.",
    example: "simulring",
  },
  {
    key: "INBOUND_FORWARD_NUMBER",
    label: "Inbound fallback number",
    category: "comms",
    kind: "config",
    description: "E.164 fallback destination; must never equal TWILIO_PHONE_NUMBER because that creates a call loop.",
    example: "+14155550124",
  },
  {
    key: "VAPI_INBOUND_NUMBER",
    label: "Vapi inbound number",
    category: "comms",
    kind: "config",
    description: "E.164 Vapi destination for the inbound chain; must never equal TWILIO_PHONE_NUMBER because that creates a call loop.",
    example: "+14155550125",
  },
  {
    key: "SMS_TRANSACTIONAL_ENABLED",
    label: "Transactional SMS enabled",
    category: "comms",
    kind: "config",
    description:
      "Set to true after Twilio approves the A2P campaign to let cohort messages send their SMS step; anything else sends email only.",
    example: "true",
  },
] as const;

export const KNOWN_INTEGRATION_KEYS_BY_KEY = new Map(
  KNOWN_INTEGRATION_KEYS.map((entry) => [entry.key, entry] as const)
);
