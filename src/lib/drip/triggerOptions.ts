// src/lib/drip/triggerOptions.ts
//
// The admin editor's Trigger select, as data. Kept next to constants.ts (and
// equally import-free) so a "use client" component can pull it in, and so a
// unit test can prove every admin-creatable trigger is offered without
// rendering React. Managed triggers such as COHORT_MESSAGE deliberately stay
// out of this list because their dedicated send path owns campaign creation.

import {
  BROADCAST_TRIGGER,
  CERTIFICATE_TRIGGER,
  COHORT_MESSAGE_TRIGGER,
  COHORT_TRIGGER,
  LEAD_TRIGGER,
  type CampaignTrigger,
} from "./constants";

export type TriggerOption = {
  value: CampaignTrigger;
  label: string;
  /** Shown under the select when this trigger is chosen. Null for the default nurture flow. */
  help: string | null;
};

export const TRIGGER_OPTIONS: readonly TriggerOption[] = [
  {
    value: LEAD_TRIGGER,
    label: "Lead segment (nurture — enrolls by segment rule)",
    help: null,
  },
  {
    value: COHORT_TRIGGER,
    label: "Cohort schedule (reminders — enrolls cohort registrants)",
    help:
      "Cohort campaigns enroll everyone registered in an upcoming cohort (paid and free). " +
      "Segment, priority, exit statuses and the send window are ignored — reminders go out " +
      "whenever they are due.",
  },
  {
    value: CERTIFICATE_TRIGGER,
    label: "Certificate issued (delivers certificates to cohort graduates)",
    help:
      "Certificate campaigns enroll graduates when their certificates are sent from a cohort's " +
      "Manage view (or the certificate_notify MCP tool). Exit statuses and the send window are " +
      "ignored. Only the lowest-priority ACTIVE certificate campaign is used, so keep one.",
  },
  {
    value: BROADCAST_TRIGGER,
    label: "Broadcast (one-off send to the current audience)",
    help:
      "Broadcast campaigns send once, on demand, to whoever matches the segment at send time " +
      "(the broadcast_send MCP tool). The tick sweep never auto-enrolls a broadcast — nothing " +
      "goes out until someone explicitly sends it.",
  },
];

export function triggerHelpNote(trigger: string): string | null {
  if (trigger === COHORT_MESSAGE_TRIGGER) {
    return "Cohort message campaigns are created and managed by the cohort message send flow.";
  }
  return TRIGGER_OPTIONS.find((option) => option.value === trigger)?.help ?? null;
}
