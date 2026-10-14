// src/app/(dashboard)/admin/content/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ContentClient from "./ContentClient";
import { hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Content | Admin" };

export default async function ContentAdminPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }
  return <ContentClient />;
}
