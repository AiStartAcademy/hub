/**
 * GoHighLevel (GHL) API integration helper
 *
 * Environment variables required:
 *   GHL_API_KEY      – Private Integration Token (Sub-Account scope)
 *   GHL_LOCATION_ID  – Location / Sub-Account ID
 */

const GHL_BASE = "https://services.leadconnectorhq.com";

function headers() {
  const key = process.env.GHL_API_KEY;
  if (!key) throw new Error("GHL_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

function locationId() {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("GHL_LOCATION_ID is not set");
  return id;
}

export interface GHLContactPayload {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  locationId: string;
  customFields?: Array<
    { id: string; value: string } | { key: string; field_value: string }
  >;
  tags?: string[];
}

type GHLContact = { id?: string; tags?: string[] } & Record<string, unknown>;

/** Search contacts by email or phone to avoid duplicates */
export async function searchContact(query: string): Promise<GHLContact | null> {
  const res = await fetch(
    `${GHL_BASE}/contacts/search/duplicate?locationId=${locationId()}&${query}`,
    { method: "GET", headers: headers() }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== "object") return null;
  const contact = (data as Record<string, unknown>).contact;
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return null;
  const raw = contact as Record<string, unknown>;
  return {
    ...raw,
    id: typeof raw.id === "string" ? raw.id : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

/** Create a contact in GHL */
export async function createGHLContact(payload: GHLContactPayload) {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL create contact failed (${res.status}): ${err}`);
  }
  return res.json();
}

/** Update an existing contact */
export async function updateGHLContact(contactId: string, payload: Partial<GHLContactPayload>) {
  // Drop locationId before updating to avoid a 422 from GHL
  const updatePayload = { ...payload };
  delete updatePayload.locationId;

  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(updatePayload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GHL update contact failed (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Create or update a GHL contact (upsert).
 * Searches by email first, then phone. Creates if not found.
 */
export async function upsertGHLContact(payload: GHLContactPayload) {
  // Try to find an existing contact by email
  let existing: GHLContact | null = null;
  if (payload.email) {
    existing = await searchContact(`email=${encodeURIComponent(payload.email)}`);
  }
  // If not found by email, try phone
  if (!existing && payload.phone) {
    existing = await searchContact(`number=${encodeURIComponent(payload.phone)}`);
  }

  if (existing?.id) {
    return updateGHLContact(existing.id, payload);
  }
  return createGHLContact(payload);
}

export function getLocationId() {
  return locationId();
}
