// Server gate for /cohorts/[id]/pay/[groupId]. A $0 Group has nothing to pay
// for — bounce it back to the cohort rail's free registration form instead of
// creating a Stripe session. Paid groups render the client checkout body.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import PayClient from "./PayClient";

export default async function CohortPayPage({
  params,
}: {
  params: Promise<{ id: string; groupId: string }>;
}) {
  const { id, groupId } = await params;
  const group = await prisma.group.findFirst({
    where: { id: groupId, cohort: { OR: [{ id }, { slug: id }] } },
    select: { price: true, cohort: { select: { id: true, slug: true } } },
  });
  if (!group || group.price <= 0) {
    redirect(`/cohorts/${group?.cohort.slug ?? group?.cohort.id ?? id}#register`);
  }
  return <PayClient cohortId={id} groupId={groupId} />;
}
