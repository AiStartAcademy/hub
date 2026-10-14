import type { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import OnboardingPlayer from "./OnboardingPlayer";

export const dynamic = "force-dynamic";

// Private, per-invitation onboarding forms — never index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await prisma.onboardingForm.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      steps: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          slug: true,
          order: true,
          formId: true,
          title: true,
          elements: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              type: true,
              label: true,
              required: true,
              options: {
                orderBy: { order: "asc" },
                select: { id: true, text: true, nextStepId: true },
              },
            },
          },
        },
      },
    },
  });

  if (!form) notFound();

  return <OnboardingPlayer form={form} />;
}
