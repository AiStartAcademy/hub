const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Formats an integer USD minor-unit amount as a monthly display price. */
export function formatMonthlyPrice(amountCents: number): string {
  return `${usd.format(amountCents / 100)}/mo`;
}

export function formatMembershipTierPriceLabel(tier: {
  label: string;
  amountCents: number;
}): string {
  return `${tier.label} (${formatMonthlyPrice(tier.amountCents)})`;
}
