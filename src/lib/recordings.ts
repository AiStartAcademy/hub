// src/lib/recordings.ts
//
// The cross-cohort recordings feed.
//
// A recording in this system is a **video Lesson**: `src/lib/zoom.ts` turns each
// Zoom cloud recording into a Lesson (`videoUrl` + `zoomFileId`) inside the
// cohort's raw Program, then points `CohortSession.recordingLink` at the lesson
// viewer. So the lesson row — not the session row — is the thing that holds a
// playable URL, and that is what we read here.
//
// The feed is deliberately NOT scoped to the viewer's enrollments: the whole
// point is to show everyone what exists across every cohort. Access is enforced
// on the *payload* instead — non-members get title, topics and summary (the
// teaser) but never the video URL or the lesson link. That is why gating lives
// here in the query layer and not in the component: a client-side lock would
// still have shipped the media key in the HTML.

import prisma from "@/lib/prisma";
import { getMembershipSnapshot, hasEntitlement } from "@/lib/entitlements";
import type { RoleSource } from "@/lib/roles";

export interface RecordingItem {
  id: string;
  title: string;
  /** Cohort the recording came from, for the card subtitle. */
  context: string;
  /** One-paragraph breakdown of what the session covered (Lesson.intro). */
  summary: string | null;
  /** Topic chips, from the lesson's comma-separated tags. */
  topics: string[];
  /** Seconds; 0 when unknown (the Zoom import does not always set it). */
  duration: number;
  recordedAt: Date;
  /** Members only — `null` for everyone else, so the key never reaches them. */
  videoUrl: string | null;
  posterUrl: string | null;
  /** Members only — link into the full course. */
  href: string | null;
}

export interface RecordingsFeed {
  items: RecordingItem[];
  /** Whether this viewer may actually play the videos. */
  isMember: boolean;
}

const MAX_TOPICS = 4;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The Zoom import writes `tags` as a comma-separated list of phrases, and its
 * first entry is very often a restatement of the lesson title — rendering that
 * as a chip right under the title reads as a bug. Drop title-duplicates and
 * anything too long to sit on one line.
 */
function parseTopics(tags: string | null, title: string): string[] {
  if (!tags) return [];
  const titleKey = normalize(title);
  const seen = new Set<string>();

  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => {
      if (!t || t.length > 40) return false;
      const key = normalize(t);
      if (!key || key === titleKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TOPICS);
}

/**
 * Staff always have access. Otherwise it takes an active subscription —
 * either tier, since Accelerator is a superset of the recordings membership.
 * Mirrors the `member` branch of `checkProgramAccess`.
 */
export async function isRecordingsMember(
  roleSource: RoleSource,
  userId: string | undefined
): Promise<boolean> {
  const snap = await getMembershipSnapshot(userId);
  return hasEntitlement(snap, "recordings", roleSource);
}

export async function getRecordingsFeed(
  roleSource: RoleSource,
  userId: string | undefined,
  limit = 8
): Promise<RecordingsFeed> {
  const isMember = await isRecordingsMember(roleSource, userId);

  const lessons = await prisma.lesson.findMany({
    where: {
      // `type` is not reliably "video" on Zoom-imported rows, so the presence of
      // a URL is the real predicate. Both filters run in the database, because a
      // non-member's rows come back without `videoUrl` to filter on in memory.
      videoUrl: { not: null },
      NOT: { videoUrl: "" },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      intro: true,
      tags: true,
      duration: true,
      // Never even read the media key for a non-member. Nulling it after the
      // fact would cover the rendered payload, but not selecting it keeps the
      // key out of query logs and tracing too.
      videoUrl: isMember,
      posterUrl: isMember,
      createdAt: true,
      module: {
        select: {
          program: {
            select: {
              id: true,
              name: true,
              rawCohort: { select: { title: true } },
              cohorts: { select: { title: true }, take: 1 },
            },
          },
        },
      },
    },
  });

  const items = lessons.map((l) => {
    const program = l.module.program;
    return {
      id: l.id,
      title: l.name,
      context: program.rawCohort?.title ?? program.cohorts[0]?.title ?? program.name,
      summary: l.intro,
      topics: parseTopics(l.tags, l.name),
      duration: l.duration ?? 0,
      recordedAt: l.createdAt,
      videoUrl: isMember ? (l.videoUrl as string) : null,
      posterUrl: isMember ? (l.posterUrl as string | null) : null,
      href: isMember ? `/courses/${program.id}/${l.id}` : null,
    };
  });

  return { items, isMember };
}
