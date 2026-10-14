// src/lib/programPurchaseLifecycle.ts
//
// Post-purchase side effects for a program: welcome email, CRM contact, and a
// timeline event. Called from the Stripe webhook after program access and the
// non-entitlement enrollment row have both been granted.
//
// The ContactEvent is the idempotency key for the whole lifecycle, including
// mail. Every effect is best-effort and catch-logged because a CRM or mail
// failure must never make Stripe retry an otherwise successful fulfillment.
// Setting the contact to WON is the sanctioned lead-nurture exit path, and —
// like membershipLifecycle — active enrollments are stopped immediately so a
// buyer never receives another nurture email and the welcome campaign is not
// delayed until their old sequence's next due step status-exits them.

import prisma from "@/lib/prisma";
import { sendSelfPacedWelcomeEmail } from "@/lib/mail";
import { stopEnrollment } from "@/lib/drip/engine";
import { logger } from "@/lib/logger";

export type ProgramPurchaseInput = {
  paymentId: string;
  programId: string;
  programName: string;
  userId: string;
  email: string;
  name: string | null;
};

/**
 * Run once per paid program payment. Safe to call on webhook retries: the
 * payment-keyed ContactEvent gates every lifecycle effect after contact sync.
 */
export async function onProgramPurchased(
  input: ProgramPurchaseInput
): Promise<void> {
  try {
    const contact = await prisma.contact.upsert({
      where: { email: input.email },
      update: { status: "WON", lastActivityAt: new Date() },
      create: {
        email: input.email,
        name: input.name ?? input.email,
        status: "WON",
        source: "program",
      },
    });

    // One lifecycle per Payment row, keyed by scanning existing events because
    // ContactEvent has no compound unique key for free-form event metadata.
    const existing = await prisma.contactEvent.findFirst({
      where: {
        contactId: contact.id,
        type: "PROGRAM_PURCHASED",
        metadata: { contains: input.paymentId },
      },
      select: { id: true },
    });
    if (existing) return;

    // A paying student should not keep receiving lead-nurture sequences, and an
    // active enrollment would also block the welcome campaign's auto-enroll
    // until its next due step. Mirrors membershipLifecycle.
    const activeEnrollments = await prisma.dripEnrollment.findMany({
      where: { contactId: contact.id, status: "ACTIVE" },
      select: { id: true },
    });
    for (const enrollment of activeEnrollments) {
      await stopEnrollment(enrollment.id, "program_purchased");
    }

    // Mail deliberately precedes the event write. If delivery fails, leaving
    // the event absent lets a later webhook retry deliver the welcome; recording
    // it after successful mail prevents that retry from sending a duplicate.
    try {
      await sendSelfPacedWelcomeEmail(
        input.email,
        input.name,
        input.programId
      );
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          paymentId: input.paymentId,
          programId: input.programId,
          userId: input.userId,
          email: input.email,
        },
        "Program purchase welcome email failed; lifecycle event left absent for retry"
      );
      return;
    }

    await prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        type: "PROGRAM_PURCHASED",
        metadata: JSON.stringify({
          paymentId: input.paymentId,
          programId: input.programId,
          programName: input.programName,
        }),
      },
    });
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
        paymentId: input.paymentId,
        programId: input.programId,
        userId: input.userId,
        email: input.email,
      },
      "Program purchase lifecycle failed (non-fatal)"
    );
  }
}
