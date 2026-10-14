// src/app/(dashboard)/members/community/page.tsx
//
// The members-lounge chat, embedded in-hub. Mirrors the cohort chat page but
// gates on the `community` entitlement and provisions the shared lounge group.

import { redirect } from "next/navigation";
import Link from "next/link";
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembershipSnapshot, hasEntitlement } from "@/lib/entitlements";
import { provisionMemberChat, MEMBERS_LOUNGE_GROUP } from "@/lib/memberChat";
import { RocketChatService } from "@/lib/rocketchat";
import { RocketChatEmbed } from "@/components/chat/RocketChatEmbed";

export default async function MembersCommunityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const snap = await getMembershipSnapshot(session.user.id);
  if (!hasEntitlement(snap, "community", session.user)) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          Members community
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          The community lounge is part of the membership. Join to connect with
          members, alumni, and coaches.
        </p>
        <Link
          href="/members"
          className="inline-block px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
        >
          Explore memberships
        </Link>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (!user) redirect("/dashboard");

  await provisionMemberChat(session.user.id);
  const authToken = await RocketChatService.createIframeToken(user.email);

  if (!authToken) {
    return (
      <div className="p-4 sm:p-6 text-center text-red-600 bg-red-50 rounded-lg">
        <p className="text-sm md:text-base font-medium">
          Failed to authenticate with chat server. Try again in a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-8 py-0 sm:py-6 gap-4">
      <header className="hidden sm:block">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
          Members Lounge
        </h1>
        <p className="text-sm md:text-base text-slate-500">
          The community for all {brand.shortName} members — ask, share wins, find collaborators.
        </p>
      </header>

      <div className="w-full h-full">
        <RocketChatEmbed
          chatUrl={process.env.RC_URL!}
          authToken={authToken}
          channelName={MEMBERS_LOUNGE_GROUP}
        />
      </div>
    </div>
  );
}
