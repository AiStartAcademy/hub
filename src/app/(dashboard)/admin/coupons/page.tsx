// src/app/(dashboard)/admin/coupons/page.tsx
//
// Discount codes: manual grants, printed-ad/QR campaign codes, and (later)
// ambassador referral codes. Each row is mirrored in Stripe; the share link
// is /join/CODE, which cookies the code and routes the visitor to the right
// page so the discount survives them browsing before they buy.

import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { CouponForm } from "./CouponForm";
import { deactivateCouponAction } from "./actions";

export const metadata = { title: "Coupons | Admin" };
export const dynamic = "force-dynamic";

function formatDiscount(coupon: { percentOff: number | null; amountOff: number | null }) {
  if (coupon.percentOff != null) return `${coupon.percentOff}% off`;
  if (coupon.amountOff != null) return `$${(coupon.amountOff / 100).toFixed(2)} off`;
  return "—";
}

export default async function AdminCouponsPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, ADMIN_ROLES)) redirect("/dashboard");

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

  const [coupons, cohorts] = await Promise.all([
    prisma.coupon.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      include: {
        _count: { select: { redemptions: true } },
        owner: { select: { name: true, email: true } },
        redemptions: { select: { amountOff: true } },
      },
      take: 300,
    }),
    prisma.cohort.findMany({
      where: { status: "ENROLLMENT" },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
      take: 50,
    }),
  ]);

  const totalDiscounted = coupons.reduce(
    (acc, c) => acc + c.redemptions.reduce((sum, r) => sum + r.amountOff, 0),
    0
  );

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Ticket className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
          Coupons
        </h1>
        <span className="ml-auto text-xs font-medium text-slate-500 dark:text-slate-400">
          {coupons.filter((c) => c.active).length} active ·{" "}
          ${(totalDiscounted / 100).toFixed(2)} discounted all-time
        </span>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 text-sm font-bold text-slate-900 dark:text-white">
              New code
            </h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Created in Stripe as well as here. Share it as{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
                {appUrl || brand.urls.hub}/join/CODE
              </code>{" "}
              — that link pre-applies the discount at checkout. Buyers can also
              type the code into Stripe Checkout directly.
            </p>
            <CouponForm cohorts={cohorts} />
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Discount</th>
                  <th className="px-4 py-3 font-semibold">Applies to</th>
                  <th className="px-4 py-3 font-semibold">Used</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                  <th className="px-4 py-3 font-semibold">Share link</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {coupons.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-slate-400"
                    >
                      No codes yet.
                    </td>
                  </tr>
                ) : (
                  coupons.map((coupon) => (
                    <tr
                      key={coupon.id}
                      className={coupon.active ? "" : "opacity-50"}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-slate-900 dark:text-white">
                          {coupon.code}
                        </span>
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {coupon.kind}
                        </span>
                        {coupon.note ? (
                          <p className="mt-0.5 text-xs text-slate-400">{coupon.note}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {formatDiscount(coupon)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {coupon.appliesTo}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {coupon._count.redemptions}
                        {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ""}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {coupon.owner?.name ?? coupon.owner?.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-slate-500 dark:text-slate-400">
                          /join/{coupon.code}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {coupon.active ? (
                          <form action={deactivateCouponAction}>
                            <input type="hidden" name="id" value={coupon.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-400">inactive</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </div>
  );
}
