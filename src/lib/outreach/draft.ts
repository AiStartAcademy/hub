import { brand } from "@/config/brand";
import { chatComplete } from "@/lib/inference";
import { sanitizePlainText } from "@/lib/onboarding-security";
import { buildLeadContext } from "@/lib/leads/brief";
import { sanitizeEmailHtml } from "./sanitizeHtml";
import type { OutreachEmailDraft } from "./types";

const SYSTEM_PROMPT = `You draft personal one-off sales emails for ${brand.name},
which runs in-person and online AI automation bootcamps in ${brand.address.city}.

Use only facts present in the lead context. Write concise, human copy for a staff
member to review and edit before sending. Do not claim that an open proves intent.
Use HTML paragraphs and simple allowlisted markup; do not include a document shell,
footer, tracking pixel, unsubscribe link, scripts, styles, or iframes.

Reply with JSON exactly in this shape:
{
  "subject": "A specific plain-text subject line",
  "html": "The email body as an HTML fragment"
}`;

export async function draftOutreachEmail(contactId: string): Promise<OutreachEmailDraft> {
  const context = await buildLeadContext(contactId);
  if (!context) throw new Error("Lead not found");

  const raw = await chatComplete({
    feature: "email_draft",
    system: SYSTEM_PROMPT,
    user: context,
    json: true,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("The model returned invalid JSON for the outreach draft");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The model returned an invalid outreach draft object");
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.subject !== "string" || typeof candidate.html !== "string") {
    throw new Error("The model response must contain string subject and html fields");
  }

  const subject = sanitizePlainText(candidate.subject, 200);
  const html = sanitizeEmailHtml(candidate.html);
  if (!subject) throw new Error("The model returned an empty outreach subject");
  if (!sanitizePlainText(html, 50_000, { multiline: true })) {
    throw new Error("The model returned an empty outreach email body");
  }

  return { subject, html };
}
