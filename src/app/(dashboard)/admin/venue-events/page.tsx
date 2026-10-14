import { auth } from "@/lib/auth";
import { brand } from "@/config/brand";
import { TEMPLATE_VARIABLE_SPECS } from "@/lib/agreementTemplates";
import { hasAnyRole } from "@/lib/roles";
import { redirect } from "next/navigation";

import VenueEventsClient from "./VenueEventsClient";

export const metadata = { title: "Venue Events | Admin" };
export const dynamic = "force-dynamic";

export default async function VenueEventsPage() {
  const session = await auth();

  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Venue events</h1>
        <p className="text-sm text-muted-foreground">
          Partner event requests for {brand.address.street} — approve, decline, and
          issue agreements.
        </p>
      </div>

      <VenueEventsClient variableSpecs={TEMPLATE_VARIABLE_SPECS} />
    </div>
  );
}
