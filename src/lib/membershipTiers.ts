import { brand } from "@/config/brand";
import {
  content,
  type ContentMembershipTier,
  type ContentMembershipTierId,
} from "@/config/content";

export const MEMBERSHIP_TIER_IDS = ["MENTOR_NETWORK", "ACCELERATOR"] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIER_IDS)[number];

export interface MembershipTierConfig extends Omit<ContentMembershipTier, "id"> {
  productName: string;
  priceIdEnvVar: string;
  buildsOn?: MembershipTier;
}

const OPERATIONAL_CONFIG: Record<
  MembershipTier,
  Pick<MembershipTierConfig, "priceIdEnvVar"> & {
    productName: (tier: ContentMembershipTier) => string;
    buildsOn?: MembershipTier;
  }
> = {
  // The key stays MENTOR_NETWORK: it is persisted in Membership.tier on every
  // existing row. Stripe secret names and entitlement relationships are
  // operational behavior, so they deliberately remain outside content config.
  MENTOR_NETWORK: {
    priceIdEnvVar: "STRIPE_MEMBERSHIP_RECORDINGS_PRICE_ID",
    productName: (tier) => `${brand.products.membership} — ${tier.label}`,
  },
  ACCELERATOR: {
    priceIdEnvVar: "STRIPE_MEMBERSHIP_ACCELERATOR_PRICE_ID",
    productName: (tier) => tier.cardTitle,
    buildsOn: "MENTOR_NETWORK",
  },
};

function isMembershipTier(value: ContentMembershipTierId): value is MembershipTier {
  return (MEMBERSHIP_TIER_IDS as readonly string[]).includes(value);
}

const configuredTiers = content.membershipTiers.filter(
  (tier): tier is ContentMembershipTier & { id: MembershipTier } => isMembershipTier(tier.id),
);

/** Display order. An empty content list disables public membership promotion. */
export const MEMBERSHIP_TIERS: MembershipTier[] = configuredTiers.map((tier) => tier.id);

export const MEMBERSHIP_TIER_CONFIG = Object.fromEntries(
  configuredTiers.map((tier) => {
    const operational = OPERATIONAL_CONFIG[tier.id];
    const buildsOn =
      operational.buildsOn && MEMBERSHIP_TIERS.includes(operational.buildsOn)
        ? operational.buildsOn
        : undefined;
    const config: MembershipTierConfig = {
      label: tier.label,
      cardTitle: tier.cardTitle,
      description: tier.description,
      amountCents: tier.amountCents,
      tagline: tier.tagline,
      bestFor: tier.bestFor,
      features: tier.features,
      productName: operational.productName(tier),
      priceIdEnvVar: operational.priceIdEnvVar,
      ...(buildsOn ? { buildsOn } : {}),
    };
    return [tier.id, config];
  }),
) as Record<MembershipTier, MembershipTierConfig>;
