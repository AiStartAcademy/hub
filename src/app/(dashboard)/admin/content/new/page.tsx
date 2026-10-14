// src/app/(dashboard)/admin/content/new/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import NewContentClient from "./NewContentClient";
import { hasAnyRole } from "@/lib/roles";

export const metadata = { title: "New content | Admin" };

export default async function NewContentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }
  const { type } = await searchParams;
  return <NewContentClient type={type === "LANDING" ? "LANDING" : "BLOG"} />;
}
