import { brand } from "@/config/brand";

export const AGREEMENT_PUBLIC_BASE_URL = brand.urls.hub;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type VenueAgreementPaymentState = {
  dealType: string;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
};

export function resolvePostSignPaymentUrl(
  event: VenueAgreementPaymentState,
): string | null {
  if (event.dealType !== "PAID_RENTAL" || event.rentalPaymentStatus === "paid") {
    return null;
  }

  const paymentUrl = event.rentalPaymentUrl?.trim() ?? "";
  return paymentUrl.length > 0 ? paymentUrl : null;
}

export function withPrefilledEmail(url: string, email: string | null): string {
  const normalizedEmail = email?.trim() ?? "";
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return url;
  }

  try {
    const paymentUrl = new URL(url);
    paymentUrl.searchParams.set("prefilled_email", normalizedEmail);
    return paymentUrl.toString();
  } catch {
    return url;
  }
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatRentalAmountSummary(
  feeCents: number | null,
  depositCents: number | null,
): string | null {
  if (feeCents === null) {
    return null;
  }

  const fee = formatUsd(feeCents);
  return depositCents && depositCents > 0
    ? `${fee} + ${formatUsd(depositCents)} refundable deposit`
    : fee;
}

export function buildAgreementReturnUrl(token: string): string {
  return `${AGREEMENT_PUBLIC_BASE_URL}/agreements/${token}?paid=1`;
}
