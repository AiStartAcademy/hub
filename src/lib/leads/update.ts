import {
  LEAD_STATUSES,
  type LeadStatus,
} from "@/app/(dashboard)/admin/contacts/leadStatus";
import {
  LEAD_TAG_MODES,
  MAX_LEAD_UPDATE_TAG_LENGTH,
  MAX_LEAD_UPDATE_TAGS,
  mergeLeadTags,
  normalizeLeadTags,
  type LeadTagMode,
} from "./tags";

export const MAX_LEAD_UPDATE_BATCH = 50;

export interface LeadUpdate {
  id: string;
  status?: LeadStatus;
  expectedCurrentStatus?: LeadStatus;
  excludeFromPipeline?: boolean;
  tags?: string[];
  tagMode?: LeadTagMode;
}

export type ParseLeadUpdateBatchResult =
  | { ok: true; updates: LeadUpdate[] }
  | { ok: false; error: string };

export type LeadUpdateBatchResult =
  | { id: string; ok: true; applied: string[] }
  | {
      id: string;
      ok: false;
      reason: "not_found" | "conflict" | "error";
      applied: string[];
      message: string;
    };

export interface LeadUpdateDependencies {
  loadContact: (id: string) => Promise<{ tags: string | null } | null>;
  changeStatus: (
    id: string,
    status: LeadStatus,
    expectedCurrentStatus?: LeadStatus
  ) => Promise<{ ok: true } | { ok: false; reason: "conflict" }>;
  updateFields: (
    id: string,
    fields: { excludeFromPipeline?: boolean; tags?: string }
  ) => Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStatus(
  value: unknown,
  path: string
): { ok: true; status: LeadStatus } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${path} must be a string` };
  }
  const normalized = value.trim().toUpperCase();
  if (!(LEAD_STATUSES as readonly string[]).includes(normalized)) {
    return {
      ok: false,
      error: `${path} must be one of: ${LEAD_STATUSES.join(", ")}`,
    };
  }
  return { ok: true, status: normalized as LeadStatus };
}

export function parseLeadUpdateBatch(body: unknown): ParseLeadUpdateBatchResult {
  if (!isObject(body) || !Array.isArray(body.updates)) {
    return { ok: false, error: "updates must be an array" };
  }
  if (body.updates.length === 0) {
    return { ok: false, error: "updates must contain at least one item" };
  }
  if (body.updates.length > MAX_LEAD_UPDATE_BATCH) {
    return {
      ok: false,
      error: `updates cannot contain more than ${MAX_LEAD_UPDATE_BATCH} items`,
    };
  }

  const seenIds = new Set<string>();
  const updates: LeadUpdate[] = [];

  for (const [index, rawUpdate] of body.updates.entries()) {
    const path = `updates[${index}]`;
    if (!isObject(rawUpdate)) {
      return { ok: false, error: `${path} must be an object` };
    }

    if (typeof rawUpdate.id !== "string" || !rawUpdate.id.trim()) {
      return { ok: false, error: `${path}.id must be a non-empty string` };
    }
    const id = rawUpdate.id.trim();
    if (id.length > 128) {
      return { ok: false, error: `${path}.id cannot exceed 128 characters` };
    }
    if (seenIds.has(id)) {
      return { ok: false, error: `Duplicate contact id: ${id}` };
    }
    seenIds.add(id);

    const update: LeadUpdate = { id };

    if (rawUpdate.status !== undefined) {
      const parsedStatus = parseStatus(rawUpdate.status, `${path}.status`);
      if (!parsedStatus.ok) return parsedStatus;
      if (parsedStatus.status === "WON") {
        return {
          ok: false,
          error:
            `${path}.status cannot be WON; WON is reserved for verified purchases via markLeadWonForPurchase`,
        };
      }
      update.status = parsedStatus.status;
    }

    if (rawUpdate.expectedCurrentStatus !== undefined) {
      const parsedExpected = parseStatus(
        rawUpdate.expectedCurrentStatus,
        `${path}.expectedCurrentStatus`
      );
      if (!parsedExpected.ok) return parsedExpected;
      update.expectedCurrentStatus = parsedExpected.status;
    }

    if (rawUpdate.excludeFromPipeline !== undefined) {
      if (typeof rawUpdate.excludeFromPipeline !== "boolean") {
        return {
          ok: false,
          error: `${path}.excludeFromPipeline must be a boolean`,
        };
      }
      update.excludeFromPipeline = rawUpdate.excludeFromPipeline;
    }

    if (rawUpdate.tags !== undefined) {
      if (!Array.isArray(rawUpdate.tags)) {
        return { ok: false, error: `${path}.tags must be an array` };
      }
      if (rawUpdate.tags.some((tag) => typeof tag !== "string")) {
        return { ok: false, error: `${path}.tags must contain only strings` };
      }
      if (rawUpdate.tags.length > MAX_LEAD_UPDATE_TAGS) {
        return {
          ok: false,
          error: `${path}.tags cannot contain more than ${MAX_LEAD_UPDATE_TAGS} items`,
        };
      }
      if (
        rawUpdate.tags.some(
          (tag) => (tag as string).trim().length > MAX_LEAD_UPDATE_TAG_LENGTH
        )
      ) {
        return {
          ok: false,
          error: `${path}.tags entries cannot exceed ${MAX_LEAD_UPDATE_TAG_LENGTH} characters`,
        };
      }
      update.tags = normalizeLeadTags(rawUpdate.tags as string[]);
    }

    if (rawUpdate.tagMode !== undefined) {
      if (
        typeof rawUpdate.tagMode !== "string" ||
        !(LEAD_TAG_MODES as readonly string[]).includes(rawUpdate.tagMode)
      ) {
        return {
          ok: false,
          error: `${path}.tagMode must be one of: ${LEAD_TAG_MODES.join(", ")}`,
        };
      }
      update.tagMode = rawUpdate.tagMode as LeadTagMode;
    } else if (update.tags !== undefined) {
      update.tagMode = "add";
    }

    if (update.expectedCurrentStatus !== undefined && update.status === undefined) {
      return {
        ok: false,
        error: `${path}.expectedCurrentStatus requires status`,
      };
    }
    if (update.tagMode !== undefined && update.tags === undefined) {
      return { ok: false, error: `${path}.tagMode requires tags` };
    }
    if (
      update.status === undefined &&
      update.excludeFromPipeline === undefined &&
      update.tags === undefined
    ) {
      return { ok: false, error: `${path} requests no changes` };
    }

    updates.push(update);
  }

  return { ok: true, updates };
}

/**
 * Applies each contact independently. A missing contact, status conflict, or
 * thrown dependency error becomes that contact's result and never aborts the batch.
 */
export async function executeLeadUpdateBatch(
  updates: readonly LeadUpdate[],
  deps: LeadUpdateDependencies
): Promise<LeadUpdateBatchResult[]> {
  const results: LeadUpdateBatchResult[] = [];

  for (const update of updates) {
    const applied: string[] = [];
    try {
      const contact = await deps.loadContact(update.id);
      if (!contact) {
        results.push({
          id: update.id,
          ok: false,
          reason: "not_found",
          applied,
          message: "Contact not found",
        });
        continue;
      }

      if (update.status !== undefined) {
        const statusResult = await deps.changeStatus(
          update.id,
          update.status,
          update.expectedCurrentStatus
        );
        if (!statusResult.ok) {
          results.push({
            id: update.id,
            ok: false,
            reason: "conflict",
            applied,
            message: "Status changed concurrently; no fields were updated",
          });
          continue;
        }
        applied.push("status");
      }

      const fields: { excludeFromPipeline?: boolean; tags?: string } = {};
      if (update.excludeFromPipeline !== undefined) {
        fields.excludeFromPipeline = update.excludeFromPipeline;
      }
      if (update.tags !== undefined) {
        fields.tags = JSON.stringify(
          mergeLeadTags(contact.tags, update.tags, update.tagMode ?? "add")
        );
      }

      if (Object.keys(fields).length > 0) {
        await deps.updateFields(update.id, fields);
        if (fields.excludeFromPipeline !== undefined) {
          applied.push("excludeFromPipeline");
        }
        if (fields.tags !== undefined) applied.push("tags");
      }

      results.push({ id: update.id, ok: true, applied });
    } catch (error) {
      results.push({
        id: update.id,
        ok: false,
        reason: "error",
        applied,
        message: error instanceof Error ? error.message : "Lead update failed",
      });
    }
  }

  return results;
}
