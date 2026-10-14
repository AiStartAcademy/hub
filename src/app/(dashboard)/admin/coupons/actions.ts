// src/app/(dashboard)/admin/coupons/actions.ts
//
// Admin server actions for discount codes. Creating a code writes to Stripe as
// well as the hub (see src/lib/coupons.ts) — the hub row owns applicability and
// redemption tracking, Stripe owns the price math at checkout.
//
// Deactivation is the only "delete": codes are never removed, because their
// Redemption rows are financial records and an affiliate's earnings hang off
// them.
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import {
  COUPON_APPLIES_TO,
  COUPON_KINDS,
  CouponInputError,
  createCoupon,
  deactivateCoupon,
  type CouponAppliesTo,
  type CouponKind,
} from "@/lib/coupons";

async function requireAdmin() {
  const session = await auth();
  if (!hasAnyRole(session?.user, ADMIN_ROLES)) {
    throw new Error("Forbidden");
  }
  return session!;
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export type CouponActionState = { error?: string; ok?: string };

export async function createCouponAction(
  _prev: CouponActionState,
  formData: FormData
): Promise<CouponActionState> {
  await requireAdmin();

  const kind = String(formData.get("kind") ?? "MANUAL");
  if (!COUPON_KINDS.includes(kind as CouponKind)) {
    return { error: "Invalid coupon kind" };
  }
  const appliesTo = String(formData.get("appliesTo") ?? "all");
  if (!COUPON_APPLIES_TO.includes(appliesTo as CouponAppliesTo)) {
    return { error: "Invalid applies-to value" };
  }

  const discountType = String(formData.get("discountType") ?? "percent");
  const discountValue = optionalInt(formData.get("discountValue"));
  if (discountValue == null || discountValue <= 0) {
    return { error: "Enter a discount amount" };
  }

  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { error: "Invalid expiry date" };
  }

  try {
    const coupon = await createCoupon({
      code: String(formData.get("code") ?? ""),
      kind: kind as CouponKind,
      appliesTo: appliesTo as CouponAppliesTo,
      // Dollars in the form, cents in the model — money never travels as a float.
      percentOff: discountType === "percent" ? discountValue : null,
      amountOff: discountType === "amount" ? discountValue * 100 : null,
      cohortId: String(formData.get("cohortId") ?? "") || null,
      maxRedemptions: optionalInt(formData.get("maxRedemptions")),
      expiresAt,
      note: String(formData.get("note") ?? "").trim() || null,
    });
    revalidatePath("/admin/coupons");
    return { ok: `Created ${coupon.code}` };
  } catch (error) {
    if (error instanceof CouponInputError) return { error: error.message };
    return {
      error:
        error instanceof Error
          ? `Stripe rejected the code: ${error.message}`
          : "Failed to create the code",
    };
  }
}

export async function deactivateCouponAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing coupon id");
  await deactivateCoupon(id);
  revalidatePath("/admin/coupons");
}
