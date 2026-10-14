import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import IntegrationsClient from "./IntegrationsClient";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Integrations | Admin" };

// ADMIN only — stricter than the ADMIN+TEAM_MEMBER admin pages, because this holds live keys.
export default async function IntegrationsAdminPage() {
  const session = await auth();
  if (!session || !hasRole(session?.user, "ADMIN")) {
    redirect("/dashboard");
  }
  return <IntegrationsClient />;
}
