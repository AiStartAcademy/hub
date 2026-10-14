import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAllOnboardingResponses, getOnboardingForms } from "../admin/onboarding/actions";
import OnboardingResponsesClient from "./OnboardingResponsesClient";
import { hasAnyRole } from "@/lib/roles";

export default async function OnboardingResponsesPage() {
  const session = await auth();
  if (!hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) redirect("/dashboard");

  const [responses, forms] = await Promise.all([
    getAllOnboardingResponses(),
    getOnboardingForms(),
  ]);

  return <OnboardingResponsesClient responses={responses as any} forms={forms as any} />;
}
