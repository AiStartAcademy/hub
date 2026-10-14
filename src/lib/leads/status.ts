import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import {
  dispatchConversion,
  type ConversionEvent,
} from "@/lib/serverConversions";
import {
  LEAD_STATUSES,
  type LeadStatus,
} from "@/app/(dashboard)/admin/contacts/leadStatus";

export type LeadStatusActor =
  | "system"
  | { id: string | null; label: string };

export type UpdateLeadStatusResult =
  | { ok: true }
  | { ok: false; reason: "conflict" };

// Only these transitions carry lead-quality signal worth reporting to Meta. NEW is the
// already-reported generate_lead event (fired at quiz submission); CONTACTED is pipeline
// bookkeeping with no outcome information. QUALIFIED/WON are positive training signal, LOST
// is a negative one — Meta's ad algorithm learns as much from "don't target this" as from
// "target more like this".
const META_EVENT_FOR_STATUS: Partial<Record<LeadStatus, ConversionEvent["name"]>> = {
  QUALIFIED: "lead_qualified",
  WON: "lead_won",
  LOST: "lead_lost",
};

/** Both the table and the profile render this data — refresh both. */
function revalidateLead(contactId: string): void {
  revalidatePath("/admin/contacts");
  revalidatePath(`/admin/contacts/${contactId}`);
}

/**
 * Session-free status transition core. Authorization belongs to the caller;
 * the explicit actor keeps that trust boundary visible at every call site.
 */
export async function changeLeadStatus(
  contactId: string,
  status: LeadStatus,
  actor: LeadStatusActor,
  expectedCurrentStatus?: LeadStatus
): Promise<UpdateLeadStatusResult> {
  if (!LEAD_STATUSES.includes(status)) throw new Error("Invalid status");

  const prior = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { status: true, email: true },
  });
  if (!prior) throw new Error("Lead not found");
  if (expectedCurrentStatus && prior.status !== expectedCurrentStatus) {
    console.info("[lead-status] Compare-and-swap conflict", {
      contactId,
      targetStatus: status,
      actor: actor === "system" ? actor : actor.id ?? "staff",
    });
    revalidateLead(contactId);
    return { ok: false, reason: "conflict" };
  }
  if (prior.status === status) return { ok: true }; // no-op — nothing changed, nothing to report

  // Compare-and-swap on the prior status: if a concurrent request already moved this lead
  // off `prior.status`, this update matches zero rows and we skip the Meta dispatch rather
  // than reporting a transition that didn't actually happen from this call.
  const result = await prisma.contact.updateMany({
    where: { id: contactId, status: prior.status },
    data: { status },
  });

  if (result.count === 1) {
    const eventName = META_EVENT_FOR_STATUS[status];
    if (eventName) {
      // Fire-and-forget, same contract as every other dispatchConversion call site — a Meta
      // outage must never fail a status change. `${status}` in the id keeps a later
      // QUALIFIED→WON transition distinct from this one; Date.now() guards against two
      // transitions to the same status ever colliding (e.g. WON→LOST→WON).
      void dispatchConversion(
        {
          name: eventName,
          eventId: `${contactId}:${status}:${Date.now()}`,
          actionSource: "system_generated",
          leadId: contactId,
        },
        { email: prior.email }
      );
    }
  } else {
    console.info("[lead-status] Compare-and-swap conflict", {
      contactId,
      targetStatus: status,
      actor: actor === "system" ? actor : actor.id ?? "staff",
    });
    revalidateLead(contactId);
    return { ok: false, reason: "conflict" };
  }

  revalidateLead(contactId);
  return { ok: true };
}
