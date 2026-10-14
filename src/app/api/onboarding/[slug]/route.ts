import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  ATTRIBUTION_COOKIE,
  SEGMENT_COOKIE,
  parseAttributionCookie,
} from "@/lib/attribution";
import { captureOnboardingLead } from "@/lib/onboarding-leads";
import { contextFromRequest, dispatchConversion } from "@/lib/serverConversions";
import {
  LEAD_EMAIL_COOKIE,
  LEAD_NAME_COOKIE,
  leadCookieOptions,
} from "@/lib/lead-cookie";
import { parseFieldMapping, resolveFieldMapping } from "@/lib/onboarding-fields";
import {
  normalizeEmail,
  normalizePhone,
  parseAndValidateAnswers,
  safeRedirectUrl,
  sanitizePlainText,
} from "@/lib/onboarding-security";
import { logger } from "@/lib/logger";
import {
  hasAnyPhoneConsent,
  parseOnboardingPhoneConsent,
} from "@/lib/onboarding-phone-consent";

// Maps answer IDs to their text
function resolveAnswer(
  el: { type: string; label: string; options: { id: string; text: string }[] },
  raw: string | string[] | undefined
): string {
  if (raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return "";
  if (el.type === "text_single" || el.type === "text_multi" || el.type === "phone") {
    return String(raw);
  }
  if (el.type === "single_choice") {
    const opt = el.options.find((o) => o.id === raw);
    return opt ? opt.text : String(raw);
  }
  if (el.type === "multiple_choice") {
    const ids = Array.isArray(raw) ? raw : [raw];
    return ids.map((id) => el.options.find((o) => o.id === id)?.text ?? id).join(", ");
  }
  return String(raw);
}

type AnalysisForm = {
  aiPrompt: string | null;
  steps: Array<{
    elements: Array<{
      id: string;
      type: string;
      label: string;
      options: Array<{ id: string; text: string }>;
    }>;
  }>;
};

// Background analysis job via OpenRouter
async function processAiAnalysis(responseId: string, form: AnalysisForm, answers: Record<string, string | string[]>) {
  logger.info(`[AI Analysis] Starting background task for response: ${responseId}`);
  try {
    // 1. Load the available (open) courses
    const programs = await prisma.program.findMany({
      where: { status: "open" },
      select: { id: true, name: true, description: true },
    });

    const catalogContext = programs.map(p =>
      `ID: ${p.id} | Name: ${sanitizePlainText(p.name, 200)} | Description: ${sanitizePlainText(p.description || "No description", 2000)}`
    ).join("\n");

    // 2. Collect the user's answers
    const allElements = form.steps.flatMap((step) => step.elements);
    let humanReadableAnswers = "";

    for (const el of allElements) {
      const answeredText = resolveAnswer(el, answers[el.id]);
      if (answeredText) {
        humanReadableAnswers += `Question: ${sanitizePlainText(el.label, 300)}\nAnswer: ${sanitizePlainText(answeredText, 5000, { multiline: true })}\n\n`;
      }
    }

    // 3. Build a strict prompt that requires JSON output
    const systemPrompt = `
      You are an expert career advisor and course recommendation engine.
      ${sanitizePlainText(form.aiPrompt || "", 10000, { multiline: true })}
      
      Analyze the user's answers and recommend the most suitable courses from the CATALOG.
      You can recommend 1 to 3 courses, but only if they genuinely fit the user's profile. Rank them from most suitable to least.
      
      CATALOG:
      ${catalogContext || "No active courses found."}

      Respond strictly in valid JSON format matching this schema:
      {
        "recommendations": [
          {
            "programId": "string",
            "programName": "string",
            "matchPercentage": "number (e.g. 95)",
            "reasoning": "string (Explain directly to the user why this specific course fits their answers. 2-3 sentences max.)"
          }
        ]
      }
    `;

    logger.info(`[AI Analysis] Calling OpenRouter for response: ${responseId}`);
    
    // OpenRouter request
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash", // Good speed/quality balance
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `User Answers:\n\n${humanReadableAnswers}` },
        ],
        response_format: { type: "json_object" }, // Force JSON
      }),
    });

    if (!res.ok) {
       const err = await res.text();
       throw new Error(`OpenRouter API error: ${err}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter returned no JSON content.");
    let aiResultText = content;

    // Strip Markdown fences (```json ... ```) in case the AI still adds them
    aiResultText = aiResultText.replace(/^```json\s*/i, "").replace(/```$/g, "").trim();

    const parsed = JSON.parse(aiResultText) as { recommendations?: unknown };
    const catalogById = new Map(programs.map((program) => [program.id, program]));
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.flatMap((candidate) => {
          if (!candidate || typeof candidate !== "object") return [];
          const raw = candidate as Record<string, unknown>;
          if (typeof raw.programId !== "string") return [];
          const program = catalogById.get(raw.programId);
          if (!program) return [];
          const percentage = Number(raw.matchPercentage);
          return [{
            programId: program.id,
            programName: sanitizePlainText(program.name, 200),
            matchPercentage: Number.isFinite(percentage)
              ? Math.max(0, Math.min(100, Math.round(percentage)))
              : 0,
            reasoning: sanitizePlainText(raw.reasoning, 1000, { multiline: true }),
          }];
        }).slice(0, 3)
      : [];
    aiResultText = JSON.stringify({ recommendations });

    await prisma.onboardingResponse.update({
      where: { id: responseId },
      data: { 
        aiResult: aiResultText, // Stored as a JSON string
        status: "COMPLETED" 
      },
    });

    logger.info(`[AI Analysis] Successfully completed for response: ${responseId}`);
  } catch (error) {
    logger.error({ err: error }, `[AI Analysis] Failed for response ${responseId}:`);
    await prisma.onboardingResponse.update({
      where: { id: responseId },
      data: { status: "ERROR" },
    });
  }
}

// POST handler
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415 }
    );
  }
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }
  
  const form = await prisma.onboardingForm.findUnique({
    where: { slug },
    include: {
      tagMappings: true,
      steps: {
        orderBy: { order: "asc" },
        include: {
          elements: {
            orderBy: { order: "asc" },
            include: { options: true },
          },
        },
      },
    },
  });

  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const elements = form.steps.flatMap((step) => step.elements);
  const rawBody = await req.text();
  const fieldMapping = resolveFieldMapping(
    elements,
    parseFieldMapping(form.ghlFieldMapping)
  );
  let bodyForValidation = rawBody;
  let phoneConsent = parseOnboardingPhoneConsent(undefined);
  try {
    const submitted: unknown = JSON.parse(rawBody);
    if (submitted && typeof submitted === "object" && !Array.isArray(submitted)) {
      const body = submitted as Record<string, unknown>;
      phoneConsent = parseOnboardingPhoneConsent(body.phoneConsent);
      if (!hasAnyPhoneConsent(phoneConsent)) {
        const rawAnswers = body.answers;
        if (rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)) {
          bodyForValidation = JSON.stringify({
            ...body,
            answers: {
              ...(rawAnswers as Record<string, unknown>),
              ...(fieldMapping.phone ? { [fieldMapping.phone]: "" } : {}),
            },
          });
        }
      }
    }
  } catch {
    // parseAndValidateAnswers below owns the stable invalid-JSON response.
  }
  const validation = parseAndValidateAnswers(bodyForValidation, elements);
  if ("error" in validation) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status }
    );
  }
  const answers = validation.answers;
  if (fieldMapping.email && typeof answers[fieldMapping.email] === "string") {
    const rawEmail = answers[fieldMapping.email] as string;
    const email = normalizeEmail(rawEmail);
    if (rawEmail && !email) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }
    answers[fieldMapping.email] = email ?? "";
  }
  if (fieldMapping.phone && typeof answers[fieldMapping.phone] === "string") {
    const mappedPhoneElement = elements.find((element) => element.id === fieldMapping.phone);
    if (mappedPhoneElement?.type !== "phone") {
      const rawPhone = answers[fieldMapping.phone] as string;
      const phone = normalizePhone(rawPhone);
      if (rawPhone && !phone) {
        return NextResponse.json(
          { error: "Please enter a valid phone number." },
          { status: 400 }
        );
      }
      answers[fieldMapping.phone] = phone ?? "";
    }
  }

  const tagCounts: Record<string, number> = Object.create(null);
  const selectedOptions = form.steps.flatMap((step, stepIndex) =>
    step.elements.flatMap((element, elementIndex) => {
      const rawAnswer = answers[element.id];
      const selectedIds = Array.isArray(rawAnswer)
        ? rawAnswer
        : typeof rawAnswer === "string" &&
            ["single_choice", "multiple_choice"].includes(element.type)
          ? [rawAnswer]
          : [];
      return element.options
        .filter((option) => selectedIds.includes(option.id))
        .map((option) => ({
          ...option,
          elementId: element.id,
          stepIndex,
          elementIndex,
        }));
    })
  );

  if (selectedOptions.length > 0) {
    for (const opt of selectedOptions) {
      if (opt.tag) tagCounts[opt.tag] = (tagCounts[opt.tag] || 0) + 1;
    }
  }

  const latestTagPosition = new Map<
    string,
    { stepIndex: number; elementIndex: number; optionOrder: number }
  >();
  for (const option of selectedOptions) {
    if (!option.tag) continue;
    const next = {
      stepIndex: option.stepIndex,
      elementIndex: option.elementIndex,
      optionOrder: option.order,
    };
    const current = latestTagPosition.get(option.tag);
    if (
      !current ||
      next.stepIndex > current.stepIndex ||
      (next.stepIndex === current.stepIndex &&
        (next.elementIndex > current.elementIndex ||
          (next.elementIndex === current.elementIndex &&
            next.optionOrder > current.optionOrder)))
    ) {
      latestTagPosition.set(option.tag, next);
    }
  }
  const rankedTags = Object.entries(tagCounts).sort(([tagA, countA], [tagB, countB]) => {
    if (countA !== countB) return countB - countA;
    const a = latestTagPosition.get(tagA);
    const b = latestTagPosition.get(tagB);
    return (
      (b?.stepIndex ?? -1) - (a?.stepIndex ?? -1) ||
      (b?.elementIndex ?? -1) - (a?.elementIndex ?? -1) ||
      (b?.optionOrder ?? -1) - (a?.optionOrder ?? -1) ||
      tagA.localeCompare(tagB)
    );
  });
  const winningTag = rankedTags[0]?.[0] ?? null;

  // Explicit answer routing is preferred. Existing tag mappings remain a
  // deterministic fallback so deployed forms keep working during migration.
  let cohortId: string | null = null;
  const routingOption = form.routingElementId
    ? selectedOptions.find((option) => option.elementId === form.routingElementId)
    : null;
  let redirectUrl =
    safeRedirectUrl(routingOption?.redirectUrl) ??
    safeRedirectUrl(form.defaultRedirectUrl);

  if (!redirectUrl) {
    const mappingsByTag = new Map(
      form.tagMappings.map((mapping) => [mapping.tag, mapping])
    );
    const legacyMapping = rankedTags
      .map(([tag]) => mappingsByTag.get(tag))
      .find((mapping) => !!mapping);
    const legacyRedirectUrl = safeRedirectUrl(legacyMapping?.url);
    if (legacyRedirectUrl) redirectUrl = legacyRedirectUrl;
    else if (legacyMapping?.cohortId) cohortId = legacyMapping.cohortId;
  }

  const requiresAiAnalysis = !!form.aiPrompt && !redirectUrl && !cohortId;

  // Marketing attribution captured on landing (first-touch cookie).
  const attribution = parseAttributionCookie(req.cookies.get(ATTRIBUTION_COOKIE)?.value);

  const response = await prisma.onboardingResponse.create({
    data: {
      formId: form.id,
      answers: JSON.stringify(answers),
      tagCounts: JSON.stringify(tagCounts),
      cohortId,
      status: requiresAiAnalysis ? "PROCESSING" : "COMPLETED",
      attribution: attribution ? JSON.stringify(attribution) : null,
    },
  });

  // Explicit mappings win; common labels (First name, Last Name, Email, etc.)
  // are inferred when a legacy form has no mapping configured.
  let leadCaptureResult:
    | Awaited<ReturnType<typeof captureOnboardingLead>>
    | null = null;

  try {
    // No explicit timeout: this is same-database ingestion work and is bounded by
    // the route request lifecycle, while failures remain non-blocking for onboarding.
    leadCaptureResult = await captureOnboardingLead({
      form,
      responseId: response.id,
      answers,
      tags: Object.keys(tagCounts),
      attribution,
      destination: redirectUrl ?? (cohortId ? `/cohorts/${cohortId}` : null),
      phoneConsent,
    });
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : "Unknown lead capture error"},
      "[onboarding] lead capture failed:"
      
    );
  }

  // Report the conversion server-side to GA4 + Meta. The browser also pushes
  // `generate_lead` to the dataLayer (OnboardingPlayer), but no GTM tag forwards it
  // today, which is why Meta's Lead count has been zero against real paid traffic.
  // Both carry the same response id, so GA4 (`transaction_id`) and Meta (`event_id`)
  // collapse them into one conversion if the browser tag is ever wired up too.
  // Not awaited: the submitter should not wait on two outbound HTTP calls, and
  // dispatchConversion never rejects.
  void dispatchConversion(
    {
      name: "generate_lead",
      eventId: response.id,
      params: {
        conversion_kind: "onboarding_quiz",
        form_slug: form.slug,
        form_name: form.title,
        segment: winningTag || undefined,
      },
    },
    contextFromRequest(req, {
      email: fieldMapping.email ? (answers[fieldMapping.email] as string) : undefined,
      phone: fieldMapping.phone ? (answers[fieldMapping.phone] as string) : undefined,
    })
  );

  if (requiresAiAnalysis) {
    // Run in the background
    processAiAnalysis(response.id, form, answers).catch(logger.error);
  }

  const result = NextResponse.json({
    responseId: response.id,
    cohortId,
    redirectUrl,
    status: response.status,
    segment: winningTag,
  });

  const safeSegment = sanitizePlainText(winningTag, 100);
  if (safeSegment) {
    result.cookies.set(SEGMENT_COOKIE, safeSegment, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }

  if (leadCaptureResult?.ok) {
    result.cookies.set(LEAD_EMAIL_COOKIE, leadCaptureResult.email, leadCookieOptions);
    if (leadCaptureResult.name !== "Lead") {
      result.cookies.set(LEAD_NAME_COOKIE, leadCaptureResult.name, leadCookieOptions);
    }
  }

  return result;
}
