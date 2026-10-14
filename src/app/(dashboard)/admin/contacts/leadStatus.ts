// Plain (non-"use server") module so these can be imported by client components.
// A "use server" file may only export async functions.

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "WON",
  "LOST",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const NEW_LEAD_STATUS = LEAD_STATUSES[0];
export const CONTACTED_LEAD_STATUS = LEAD_STATUSES[1];
