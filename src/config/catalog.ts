// src/config/catalog.ts
//
// Database record ids and third-party container ids that the hub's copy links
// to directly. They are deployment data, not code: set the env vars for your
// deployment. Empty values switch the dependent feature off.
//
// NEXT_PUBLIC_ so the module stays importable from client components; Next
// inlines these at build time.

/** Program id of the self-paced course (/self-paced checkout and nurture links). */
export const SELF_PACED_PROGRAM_ID = process.env.NEXT_PUBLIC_SELF_PACED_PROGRAM_ID || "";

/** Cohort id of the free live Q&A session linked from nurture emails. */
export const QA_EVENT_COHORT_ID = process.env.NEXT_PUBLIC_QA_EVENT_COHORT_ID || "";

/** Google Tag Manager container loaded by the root layout. Empty = no GTM. */
export const GTM_CONTAINER_ID = process.env.NEXT_PUBLIC_GTM_ID || "";

/** GCS bucket used by Next Image when GCS_BUCKET_NAME is unset. Empty = no pattern. */
export const GCS_BUCKET_FALLBACK = "";
