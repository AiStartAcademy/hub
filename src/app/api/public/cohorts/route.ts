import { loadPublicCohortRows } from "@/lib/publicCohorts.server";
import { createPublicCohortsHandlers } from "@/lib/publicCohortsFeed";

export const dynamic = "force-dynamic";

const handlers = createPublicCohortsHandlers({
  loadRows: loadPublicCohortRows,
  now: () => new Date(),
});

export const GET = handlers.GET;
export const OPTIONS = handlers.OPTIONS;
