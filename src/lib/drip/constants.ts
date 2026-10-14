// src/lib/drip/constants.ts
//
// Pure constants shared between server code (engine.ts) and client components
// (campaign editor UIs). Deliberately has NO imports of engine.ts or mail.ts —
// those pull in nodemailer, which needs Node core modules (tls/net/os) that
// don't exist in the browser. Anything imported by a "use client" component
// must come from here, never from engine.ts directly.

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export const ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED", "EXITED", "PAUSED"] as const;
export const STEP_CHANNELS = ["EMAIL", "TASK", "CALL", "SMS"] as const;
export const LEAD_TRIGGER = "LEAD_SEGMENT";
export const COHORT_TRIGGER = "COHORT_SCHEDULE";
export const COHORT_MESSAGE_TRIGGER = "COHORT_MESSAGE";
export const BROADCAST_TRIGGER = "BROADCAST";
export const CERTIFICATE_TRIGGER = "CERTIFICATE_ISSUED";
export const CAMPAIGN_TRIGGERS = [
  LEAD_TRIGGER,
  COHORT_TRIGGER,
  COHORT_MESSAGE_TRIGGER,
  BROADCAST_TRIGGER,
  CERTIFICATE_TRIGGER,
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type StepChannel = (typeof STEP_CHANNELS)[number];
export type CampaignTrigger = (typeof CAMPAIGN_TRIGGERS)[number];
