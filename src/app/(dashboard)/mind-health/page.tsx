import { auth } from "@/lib/auth";
import { brand } from "@/config/brand";
import { MindHealthPageClient } from "@/components/mind-health/MindHealthPageClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Mind Health | ${brand.name}`,
  description: "Daily brain exercises to keep your intellect sharp",
};

export default async function MindHealthPage() {
  const session = await auth();

  const role = session
    ? (session.user as { role?: string }).role ?? "STUDENT"
    : "GUEST";

  return <MindHealthPageClient initialRole={role} />;
}
