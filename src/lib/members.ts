import prisma from "@/lib/prisma";
import {
  getMembershipEntitlements,
  tierAtLeast,
  type EntitlementKey,
  type MembershipSnapshot,
} from "@/lib/entitlements";
import { getUpcomingMemberEvents, type MemberEventItem } from "@/lib/memberEvents";
import { getLadder, type MilestoneLadderResult } from "@/lib/milestones";
import { getUserPod, type UserPodResult } from "@/lib/pods";
import { getRecordingsFeed, type RecordingsFeed } from "@/lib/recordings";
import type { RoleSource } from "@/lib/roles";

export interface MemberHomeLibraryPreviewItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  category: string | null;
  minTier: string;
  locked: boolean;
  url: string | null;
}

export interface MemberHomeData {
  snap: MembershipSnapshot;
  has: Record<EntitlementKey, boolean>;
  upcomingEvents: MemberEventItem[];
  pod: UserPodResult | null;
  ladder: MilestoneLadderResult;
  libraryPreview: MemberHomeLibraryPreviewItem[];
  recordings: RecordingsFeed;
}

function createEmptyEntitlements(): Record<EntitlementKey, boolean> {
  return {
    recordings: false,
    community: false,
    weeklyQa: false,
    memberLibrary: false,
    pod: false,
    coachingCalls: false,
    dealDesk: false,
    buildSprint: false,
    milestoneLadder: false,
  };
}

function createEmptyLadder(): MilestoneLadderResult {
  return {
    items: [],
    verifiedCount: 0,
  };
}

function createEmptyRecordings(): RecordingsFeed {
  return {
    items: [],
    isMember: false,
  };
}

async function getLibraryPreview(snap: MembershipSnapshot): Promise<MemberHomeLibraryPreviewItem[]> {
  const resources = await prisma.memberResource.findMany({
    where: { published: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: 4,
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      category: true,
      minTier: true,
      url: true,
    },
  });

  return resources.map((resource) => {
    const locked = !tierAtLeast(snap, resource.minTier);

    return {
      id: resource.id,
      title: resource.title,
      description: resource.description,
      type: resource.type,
      category: resource.category,
      minTier: resource.minTier,
      locked,
      // Row-level access depends on each resource's minTier, so we select url and strip it before returning locked rows.
      url: locked ? null : resource.url,
    };
  });
}

export async function getMemberHomeData(userId: string, roles: RoleSource): Promise<MemberHomeData> {
  const entitlementResult = await getMembershipEntitlements(userId, roles);
  const snap = entitlementResult.snap;
  const has = snap.isMember ? entitlementResult.has : createEmptyEntitlements();

  if (!snap.isMember) {
    return {
      snap,
      has,
      upcomingEvents: [],
      pod: null,
      ladder: createEmptyLadder(),
      libraryPreview: [],
      recordings: createEmptyRecordings(),
    };
  }

  const podPromise: Promise<UserPodResult | null> = has.pod
    ? getUserPod(userId)
    : Promise.resolve(null);
  const ladderPromise: Promise<MilestoneLadderResult> = has.milestoneLadder
    ? getLadder(userId)
    : Promise.resolve(createEmptyLadder());
  const libraryPreviewPromise: Promise<MemberHomeLibraryPreviewItem[]> = getLibraryPreview(snap);
  const recordingsPromise: Promise<RecordingsFeed> = getRecordingsFeed(roles, userId, 3);

  const pod = await podPromise;
  const podIds = pod ? [pod.id] : [];

  const [upcomingEvents, ladder, libraryPreview, recordings] = await Promise.all([
    getUpcomingMemberEvents(snap, { podIds, limit: 3 }),
    ladderPromise,
    libraryPreviewPromise,
    recordingsPromise,
  ]);

  return {
    snap,
    has,
    upcomingEvents,
    pod,
    ladder,
    libraryPreview,
    recordings,
  };
}
