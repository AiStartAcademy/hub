// src/lib/leads/brief.ts
//
// The AI lead brief shown on the lead profile: who this person is, what their
// engagement says, and one concrete next action.
//
// Design constraints that matter:
//  - Generated ON DEMAND only. Never on page load — opening a record shouldn't
//    cost an LLM call or wait on one.
//  - Cached on the Contact so re-opening the page is free.
//  - Grounded strictly in the data passed in. The prompt forbids inventing facts,
//    because a fabricated detail here goes straight into a sales call.

import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { chatComplete } from "@/lib/inference";
import { getLeadTimeline } from "@/lib/leads/timeline";
import { findUserIdForContact, getTrackRecord } from "@/lib/trackRecord";

export type LeadBrief = {
  summary: string;
  engagement: string;
  nextAction: string;
  generatedAt: string;
};

const SYSTEM_PROMPT = `You are a sales assistant for ${brand.name}, which runs
in-person and online AI automation bootcamps in ${brand.address.city}.

You are given everything known about one lead. Write a short brief for the person
about to contact them.

Hard rules:
- Use ONLY the facts provided. Never invent a job title, company, goal, or history.
- If the data is thin, say so plainly ("little known beyond the signup") rather
  than padding with plausible-sounding filler.
- Be concrete and specific. No marketing language, no hype.
- Opens are unreliable signals (mail privacy inflates them); clicks and form
  answers are trustworthy. Weight them accordingly.

Reply with JSON exactly of this shape:
{
  "summary": "2-3 sentences: who this lead is and what they want, from their answers.",
  "engagement": "1-2 sentences: what their activity shows about interest level.",
  "nextAction": "One specific next step for the rep, in one sentence."
}`;

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Everything the model gets, as plain readable text. */
export async function buildLeadContext(contactId: string): Promise<string | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      dripEnrollments: {
        orderBy: { enrolledAt: "desc" },
        take: 5,
        select: { status: true, lastStepOrder: true, exitReason: true, campaign: { select: { name: true } } },
      },
      events: {
        where: { onboardingResponseId: { not: null } },
        select: { onboardingResponseId: true },
        take: 5,
      },
      contactNotes: { orderBy: { createdAt: "desc" }, take: 10, select: { body: true, authorLabel: true } },
    },
  });
  if (!contact) return null;

  const [timeline, engagement, responses] = await Promise.all([
    getLeadTimeline(contactId, { take: 30 }),
    prisma.emailEvent.groupBy({ by: ["type"], where: { contactId }, _count: { _all: true } }),
    prisma.onboardingResponse.findMany({
      where: {
        id: {
          in: contact.events.map((e) => e.onboardingResponseId).filter((v): v is string => Boolean(v)),
        },
      },
      include: {
        form: {
          include: {
            steps: {
              orderBy: { order: "asc" },
              include: {
                elements: {
                  orderBy: { order: "asc" },
                  include: { options: { orderBy: { order: "asc" } } },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const lines: string[] = [];
  lines.push(`Name: ${contact.name || "unknown"}`);
  lines.push(`Email: ${contact.email}`);
  if (contact.phone) lines.push(`Phone: on file`);
  lines.push(`Pipeline status: ${contact.status}`);
  lines.push(`Source: ${contact.source ?? "unknown"}`);
  lines.push(`Added: ${contact.createdAt.toISOString().slice(0, 10)}`);
  if (contact.unsubscribedAt) lines.push(`UNSUBSCRIBED — do not suggest emailing them.`);

  const tags = safeJson<string[]>(contact.tags, []);
  if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);

  const attribution = safeJson<Record<string, string>>(contact.attribution, {});
  if (attribution.utm_campaign || attribution.utm_source) {
    lines.push(
      `Came from ad: ${[attribution.utm_source, attribution.utm_medium, attribution.utm_campaign]
        .filter(Boolean)
        .join(" / ")}`
    );
  }

  for (const r of responses) {
    const answers = safeJson<Record<string, string | string[]>>(r.answers, {});
    lines.push(`\nQuiz "${r.form.title}":`);
    for (const step of r.form.steps) {
      for (const el of step.elements) {
        const raw = answers[el.id];
        if (raw === undefined || raw === null) continue;
        const values = Array.isArray(raw) ? raw : [raw];
        const labels = values.map((v) => el.options.find((o) => o.id === v)?.text ?? v);
        lines.push(`- ${el.label}: ${labels.join(", ")}`);
      }
    }
  }

  if (contact.dripEnrollments.length) {
    lines.push(`\nDrip campaigns:`);
    for (const e of contact.dripEnrollments) {
      lines.push(
        `- ${e.campaign.name}: ${e.status}, ${e.lastStepOrder} steps sent${e.exitReason ? ` (${e.exitReason})` : ""}`
      );
    }
  }

  const countOf = (t: string) => engagement.find((g) => g.type === t)?._count._all ?? 0;
  lines.push(
    `\nEmail engagement: ${countOf("SENT")} sent, ${countOf("OPENED")} opened, ${countOf("CLICKED")} clicked.`
  );

  const userId = await findUserIdForContact({
    userId: contact.userId,
    email: contact.email,
  });
  if (userId) {
    const record = await getTrackRecord(userId);
    if (record) {
      lines.push(
        `\nHas a hub account: ${record.enrollments.length} cohort(s), ` +
          `${record.lessons.completed} lessons completed, ${record.certificates.length} certificate(s).`
      );
      for (const e of record.enrollments) lines.push(`- Cohort ${e.cohortTitle} (${e.status})`);
    }
  } else {
    lines.push(`\nNo hub account matches this email.`);
  }

  if (contact.contactNotes.length) {
    lines.push(`\nStaff notes:`);
    for (const n of contact.contactNotes) lines.push(`- ${n.authorLabel}: ${n.body}`);
  }

  if (timeline.items.length) {
    lines.push(`\nRecent activity (newest first):`);
    for (const item of timeline.items.slice(0, 20)) {
      lines.push(`- ${item.at.slice(0, 10)} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generates and caches a brief. Throws on a genuine failure (no API key, provider
 * error, unusable response) so the caller can surface it — silently storing an
 * empty brief would look like the lead simply has nothing to say about them.
 */
export async function generateLeadBrief(contactId: string): Promise<LeadBrief> {
  const context = await buildLeadContext(contactId);
  if (!context) throw new Error("Lead not found");

  const raw = await chatComplete({
    feature: "lead_brief",
    system: SYSTEM_PROMPT,
    user: context,
    json: true,
  });

  const parsed = safeJson<Record<string, unknown>>(raw, {});
  const brief: LeadBrief = {
    summary: str(parsed.summary, 1200),
    engagement: str(parsed.engagement, 800),
    nextAction: str(parsed.nextAction, 600),
    generatedAt: new Date().toISOString(),
  };

  if (!brief.summary && !brief.engagement && !brief.nextAction) {
    throw new Error("The model returned no usable brief");
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: { aiBrief: JSON.stringify(brief), aiBriefAt: new Date() },
  });

  return brief;
}

/** Reads the cached brief, or null if none has been generated. */
export function parseStoredBrief(raw: string | null | undefined): LeadBrief | null {
  if (!raw) return null;
  const parsed = safeJson<Partial<LeadBrief> | null>(raw, null);
  if (!parsed || typeof parsed !== "object") return null;
  return {
    summary: str(parsed.summary, 1200),
    engagement: str(parsed.engagement, 800),
    nextAction: str(parsed.nextAction, 600),
    generatedAt: str(parsed.generatedAt, 40),
  };
}
