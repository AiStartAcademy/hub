"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { sanitizePlainText } from "@/lib/onboarding-security";
import { assertStaff, staffIdentity } from "@/lib/adminGuard";
import { getLeadTimeline, type TimelinePage } from "@/lib/leads/timeline";
import { generateLeadBrief, type LeadBrief } from "@/lib/leads/brief";
import { auth } from "@/lib/auth";
import { hasAnyRole } from "@/lib/roles";
import { callabilityReason, type SmsabilityReason } from "@/lib/phone";
import { initiateCall } from "@/lib/vapi/client";
import { sendContactSms } from "@/lib/sms/send";
import { previewOneOffEmail, sendOneOffEmail } from "@/lib/outreach/email";
import type { OneOffBodyMode } from "@/lib/outreach/email";
import { draftOutreachEmail } from "@/lib/outreach/draft";
import type {
  DraftOutreachEmailResult,
  SendOneOffEmailResult,
} from "@/lib/outreach/types";
import {
  isCallOutcome,
  manualCallStatusForOutcome,
} from "../callOutcomes";
import { CONTACTED_LEAD_STATUS, NEW_LEAD_STATUS } from "../leadStatus";
import { updateLeadStatus } from "../actions";
import { normalizeDateOnly } from "@/lib/dateOnly";
import {
  linkContactToUser,
  unlinkContact,
} from "@/lib/leads/linking";

/** Tags are short qualifiers, not free text — bound both length and count. */
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 60;

function revalidateLead(contactId: string) {
  revalidatePath("/admin/contacts");
  revalidatePath(`/admin/contacts/${contactId}`);
}

export async function updateContactBirthday(
  contactId: string,
  value: string
): Promise<string | null> {
  await assertStaff();
  const birthday = normalizeDateOnly(value);
  // No explicit timeout: this local database write is bounded by the server-action lifecycle.
  await prisma.contact.update({
    where: { id: contactId },
    data: { birthday },
  });
  revalidateLead(contactId);
  return birthday;
}

export async function searchUsersByEmail(
  query: string
): Promise<Array<{ id: string; email: string; name: string | null }>> {
  await assertStaff();
  const normalizedQuery = query.trim().toLowerCase().slice(0, 100);
  if (normalizedQuery.length < 3) return [];

  // Substring match pushed into the query so the result set is bounded by the
  // database, not by scanning the user table in the action. Emails are stored
  // normalized, so a lowercased needle matches directly.
  return prisma.user.findMany({
    where: { email: { contains: normalizedQuery } },
    orderBy: { email: "asc" },
    take: 10,
    select: { id: true, email: true, name: true },
  });
}

export async function linkContactToUserAction(
  contactId: string,
  userId: string
): Promise<{ id: string; email: string; name: string | null }> {
  await assertStaff();
  await linkContactToUser(contactId, userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new Error(`Linked contact ${contactId}, but user ${userId} could not be reloaded`);
  }
  revalidateLead(contactId);
  return user;
}

export async function unlinkContactAction(contactId: string): Promise<void> {
  await assertStaff();
  await unlinkContact(contactId);
  revalidateLead(contactId);
}

export type NoteDTO = {
  id: string;
  body: string;
  authorLabel: string;
  kind: string;
  createdAt: string;
};

export type SmsMessageDTO = {
  id: string;
  direction: string;
  body: string;
  status: string;
  error: string | null;
  authorLabel: string | null;
  createdAt: string;
};

export type SendSmsToLeadResult =
  | { ok: true; message: SmsMessageDTO }
  | { ok: false; reason: SmsabilityReason };

export async function addContactNote(contactId: string, body: string): Promise<NoteDTO> {
  await assertStaff();
  const clean = sanitizePlainText(body, 5000, { multiline: true });
  if (!clean.trim()) throw new Error("Note is empty");

  const author = await staffIdentity();
  const note = await prisma.contactNote.create({
    data: {
      contactId,
      body: clean,
      authorId: author.id,
      authorLabel: author.label,
      kind: "MANUAL",
    },
    select: { id: true, body: true, authorLabel: true, kind: true, createdAt: true },
  });

  revalidateLead(contactId);
  return { ...note, createdAt: note.createdAt.toISOString() };
}

/**
 * Deletes a note. Any staff member may remove their own; only an ADMIN may
 * remove someone else's — a shared journal shouldn't be silently rewritable by
 * whoever happens to be looking at it.
 */
export async function deleteContactNote(noteId: string): Promise<void> {
  await assertStaff();
  const note = await prisma.contactNote.findUnique({
    where: { id: noteId },
    select: { id: true, authorId: true, contactId: true },
  });
  if (!note) return;

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const isOwn = note.authorId !== null && note.authorId === userId;
  if (!isOwn && !hasAnyRole(session?.user, ["ADMIN"])) {
    throw new Error("Only an admin can delete another author's note");
  }

  await prisma.contactNote.delete({ where: { id: noteId } });
  revalidateLead(note.contactId);
}

export async function updateLeadTags(contactId: string, tags: string[]): Promise<string[]> {
  await assertStaff();
  const cleaned = Array.from(
    new Set(
      tags
        .map((t) => sanitizePlainText(t, MAX_TAG_LENGTH, { multiline: false }).trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_TAGS);

  await prisma.contact.update({
    where: { id: contactId },
    data: { tags: JSON.stringify(cleaned) },
  });
  revalidateLead(contactId);
  return cleaned;
}

/**
 * Regenerates the AI brief on demand. Errors are surfaced to the caller rather
 * than swallowed — "couldn't reach the model" and "this lead has nothing to say"
 * must not look the same on screen.
 */
export async function regenerateLeadBrief(contactId: string): Promise<LeadBrief> {
  await assertStaff();
  const brief = await generateLeadBrief(contactId);
  revalidateLead(contactId);
  return brief;
}

// ── One-off email ───────────────────────────────────────────

async function validateOutreachRecipient(contactId: string): Promise<string | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, unsubscribedAt: true },
  });
  if (!contact) return "Lead not found";
  if (!contact.email.trim()) return "Lead has no email address";
  if (contact.unsubscribedAt) return "Lead has unsubscribed from email";
  return null;
}

export async function sendOneOffEmailAction(
  contactId: string,
  subject: string,
  html: string,
  mode: OneOffBodyMode = "plain"
): Promise<SendOneOffEmailResult> {
  await assertStaff();
  const recipientError = await validateOutreachRecipient(contactId);
  if (recipientError) return { ok: false, error: recipientError };

  const author = await staffIdentity();
  const result = await sendOneOffEmail({
    contactId,
    subject,
    html,
    mode,
    staffId: author.id,
  });
  revalidateLead(contactId);
  return result;
}

export async function previewOneOffEmailAction(
  contactId: string,
  subject: string,
  body: string,
  mode: OneOffBodyMode
): Promise<{ ok: true; subject: string; html: string } | { ok: false; error: string }> {
  await assertStaff();
  const recipientError = await validateOutreachRecipient(contactId);
  if (recipientError) return { ok: false, error: recipientError };

  return previewOneOffEmail({ contactId, subject, body, mode });
}

export async function draftOutreachEmailAction(
  contactId: string
): Promise<DraftOutreachEmailResult> {
  await assertStaff();
  const recipientError = await validateOutreachRecipient(contactId);
  if (recipientError) return { ok: false, error: recipientError };

  try {
    const draft = await draftOutreachEmail(contactId);
    revalidateLead(contactId);
    return { ok: true, draft };
  } catch (error) {
    revalidateLead(contactId);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not draft outreach email",
    };
  }
}

// ── SMS ───────────────────────────────────────────────────────────

export async function sendSmsToLead(
  contactId: string,
  body: string
): Promise<SendSmsToLeadResult> {
  await assertStaff();
  const author = await staffIdentity();
  const clean = sanitizePlainText(body, 640, { multiline: true });
  if (!clean.trim()) throw new Error("SMS message is empty");

  const result = await sendContactSms({
    contactId,
    body: clean,
    purpose: "any",
    authorId: author.id ?? undefined,
    authorLabel: author.label,
  });
  if (!result.ok) return result;

  revalidateLead(contactId);
  return {
    ok: true,
    message: {
      id: result.message.id,
      direction: result.message.direction,
      body: result.message.body,
      status: result.message.status,
      error: result.message.error,
      authorLabel: result.message.authorLabel,
      createdAt: result.message.createdAt.toISOString(),
    },
  };
}

// ── Voice calls ──────────────────────────────────────────────────────

/**
 * "Call with AI" — place a one-off Vapi call to this lead right now.
 * Staff-initiated, so it bypasses the drip machinery but NOT consent: an
 * automated dial is an automated dial no matter who clicked the button.
 */
export async function startAiCall(
  contactId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await assertStaff();
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true, phoneConsentAt: true, doNotCall: true, name: true },
  });
  if (!contact) return { ok: false, reason: "Lead not found" };
  const reason = callabilityReason(contact);
  if (reason) {
    const why =
      reason === "do_not_call"
        ? "Lead is flagged do-not-call"
        : reason === "no_call_consent"
          ? "Lead has not consented to calls"
          : "Phone number isn't a valid dialable number";
    return { ok: false, reason: why };
  }

  const author = await staffIdentity();
  try {
    await initiateCall({
      contactId,
      phone: contact.phone ?? "",
      contactName: contact.name,
      authorId: author.id,
      authorLabel: author.label,
    });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Vapi call failed",
    };
  }
  revalidateLead(contactId);
  return { ok: true };
}

/** Log a human-dialed call after the fact — notes/transcript pasted by staff. */
export type LogManualCallResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function logManualCall(
  contactId: string,
  input: { outcome: string; notes: string; durationMin?: number }
): Promise<LogManualCallResult> {
  await assertStaff();
  const notes = sanitizePlainText(input.notes, 20000, { multiline: true });
  const outcome = sanitizePlainText(input.outcome, 60);
  if (!isCallOutcome(outcome)) {
    return { ok: false, reason: "Invalid call outcome" };
  }

  const author = await staffIdentity();
  const durationSec =
    typeof input.durationMin === "number" && Number.isFinite(input.durationMin)
      ? Math.max(0, Math.round(input.durationMin * 60))
      : null;

  let priorStatus: string | null;
  try {
    priorStatus = await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findUnique({
        where: { id: contactId },
        select: { status: true },
      });
      if (!contact) return null;

      const occurredAt = new Date();
      await tx.contactCall.create({
        data: {
          contactId,
          provider: "manual",
          status: manualCallStatusForOutcome(outcome),
          outcome,
          transcript: notes || null,
          durationSec,
          authorId: author.id,
          authorLabel: author.label,
          startedAt: occurredAt,
          endedAt: occurredAt,
        },
      });
      await tx.contact.update({
        where: { id: contactId },
        data: { lastActivityAt: occurredAt },
      });
      return contact.status;
    });
  } catch (error) {
    console.error("Failed to log manual call", { contactId, error });
    return { ok: false, reason: "Could not log call" };
  }

  if (priorStatus === null) return { ok: false, reason: "Lead not found" };
  if (priorStatus === NEW_LEAD_STATUS) {
    try {
      await updateLeadStatus(contactId, CONTACTED_LEAD_STATUS, NEW_LEAD_STATUS);
    } catch (error) {
      // The call is already committed, so a status failure must not lose it.
      console.error("Manual call logged but lead status auto-advance failed", {
        contactId,
        error,
      });
    }
  }

  revalidateLead(contactId);
  return { ok: true };
}

/** Toggle the automated-call suppression flag. Never blocks human dialing. */
export async function setDoNotCall(contactId: string, value: boolean): Promise<void> {
  await assertStaff();
  await prisma.contact.update({
    where: { id: contactId },
    data: { doNotCall: value },
  });
  revalidateLead(contactId);
}

/** Next page of the merged activity feed. Staff-only, like the page itself. */
export async function getTimelinePage(
  contactId: string,
  cursor: string | null
): Promise<TimelinePage> {
  await assertStaff();
  return getLeadTimeline(contactId, { before: cursor });
}
