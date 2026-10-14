"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { type LeadStatus } from "./leadStatus";
import { sanitizePlainText } from "@/lib/onboarding-security";
import { assertStaff, staffIdentity } from "@/lib/adminGuard";
import {
  changeLeadStatus,
  type UpdateLeadStatusResult as LeadStatusUpdateResult,
} from "@/lib/leads/status";

/** Both the table and the profile render this data — refresh both. */
function revalidateLead(contactId: string) {
  revalidatePath("/admin/contacts");
  revalidatePath(`/admin/contacts/${contactId}`);
}

export type UpdateLeadStatusResult =
  LeadStatusUpdateResult;

export async function updateLeadStatus(
  contactId: string,
  status: LeadStatus,
  expectedCurrentStatus?: LeadStatus
): Promise<UpdateLeadStatusResult> {
  await assertStaff();
  const actor = await staffIdentity();
  return changeLeadStatus(contactId, status, actor, expectedCurrentStatus);
}

export async function updateLeadNotes(contactId: string, notes: string) {
  await assertStaff();
  await prisma.contact.update({
    where: { id: contactId },
    data: { notes: sanitizePlainText(notes, 5000, { multiline: true }) },
  });
  revalidateLead(contactId);
}

export async function updateLeadPipelineExclusion(
  contactId: string,
  excludeFromPipeline: boolean
): Promise<void> {
  await assertStaff();
  if (typeof excludeFromPipeline !== "boolean") {
    throw new Error("excludeFromPipeline must be a boolean");
  }
  await prisma.contact.update({
    where: { id: contactId },
    data: { excludeFromPipeline },
  });
  revalidateLead(contactId);
}
