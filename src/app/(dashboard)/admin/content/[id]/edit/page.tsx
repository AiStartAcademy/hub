// src/app/(dashboard)/admin/content/[id]/edit/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import EditContentClient from "./EditContentClient";
import { hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Edit content | Admin" };

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }
  const { id } = await params;
  return <EditContentClient id={id} />;
}
