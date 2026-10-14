import prisma from "@/lib/prisma";
import { normalizeEmail } from "@/lib/onboarding-security";
import {
  LEAD_STATUSES,
  type LeadStatus,
} from "@/app/(dashboard)/admin/contacts/leadStatus";
import { changeLeadStatus } from "@/lib/leads/status";

/** SQLite-backed purchase categories stored as uppercase strings in ContactEvent metadata. */
export type LeadPurchaseKind = "COHORT" | "MEMBERSHIP";

export type MarkLeadWonForPurchaseInput = {
  buyerEmail: string | null | undefined;
  userId?: string | null;
  kind: LeadPurchaseKind;
  refId: string;
};

type PurchaseContact = {
  id: string;
  status: string;
};

async function findPurchaseContact(
  input: MarkLeadWonForPurchaseInput
): Promise<PurchaseContact | null> {
  // `Contact.userId` is indexed but not unique, so this is findFirst rather than
  // findUnique. A buyer whose account is not linked to any lead still falls through
  // to the email match below — the link is a shortcut, not the only route.
  if (input.userId) {
    const linked = await prisma.contact.findFirst({
      where: { userId: input.userId },
      select: { id: true, status: true },
    });
    if (linked) return linked;
  }

  const email = normalizeEmail(input.buyerEmail);
  if (!email) return null;
  return prisma.contact.findUnique({
    where: { email },
    select: { id: true, status: true },
  });
}

function asLeadStatus(status: string, contactId: string): LeadStatus {
  if ((LEAD_STATUSES as readonly string[]).includes(status)) {
    return status as LeadStatus;
  }
  throw new Error(`Contact ${contactId} has invalid lead status ${status}`);
}

/**
 * Best-effort CRM promotion after a real grant. Callers deliberately swallow
 * failures so CRM availability can never determine fulfillment success.
 */
export async function markLeadWonForPurchase(
  input: MarkLeadWonForPurchaseInput
): Promise<void> {
  let contact = await findPurchaseContact(input);
  if (!contact) return;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const currentStatus = asLeadStatus(contact.status, contact.id);
    if (currentStatus === "WON") return;
    if (currentStatus === "LOST") {
      console.info(
        `[autoWon] Contact ${contact.id} remains LOST for purchase ${input.refId}`
      );
      return;
    }

    const result = await changeLeadStatus(
      contact.id,
      "WON",
      "system",
      currentStatus
    );
    if (result.ok) {
      await prisma.contactEvent.create({
        data: {
          contactId: contact.id,
          type: "PURCHASE",
          metadata: JSON.stringify({ kind: input.kind, refId: input.refId }),
        },
      });
      return;
    }

    if (attempt === 2) {
      console.warn(
        `[autoWon] Gave up after 2 status conflicts for contact ${contact.id}, purchase ${input.refId}`
      );
      return;
    }

    contact = await prisma.contact.findUnique({
      where: { id: contact.id },
      select: { id: true, status: true },
    });
    if (!contact) return;
  }
}
