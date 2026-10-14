import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getOnboardingForm } from "../../actions";
import OnboardingBuilder from "./OnboardingBuilder";
import { hasRole } from "@/lib/roles";

export default async function EditOnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasRole(session?.user, "ADMIN")) redirect("/dashboard");

  const { id } = await params;
  const form = await getOnboardingForm(id);
  if (!form) notFound();

  return <OnboardingBuilder form={form} />;
}
