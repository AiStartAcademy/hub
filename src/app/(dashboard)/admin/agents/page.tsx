// src/app/(dashboard)/admin/agents/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import AgentsClient from "./AgentsClient";
import { hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Agents | Admin" };

export default async function AgentsAdminPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }
  return <AgentsClient />;
}
