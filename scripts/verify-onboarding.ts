import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/onboarding/[slug]/route";
import { captureOnboardingLead } from "@/lib/onboarding-leads";
import {
  normalizeRedirectUrl,
  parseAndValidateAnswers,
} from "@/lib/onboarding-security";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slug = `onboarding-regression-${suffix}`;
const email = `regression-${suffix}@example.com`.toLowerCase();
let formId: string | null = null;

async function submit(answers: Record<string, string | string[]>) {
  const request = new NextRequest(`http://localhost/api/onboarding/${slug}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  return POST(request, { params: Promise.resolve({ slug }) });
}

async function main() {
  try {
    assert.equal(normalizeRedirectUrl("/internal/path"), "/internal/path");
    assert.equal(normalizeRedirectUrl("https://example.com/path"), "https://example.com/path");
    assert.throws(() => normalizeRedirectUrl("javascript:alert(1)"));

    const pureValidation = parseAndValidateAnswers(
      JSON.stringify({ answers: { text: "<b>Hello</b>" } }),
      [{ id: "text", type: "text_single", required: true, options: [] }]
    );
    assert.deepEqual(pureValidation, { answers: { text: "Hello" } });

    const form = await prisma.onboardingForm.create({
      data: {
        slug,
        title: "Onboarding regression fixture",
        steps: {
          create: [
            {
              title: "Contact and goal",
              order: 0,
              elements: {
                create: [
                  { type: "text_single", label: "First name", required: true, order: 0 },
                  { type: "text_single", label: "Last Name", required: true, order: 1 },
                  { type: "text_single", label: "Email", required: true, order: 2 },
                  { type: "phone", label: "Best line", required: true, order: 3 },
                  {
                    type: "single_choice",
                    label: "Primary goal",
                    required: true,
                    order: 4,
                    options: {
                      create: [{ text: "Earlier answer", tag: "earlier", order: 0 }],
                    },
                  },
                ],
              },
            },
            {
              title: "Final destination",
              order: 1,
              elements: {
                create: [
                  {
                    type: "single_choice",
                    label: "Your next step",
                    required: true,
                    order: 0,
                    options: {
                      create: [{ text: "Custom destination", tag: "final", order: 0 }],
                    },
                  },
                ],
              },
            },
          ],
        },
        tagMappings: {
          create: [
            { tag: "earlier", url: "/wrong-destination" },
            { tag: "final", url: "https://example.com/expected" },
          ],
        },
      },
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
    });
    formId = form.id;

    const elements = form.steps.flatMap((step) => step.elements);
    const firstName = elements.find((element) => element.label === "First name")!;
    const lastName = elements.find((element) => element.label === "Last Name")!;
    const emailElement = elements.find((element) => element.label === "Email")!;
    const phoneElement = elements.find((element) => element.label === "Best line")!;
    const goal = elements.find((element) => element.label === "Primary goal")!;
    const finalDestination = elements.find(
      (element) => element.label === "Your next step"
    )!;

    const forged = await submit({
      [firstName.id]: "Ada",
      [lastName.id]: "Byron",
      [emailElement.id]: email,
      [phoneElement.id]: "+1 4152345678",
      [goal.id]: finalDestination.options[0].id,
      [finalDestination.id]: finalDestination.options[0].id,
    });
    assert.equal(forged.status, 400, "an option cannot be submitted under another field");

    const invalidEmail = await submit({
      [firstName.id]: "Ada",
      [lastName.id]: "Byron",
      [emailElement.id]: "not-an-email",
      [phoneElement.id]: "+1 4152345678",
      [goal.id]: goal.options[0].id,
      [finalDestination.id]: finalDestination.options[0].id,
    });
    assert.equal(invalidEmail.status, 400, "mapped email fields require a valid email");

    const valid = await submit({
      [firstName.id]: "<b>Ada</b>",
      [lastName.id]: "<i>Byron</i>",
      [emailElement.id]: ` ${email.toUpperCase()} `,
      [phoneElement.id]: "  +1   4152345678  ",
      [goal.id]: goal.options[0].id,
      [finalDestination.id]: finalDestination.options[0].id,
    });
    assert.equal(valid.status, 200);
    const result = (await valid.json()) as {
      responseId: string;
      redirectUrl: string | null;
      segment: string | null;
    };
    assert.equal(result.redirectUrl, "https://example.com/expected");
    assert.equal(result.segment, "final");

    const [response, contact] = await Promise.all([
      prisma.onboardingResponse.findUniqueOrThrow({ where: { id: result.responseId } }),
      prisma.contact.findUniqueOrThrow({
        where: { email },
        include: { events: true },
      }),
    ]);
    assert.deepEqual(JSON.parse(response.answers), {
      [firstName.id]: "Ada",
      [lastName.id]: "Byron",
      [emailElement.id]: email,
      [phoneElement.id]: "+1 4152345678",
      [goal.id]: goal.options[0].id,
      [finalDestination.id]: finalDestination.options[0].id,
    });
    assert.equal(contact.name, "Ada Byron");
    assert.equal(contact.phone, "+1 4152345678");
    assert.equal(contact.events.length, 1);

    await captureOnboardingLead({
      form,
      responseId: response.id,
      answers: JSON.parse(response.answers) as Record<string, string | string[]>,
      tags: ["earlier", "final"],
      attribution: null,
      destination: result.redirectUrl,
    });
    assert.equal(
      await prisma.contactEvent.count({ where: { onboardingResponseId: response.id } }),
      1,
      "syncing the same response must not duplicate its lead event"
    );

    await prisma.onboardingForm.update({
      where: { id: form.id },
      data: { routingElementId: finalDestination.id, defaultRedirectUrl: "/safe-fallback" },
    });
    await prisma.onboardingOption.update({
      where: { id: finalDestination.options[0].id },
      data: { redirectUrl: "javascript:alert(1)" },
    });
    const unsafeRedirect = await submit({
      [firstName.id]: "Grace",
      [lastName.id]: "Hopper",
      [emailElement.id]: email,
      [phoneElement.id]: "+1 4152345678",
      [goal.id]: goal.options[0].id,
      [finalDestination.id]: finalDestination.options[0].id,
    });
    assert.equal(unsafeRedirect.status, 200);
    assert.equal((await unsafeRedirect.json()).redirectUrl, "/safe-fallback");

    console.log("Onboarding regression verification passed.");
  } finally {
    if (formId) {
      await prisma.onboardingForm.deleteMany({ where: { id: formId } });
    }
    await prisma.contact.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
