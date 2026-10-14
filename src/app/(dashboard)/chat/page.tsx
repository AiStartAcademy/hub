import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { provisionChatUser } from "@/lib/chat/provisionUser";
import { RocketChatService } from "@/lib/rocketchat";
import { RocketChatEmbed } from "@/components/chat/RocketChatEmbed";
import { ChatSignInNotice } from "@/components/chat/ChatSignInNotice";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true },
  });
  if (!user) redirect("/dashboard");

  await provisionChatUser({
    id: session.user.id,
    name: user.name,
    email: user.email,
  });
  const authToken = await RocketChatService.createIframeToken(user.email);

  if (!process.env.RC_URL) {
    return (
      <div className="flex flex-col w-full h-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-8 py-0 sm:py-6 gap-4">
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Chat is warming up</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Refresh in a minute.</p>
        </section>
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="flex flex-col w-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-8 py-0 sm:py-6 gap-4">
        <ChatSignInNotice chatUrl={process.env.RC_URL} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full max-w-7xl mx-auto px-0 sm:px-4 lg:px-8 py-0 sm:py-6 gap-4">
      <header className="hidden sm:block">
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
          Chat
        </h1>
        <p className="text-sm md:text-base text-slate-500">
          Every conversation you&apos;re part of — your cohorts, the members lounge, your pod, and direct messages.
        </p>
      </header>

      <div className="w-full h-full">
        <RocketChatEmbed
          chatUrl={process.env.RC_URL!}
          authToken={authToken}
          path="/home"
        />
      </div>
    </div>
  );
}
