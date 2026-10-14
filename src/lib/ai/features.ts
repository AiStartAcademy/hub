export const DEFAULT_MODEL = "google/gemini-2.5-flash";

export const AI_FEATURES = [
  {
    key: "lead_brief",
    label: "Lead brief",
    defaultModel: DEFAULT_MODEL,
  },
  {
    key: "email_draft",
    label: "Email draft",
    defaultModel: DEFAULT_MODEL,
  },
] as const;

export type AiFeature = (typeof AI_FEATURES)[number]["key"];

export function aiModelSecretKey(feature: AiFeature): string {
  return `AI_MODEL_${feature.toUpperCase()}`;
}
