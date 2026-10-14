// Client-safe list of merge-field tokens.
//
// Deliberately dependency-free: client components (the outreach composer,
// campaign editor) need the token names for chips/highlighting, and importing
// them from template.ts would drag nodemailer into the browser bundle.
// template.ts derives its renderer table from these names and a test pins the
// two in sync.

export const MERGE_FIELD_TOKENS = Object.freeze([
  "first_name",
  "name",
  "email",
  "unsubscribe_url",
  "app_url",
  "cohorts_url",
  "booking_url",
  "upcoming_cohorts",
  "next_cohort",
  "abandoned_item_title",
  "abandoned_amount",
  "resume_checkout_url",
  "cohort_name",
  "cohort_start_date",
  "cohort_start_time",
  "zoom_link",
  "venue_address",
  "cohort_url",
  "certificate_id",
  "certificate_url",
  "certificate_pdf_url",
  "certificate_png_url",
  "linkedin_add_url",
] as const);

export type MergeFieldToken = (typeof MERGE_FIELD_TOKENS)[number];

export const MERGE_FIELD_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;
