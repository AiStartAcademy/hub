"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  canSendCohortMessages,
  parsePreviewCohortMessageInput,
  parseSendCohortMessageInput,
} from "@/lib/cohortMessages/actionGuard";
import { plainTextToEmailHtml } from "@/lib/cohortMessages/smsText";
import {
  previewCohortMessage,
  sendCohortMessage,
  type CohortMessagePreview,
  type SendCohortMessageResult,
} from "@/lib/cohortMessages/send";

export async function previewCohortMessageAction(
  input: unknown
): Promise<CohortMessagePreview> {
  const session = await auth();
  if (!session?.user || !canSendCohortMessages(session.user)) {
    return { ok: false, reason: "Unauthorized" };
  }

  const parsed = parsePreviewCohortMessageInput(input);
  if (!parsed.ok) return parsed;
  return previewCohortMessage(parsed.value);
}

export async function sendCohortMessageAction(
  input: unknown
): Promise<SendCohortMessageResult> {
  const session = await auth();
  if (!session?.user || !canSendCohortMessages(session.user)) {
    return { ok: false, reason: "Unauthorized" };
  }

  const parsed = parseSendCohortMessageInput(input);
  if (!parsed.ok) return parsed;

  const result = await sendCohortMessage({
    ...parsed.value,
    emailBody: plainTextToEmailHtml(parsed.value.emailBody),
    sentByUserId: session.user.id,
  });
  if (result.ok) {
    revalidatePath(`/admin/cohorts/${parsed.value.cohortId}/messages`);
  }
  return result;
}
