import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOnboardingForms } from "./actions";
import OnboardingListClient from "./OnboardingListClient";
import { hasRole } from "@/lib/roles";

export default async function AdminOnboardingPage() {
  const session = await auth();
  if (!hasRole(session?.user, "ADMIN")) redirect("/dashboard");

  const forms = await getOnboardingForms();
  return <OnboardingListClient forms={forms as any} />;
}
