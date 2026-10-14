export const PUBLIC_COHORT_STATUSES = ["ENROLLMENT", "IN_PROGRESS", "COMPLETE"] as const;

/** The same predicate used by the public page's Upcoming cohorts section and the feed. */
export function isUpcomingPublicCohort(cohort: {
  status: string;
  leadMagnet: boolean;
}): boolean {
  return (
    !cohort.leadMagnet &&
    (cohort.status === "ENROLLMENT" || cohort.status === "IN_PROGRESS")
  );
}
