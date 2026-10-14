"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolvePersonContact, setPersonPhone } from "@/lib/leads/personRecord";
import { normalizePhoneE164 } from "@/lib/phone";
import prisma from "@/lib/prisma";

export type CohortBannerActionResult =
  | { ok: true; persisted: boolean }
  | { ok: false; error: string };

const NOT_SIGNED_IN: CohortBannerActionResult = {
  ok: false,
  error: "Not signed in.",
};

function revalidateCohortPages(): void {
  revalidatePath("/cohorts/[id]", "page");
}

export async function enableCourseEmails(): Promise<CohortBannerActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NOT_SIGNED_IN;

  const contact = await resolvePersonContact(userId);
  if (!contact) return { ok: true, persisted: false };

  await prisma.contact.update({
    where: { id: contact.id },
    data: { courseEmailOptOutAt: null },
  });
  revalidateCohortPages();
  return { ok: true, persisted: true };
}

export async function addTransactionalSms(
  phone: string,
  consented: boolean
): Promise<CohortBannerActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NOT_SIGNED_IN;
  if (consented !== true) {
    return {
      ok: false,
      error: "Agree to receive course update texts before continuing.",
    };
  }

  const normalizedPhone = normalizePhoneE164(phone);
  if (!normalizedPhone) {
    return { ok: false, error: "Enter a valid phone number." };
  }

  // setPersonPhone resolves the session user's own Contact (creating it when
  // none exists); no contact id ever comes from the client.
  await setPersonPhone(
    {
      userId,
      phone: normalizedPhone,
      smsMarketingConsent: false,
      smsTransactionalConsent: true,
      callConsent: false,
      actor: "self",
    },
    {
      source: "cohort-banner",
      preserveSmsMarketingAndCallConsent: true,
    }
  );
  revalidateCohortPages();
  return { ok: true, persisted: true };
}

export async function dismissCohortBanner(): Promise<CohortBannerActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NOT_SIGNED_IN;

  const contact = await resolvePersonContact(userId);
  if (!contact) {
    // There is no safe identity-owned row to update. The client treats this as
    // a page-view-only dismissal and the explicit flag makes that visible.
    return { ok: true, persisted: false };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { cohortBannerDismissedAt: new Date() },
  });
  revalidateCohortPages();
  return { ok: true, persisted: true };
}
