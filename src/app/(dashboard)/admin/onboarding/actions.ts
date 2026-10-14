"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { captureOnboardingLead } from "@/lib/onboarding-leads";
import type { OnboardingFieldMapping } from "@/lib/onboarding-fields";
import { parseAttributionCookie } from "@/lib/attribution";
import type { GHLContactPayload } from "@/lib/ghl";
import {
  ONBOARDING_ELEMENT_TYPES,
  normalizeEmail,
  normalizePhone,
  normalizeRedirectUrl,
  normalizeSlug,
  sanitizePlainText,
} from "@/lib/onboarding-security";
import { hasRole, hasAnyRole } from "@/lib/roles";
import {
  deriveStepSlug,
  normalizeStepSlug,
} from "@/app/onboarding/[slug]/onboardingStepParams";

async function isAdmin() {
  const session = await auth();
  return hasRole(session?.user, "ADMIN");
}

async function isStaff() {
  const session = await auth();
  return hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"]);
}

function requiredPlainText(value: unknown, maxLength: number, field: string) {
  const sanitized = sanitizePlainText(value, maxLength);
  if (!sanitized) throw new Error(`${field} is required.`);
  return sanitized;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function createOnboardingForm(data: { title: string; description?: string; slug: string }) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  const form = await prisma.onboardingForm.create({
    data: {
      title: requiredPlainText(data.title, 200, "Title"),
      description: sanitizePlainText(data.description, 2000, { multiline: true }) || null,
      slug: normalizeSlug(data.slug),
    },
  });
  revalidatePath("/admin/onboarding");
  return form;
}

export async function updateOnboardingForm(id: string, data: {
  title?: string;
  description?: string;
  slug?: string;
  aiPrompt?: string | null;
  routingElementId?: string | null;
  defaultRedirectUrl?: string | null;
}) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  if (data.routingElementId) {
    const routingElement = await prisma.onboardingElement.findUnique({
      where: { id: data.routingElementId },
      select: { type: true, step: { select: { formId: true } } },
    });
    if (
      !routingElement ||
      routingElement.type !== "single_choice" ||
      routingElement.step.formId !== id
    ) {
      throw new Error("The redirect question must be a single-choice field from this form.");
    }
  }

  const form = await prisma.onboardingForm.update({
    where: { id },
    data: {
      ...(data.title !== undefined
        ? { title: requiredPlainText(data.title, 200, "Title") }
        : {}),
      ...(data.description !== undefined
        ? {
            description:
              sanitizePlainText(data.description, 2000, { multiline: true }) || null,
          }
        : {}),
      ...(data.slug !== undefined ? { slug: normalizeSlug(data.slug) } : {}),
      ...(data.aiPrompt !== undefined
        ? {
            aiPrompt:
              sanitizePlainText(data.aiPrompt, 10000, { multiline: true }) || null,
          }
        : {}),
      ...(data.routingElementId !== undefined
        ? { routingElementId: data.routingElementId || null }
        : {}),
      ...(data.defaultRedirectUrl !== undefined
        ? { defaultRedirectUrl: normalizeRedirectUrl(data.defaultRedirectUrl) }
        : {}),
    },
  });
  revalidatePath("/admin/onboarding");
  revalidatePath(`/admin/onboarding/${id}/edit`);
  return form;
}

export async function deleteOnboardingForm(id: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  await prisma.onboardingForm.delete({ where: { id } });
  revalidatePath("/admin/onboarding");
}

export async function getOnboardingForm(id: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  return prisma.onboardingForm.findUnique({
    where: { id },
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
      tagMappings: { include: { cohort: true } },
    },
  });
}

export async function getOnboardingForms() {
  if (!(await isStaff())) throw new Error("Unauthorized");
  return prisma.onboardingForm.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      steps: {
        select: {
          id: true,
          title: true,
          elements: {
            select: { id: true, label: true, type: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
      responses: { select: { id: true } },
    },
  });
}

// Steps
export async function createStep(formId: string, title: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  const existingSteps = await prisma.onboardingStep.findMany({
    where: { formId },
    orderBy: { order: "desc" },
    select: { order: true, slug: true },
  });
  const sanitizedTitle = sanitizePlainText(title, 200) || "Untitled Step";
  const slug = deriveStepSlug(
    sanitizedTitle,
    existingSteps.flatMap((step) => (step.slug ? [step.slug] : []))
  );

  let step;
  try {
    step = await prisma.onboardingStep.create({
      data: {
        formId,
        title: sanitizedTitle,
        slug,
        order: (existingSteps[0]?.order ?? -1) + 1,
      },
    });
  } catch (error) {
    // P2002 is the composite formId/slug uniqueness constraint; all other failures propagate.
    if (isUniqueConstraintError(error)) {
      throw new Error("That step slug is already used in this form.");
    }
    throw error;
  }
  revalidatePath(`/admin/onboarding/${formId}/edit`);
  return step;
}

export async function updateStep(
  id: string,
  data: { title?: string; slug?: string | null }
) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  const updateData: { title?: string; slug?: string | null } = {};
  if (data.title !== undefined) {
    updateData.title = sanitizePlainText(data.title, 200) || "Untitled Step";
  }
  if (data.slug !== undefined) {
    updateData.slug = data.slug === null ? null : normalizeStepSlug(data.slug);
  }

  try {
    return await prisma.onboardingStep.update({
      where: { id },
      data: updateData,
    });
  } catch (error) {
    // P2002 is the composite formId/slug uniqueness constraint; all other failures propagate.
    if (isUniqueConstraintError(error)) {
      throw new Error("That step slug is already used in this form.");
    }
    throw error;
  }
}

export async function deleteStep(id: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  await prisma.onboardingStep.delete({ where: { id } });
}

export async function reorderSteps(formId: string, steps: { id: string; order: number }[]) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  if (steps.length > 100 || steps.some((step) => !Number.isInteger(step.order))) {
    throw new Error("Invalid step order.");
  }
  const ownedSteps = await prisma.onboardingStep.count({
    where: { formId, id: { in: steps.map((step) => step.id) } },
  });
  if (ownedSteps !== steps.length) throw new Error("A step does not belong to this form.");
  await Promise.all(
    steps.map((s) => prisma.onboardingStep.update({ where: { id: s.id }, data: { order: s.order } }))
  );
}

// Elements
export async function createElement(stepId: string, data: { type: string; label: string; required?: boolean }) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  if (!ONBOARDING_ELEMENT_TYPES.includes(data.type as (typeof ONBOARDING_ELEMENT_TYPES)[number])) {
    throw new Error("Invalid onboarding field type.");
  }
  const last = await prisma.onboardingElement.findFirst({ where: { stepId }, orderBy: { order: "desc" } });
  return prisma.onboardingElement.create({
    data: {
      stepId,
      type: data.type,
      label: sanitizePlainText(data.label, 300) || "New Question",
      required: data.required ?? false,
      order: last ? last.order + 1 : 0,
    },
  });
}

export async function updateElement(id: string, data: { label?: string; type?: string; required?: boolean }) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  if (
    data.type !== undefined &&
    !ONBOARDING_ELEMENT_TYPES.includes(data.type as (typeof ONBOARDING_ELEMENT_TYPES)[number])
  ) {
    throw new Error("Invalid onboarding field type.");
  }
  const element = await prisma.onboardingElement.update({
    where: { id },
    data: {
      ...(data.label !== undefined
        ? { label: sanitizePlainText(data.label, 300) || "New Question" }
        : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.required !== undefined ? { required: data.required } : {}),
    },
  });
  if (data.type && data.type !== "single_choice") {
    await prisma.onboardingForm.updateMany({ where: { routingElementId: id }, data: { routingElementId: null } });
  }
  return element;
}

export async function deleteElement(id: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  await prisma.onboardingElement.delete({ where: { id } });
}

// Options
export async function createOption(elementId: string, data: { text: string; tag: string }) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  const last = await prisma.onboardingOption.findFirst({ where: { elementId }, orderBy: { order: "desc" } });
  return prisma.onboardingOption.create({
    data: {
      elementId,
      text: sanitizePlainText(data.text, 500) || "New Option",
      tag: sanitizePlainText(data.tag, 100),
      order: last ? last.order + 1 : 0,
    },
  });
}

export async function updateOption(id: string, data: { text?: string; tag?: string; nextStepId?: string | null; redirectUrl?: string | null }) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  if (data.nextStepId) {
    const [option, targetStep] = await Promise.all([
      prisma.onboardingOption.findUnique({
        where: { id },
        select: { element: { select: { step: { select: { formId: true } } } } },
      }),
      prisma.onboardingStep.findUnique({
        where: { id: data.nextStepId },
        select: { formId: true },
      }),
    ]);
    if (!option || !targetStep || option.element.step.formId !== targetStep.formId) {
      throw new Error("The target step must belong to the same onboarding form.");
    }
  }
  const payload: { text?: string; tag?: string; nextStepId?: string | null; redirectUrl?: string | null } = {};
  if (data.text !== undefined) payload.text = sanitizePlainText(data.text, 500) || "New Option";
  if (data.tag !== undefined) payload.tag = sanitizePlainText(data.tag, 100);
  if ("nextStepId" in data) payload.nextStepId = data.nextStepId ?? null;
  if ("redirectUrl" in data) payload.redirectUrl = normalizeRedirectUrl(data.redirectUrl);
  return prisma.onboardingOption.update({ where: { id }, data: payload });
}

export async function deleteOption(id: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  await prisma.onboardingOption.delete({ where: { id } });
}

/** Copy the former tag destinations onto matching answer options once, so an
 * admin can finish the move to explicit answer-based routing without retyping.
 */
export async function importLegacyTagRoutes(formId: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");

  const mappings = await prisma.onboardingTagCohort.findMany({ where: { formId } });
  const destinations = new Map(
    mappings.map((mapping) => [
      mapping.tag,
      mapping.url
        ? normalizeRedirectUrl(mapping.url)
        : mapping.cohortId
          ? `/cohorts/${mapping.cohortId}`
          : null,
    ])
  );

  // SQLite/Prisma cannot assign a different value per row in updateMany.
  const options = await prisma.onboardingOption.findMany({
    where: { element: { step: { formId } } },
    select: { id: true, tag: true },
  });
  const updates = options.flatMap((option) => {
    const redirectUrl = destinations.get(option.tag);
    return redirectUrl
      ? [prisma.onboardingOption.update({ where: { id: option.id }, data: { redirectUrl } })]
      : [];
  });
  await prisma.$transaction(updates);
  revalidatePath(`/admin/onboarding/${formId}/edit`);
  return { imported: updates.length };
}

const responseInclude = {
  cohort: true,
  form: {
    include: {
      steps: {
        orderBy: { order: "asc" as const },
        include: {
          elements: {
            orderBy: { order: "asc" as const },
            include: { options: { orderBy: { order: "asc" as const } } },
          },
        },
      },
    },
  },
};

export async function getOnboardingResponses(formId: string) {
  if (!(await isStaff())) throw new Error("Unauthorized");
  return prisma.onboardingResponse.findMany({
    where: { formId },
    orderBy: { createdAt: "desc" },
    include: responseInclude,
  });
}

export async function getAllOnboardingResponses() {
  if (!(await isStaff())) throw new Error("Unauthorized");
  return prisma.onboardingResponse.findMany({
    orderBy: { createdAt: "desc" },
    include: responseInclude,
  });
}

export async function deleteOnboardingResponse(id: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  await prisma.onboardingResponse.delete({ where: { id } });
  revalidatePath("/onboarding-responses");
}

// ─── GHL Integration ─────────────────────────────────────────────────────────

export async function updateGhlFieldMapping(
  formId: string,
  mapping: OnboardingFieldMapping
) {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  const normalized: OnboardingFieldMapping = {};
  for (const key of [
    "firstName",
    "lastName",
    "contactName",
    "phone",
    "email",
  ] as const) {
    const value = mapping[key];
    if (typeof value === "string" && value) normalized[key] = value;
  }
  const eligibleTypesByKey: Record<keyof OnboardingFieldMapping, string[]> = {
    firstName: ["text_single", "text_multi"],
    lastName: ["text_single", "text_multi"],
    contactName: ["text_single", "text_multi"],
    phone: ["text_single", "text_multi", "phone"],
    email: ["text_single", "text_multi"],
  };
  const ids = Object.values(normalized);
  const elements = await prisma.onboardingElement.findMany({
    where: {
      id: { in: ids },
      step: { formId },
    },
    select: { id: true, type: true },
  });
  const elementsById = new Map(elements.map((element) => [element.id, element.type]));
  for (const key of [
    "firstName",
    "lastName",
    "contactName",
    "phone",
    "email",
  ] as const) {
    const elementId = normalized[key];
    if (!elementId) continue;
    const elementType = elementsById.get(elementId);
    if (!elementType || !eligibleTypesByKey[key].includes(elementType)) {
      throw new Error("Mapped lead fields must be eligible inputs from this onboarding form.");
    }
  }
  await prisma.onboardingForm.update({
    where: { id: formId },
    data: { ghlFieldMapping: JSON.stringify(normalized) },
  });
  revalidatePath("/onboarding-responses");
}

export async function getGhlFieldMapping(formId: string) {
  if (!(await isStaff())) throw new Error("Unauthorized");
  const form = await prisma.onboardingForm.findUnique({
    where: { id: formId },
    select: { ghlFieldMapping: true },
  });
  if (!form?.ghlFieldMapping) return null;
  try {
    return JSON.parse(form.ghlFieldMapping) as OnboardingFieldMapping;
  } catch {
    return null;
  }
}

export async function syncOnboardingResponsesToLeads(formId: string) {
  if (!(await isStaff())) throw new Error("Unauthorized");
  const form = await prisma.onboardingForm.findUnique({
    where: { id: formId },
    include: {
      steps: { include: { elements: { select: { id: true, label: true, type: true } } } },
      responses: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!form) throw new Error("Form not found");

  const results: { responseId: string; ok: boolean; error?: string }[] = [];
  for (const response of form.responses) {
    try {
      const answers = JSON.parse(response.answers || "{}") as Record<
        string,
        string | string[]
      >;
      const tagCounts = JSON.parse(response.tagCounts || "{}") as Record<string, number>;
      const result = await captureOnboardingLead({
        form,
        responseId: response.id,
        answers,
        tags: Object.keys(tagCounts),
        attribution: parseAttributionCookie(response.attribution),
        destination: response.cohortId ? `/cohorts/${response.cohortId}` : null,
        occurredAt: response.createdAt,
      });
      results.push({
        responseId: response.id,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.reason }),
      });
    } catch (error) {
      results.push({
        responseId: response.id,
        ok: false,
        error: error instanceof Error ? error.message : "Lead sync failed",
      });
    }
  }
  revalidatePath("/admin/contacts");
  return results;
}

function resolveAnswer(
  el: { id: string; type: string; label: string; options: { id: string; text: string }[] },
  raw: string | string[] | undefined
): string {
  if (raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0))
    return "";
  if (el.type === "text_single" || el.type === "text_multi" || el.type === "phone") {
    return String(raw);
  }
  if (el.type === "single_choice") {
    const opt = el.options.find((o) => o.id === raw);
    return opt ? opt.text : String(raw);
  }
  if (el.type === "multiple_choice") {
    const ids = Array.isArray(raw) ? raw : [raw];
    return ids
      .map((id) => el.options.find((o) => o.id === id)?.text ?? id)
      .join(", ");
  }
  return String(raw);
}

export async function syncOnboardingToGHL(formId: string) {
  if (!(await isAdmin())) throw new Error("Unauthorized");

  const { upsertGHLContact, getLocationId } = await import("@/lib/ghl");

  const form = await prisma.onboardingForm.findUnique({
    where: { id: formId },
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
      responses: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!form) throw new Error("Form not found");

  const mapping: OnboardingFieldMapping = form.ghlFieldMapping
    ? JSON.parse(form.ghlFieldMapping)
    : {};

  // flatten elements
  const allElements = form.steps.flatMap((s) =>
    s.elements.map((el) => ({ ...el, stepTitle: s.title }))
  );

  const locationId = getLocationId();
  const results: { responseId: string; ok: boolean; error?: string }[] = [];

  for (const resp of form.responses) {
    try {
      const rawAnswers: Record<string, string | string[]> = JSON.parse(
        resp.answers || "{}"
      );

      // Extract mapped fields
      let firstName = "";
      let lastName = "";
      let contactName = "";
      let phone = "";
      let email = "";

      if (mapping.firstName) {
        const el = allElements.find((e) => e.id === mapping.firstName);
        if (el) firstName = sanitizePlainText(resolveAnswer(el, rawAnswers[el.id]), 100);
      }
      if (mapping.lastName) {
        const el = allElements.find((e) => e.id === mapping.lastName);
        if (el) lastName = sanitizePlainText(resolveAnswer(el, rawAnswers[el.id]), 100);
      }
      if (mapping.contactName) {
        const el = allElements.find((e) => e.id === mapping.contactName);
        if (el) contactName = sanitizePlainText(resolveAnswer(el, rawAnswers[el.id]), 200);
      }
      if (mapping.phone) {
        const el = allElements.find((e) => e.id === mapping.phone);
        if (el) phone = normalizePhone(resolveAnswer(el, rawAnswers[el.id])) ?? "";
      }
      if (mapping.email) {
        const el = allElements.find((e) => e.id === mapping.email);
        if (el) email = normalizeEmail(resolveAnswer(el, rawAnswers[el.id])) ?? "";
      }

      // Build onboarding data: all fields except those already mapped
      const mappedIds = new Set(
        [
          mapping.firstName,
          mapping.lastName,
          mapping.contactName,
          mapping.phone,
          mapping.email,
        ].filter(Boolean)
      );
      const onboardingData: Record<string, string> = {};
      for (const el of allElements) {
        if (mappedIds.has(el.id)) continue;
        const val = resolveAnswer(el, rawAnswers[el.id]);
        const label = sanitizePlainText(el.label, 300);
        const sanitizedValue = sanitizePlainText(val, 5000, { multiline: true });
        if (label && sanitizedValue) onboardingData[label] = sanitizedValue;
      }

      // Add metadata
      onboardingData["_submittedAt"] = resp.createdAt.toISOString();
      onboardingData["_formTitle"] = sanitizePlainText(form.title, 200);

      const tagCounts: Record<string, number> = JSON.parse(
        resp.tagCounts || "{}"
      );
      const topTag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];

      const payload: GHLContactPayload = {
        locationId,
        customFields: [
          {
            key: "onboarding_data",
            field_value: JSON.stringify(onboardingData),
          },
        ],
      };

      const safeTopTag = sanitizePlainText(topTag?.[0], 100);
      if (safeTopTag) {
        payload.tags = [safeTopTag];
      }

      const combinedName = [firstName, lastName].filter(Boolean).join(" ") || contactName;
      if (combinedName) payload.name = combinedName;
      if (phone) payload.phone = phone;
      if (email) payload.email = email;

      await upsertGHLContact(payload);
      results.push({ responseId: resp.id, ok: true });
    } catch (error) {
      results.push({
        responseId: resp.id,
        ok: false,
        error: error instanceof Error ? error.message : "GHL sync failed",
      });
    }
  }

  return results;
}
