// src/app/(dashboard)/cohorts/[id]/chat/page.tsx
//
// Standalone full-page cohort chat. Shares its access rule and channel-name
// resolution with /api/cohorts/[id]/chat so the two cannot drift.

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RocketChatService } from '@/lib/rocketchat';
import { RocketChatEmbed } from '@/components/chat/RocketChatEmbed';
import { ChatSignInNotice } from '@/components/chat/ChatSignInNotice';
import { canAccessCohortChat, cohortChannelName } from '@/lib/chat/cohortChatAccess';
import { provisionChatUser } from '@/lib/chat/provisionUser';

interface CohortChatPageProps {
  params: Promise<{ id: string }>;
}

export default async function CohortChatPage({ params }: CohortChatPageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const [user, cohort] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, role: true, roles: true, rocketchatId: true },
    }),
    prisma.cohort.findUnique({
      where: { id },
      select: { id: true, title: true, rocketchatGroupId: true, rocketchatChannelName: true },
    }),
  ]);

  if (!user || !cohort) redirect('/dashboard');

  // Same membership rule as the cohort page selector and the chat API.
  const [groupMemberCount, enrollmentCount] = await Promise.all([
    prisma.groupMember.count({ where: { userId: user.id, group: { cohortId: cohort.id } } }),
    prisma.enrollment.count({ where: { userId: user.id, cohortId: cohort.id } }),
  ]);
  if (!canAccessCohortChat({ user, groupMemberCount, enrollmentCount })) {
    redirect(`/cohorts/${cohort.id}`);
  }

  const rcUserId = await provisionChatUser(user);
  const authToken = rcUserId ? await RocketChatService.createIframeToken(user.email) : null;

  let knownName = cohort.rocketchatChannelName;
  if (!knownName && cohort.rocketchatGroupId) {
    knownName = await RocketChatService.getGroupNameById(cohort.rocketchatGroupId);
  }
  const channelName = cohortChannelName({ ...cohort, rocketchatChannelName: knownName });

  if (!authToken) {
    return <ChatSignInNotice chatUrl={process.env.RC_URL} channelName={channelName} />;
  }

  return (
    <div className="flex flex-col w-full h-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-8 py-0 sm:py-6 gap-4">
      <header className="hidden sm:block">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
          Cohort Chat: {cohort.title}
        </h1>
        <p className="text-sm md:text-base text-slate-500">
          Discuss with your peers and managers. Start a direct message by clicking on an avatar.
        </p>
      </header>

      <div className="w-full h-full">
        <RocketChatEmbed
          chatUrl={process.env.RC_URL!}
          authToken={authToken}
          channelName={channelName}
        />
      </div>
    </div>
  );
}
