import { nextSessionJoinLink } from "@/lib/freeSeat";
import { mergeFirstName, type CohortMessageMergeValues } from "./smsText";

export * from "./smsText";

export type CohortMessageCohort = {
  title: string;
  zoomLink: string | null;
  timezone: string;
  sessions: Array<{
    id: string;
    date: Date;
    startTime: string;
    endTime: string;
    timezone: string | null;
    meetingLink: string | null;
  }>;
};

/** Resolve all cohort message merge values from current Hub data at send time. */
export function resolveCohortMessageMergeValues(
  cohort: CohortMessageCohort,
  contact: { name: string | null },
  now: Date
): CohortMessageMergeValues {
  const nextSession = nextSessionJoinLink(
    {
      zoomLink: cohort.zoomLink,
      sessions: cohort.sessions.map((session) => ({
        ...session,
        timezone: session.timezone ?? cohort.timezone,
      })),
    },
    now
  );

  return {
    firstName: mergeFirstName(contact.name),
    cohortName: cohort.title,
    nextSessionDate: nextSession?.whenLine ?? "",
    sessionLink: nextSession?.link ?? "",
  };
}
