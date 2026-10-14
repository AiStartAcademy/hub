"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getMembershipEntitlements } from "@/lib/entitlements";
import { reportMilestone } from "@/lib/milestones";

const MILESTONE_KEYS = [
  "first-conversation",
  "first-pilot",
  "first-testimonial",
  "first-retainer",
  "mrr-5k",
  "mrr-10k",
] as const;

type MilestoneKey = (typeof MILESTONE_KEYS)[number];

export type ReportMilestoneActionState = {
  status: "idle" | "error" | "success";
  message: string | null;
};

export const initialReportMilestoneActionState: ReportMilestoneActionState = {
  status: "idle",
  message: null,
};

function toOptionalTrimmedString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isMilestoneKey(value: string): value is MilestoneKey {
  return MILESTONE_KEYS.includes(value as MilestoneKey);
}

export async function reportMilestoneAction(
  _prevState: ReportMilestoneActionState,
  formData: FormData,
): Promise<ReportMilestoneActionState> {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      status: "error",
      message: "You must be signed in to report a milestone.",
    };
  }

  // Duplicate the page-level gate here because a server action is its own entry point.
  const { has } = await getMembershipEntitlements(session.user.id, session.user);
  if (!has.milestoneLadder) {
    return {
      status: "error",
      message: "The milestone ladder is an Accelerator feature.",
    };
  }

  const milestoneKey = toOptionalTrimmedString(formData.get("milestoneKey"));
  const evidenceUrl = toOptionalTrimmedString(formData.get("evidenceUrl"));
  const note = toOptionalTrimmedString(formData.get("note"));

  if (!milestoneKey || !isMilestoneKey(milestoneKey)) {
    return {
      status: "error",
      message: "Choose a valid milestone before submitting your report.",
    };
  }

  if (evidenceUrl) {
    try {
      const parsedUrl = new URL(evidenceUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return {
          status: "error",
          message: "Evidence links must start with http:// or https://.",
        };
      }
    } catch {
      return {
        status: "error",
        message: "Enter a valid evidence URL or leave the field blank.",
      };
    }
  }

  if (note && note.length > 500) {
    return {
      status: "error",
      message: "Keep the note to 500 characters or fewer.",
    };
  }

  const result = await reportMilestone(session.user.id, milestoneKey, evidenceUrl, note);

  if (!result.ok) {
    return {
      status: "error",
      message: result.error,
    };
  }

  revalidatePath("/members/milestones");

  return {
    status: "success",
    message: "Milestone submitted. We will review it shortly.",
  };
}
