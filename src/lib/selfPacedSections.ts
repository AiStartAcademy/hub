import type { SelfPacedPageContent } from "@/config/content";

type OptionalSelfPacedSections = Pick<
  SelfPacedPageContent,
  "stories" | "testimonial" | "stats" | "faq"
>;

export interface SelfPacedSectionVisibility {
  stories: boolean;
  testimonial: boolean;
  stats: boolean;
  faq: boolean;
}

export function getSelfPacedSectionVisibility(
  content: OptionalSelfPacedSections,
): SelfPacedSectionVisibility {
  return {
    stories: content.stories.length > 0,
    testimonial: content.testimonial !== null,
    stats: content.stats.length > 0,
    faq: content.faq.length > 0,
  };
}

export interface SelfPacedCopyValues {
  brandName: string;
  city: string;
  contactEmail: string;
  neighborhood: string;
  price: string;
  recordingsPrice: string;
  sessionCount: number;
  totalHours: number;
}

/** Resolves the finite set of data placeholders supported by self-paced copy. */
export function renderSelfPacedCopy(
  value: string,
  replacements: SelfPacedCopyValues,
): string {
  return value
    .replaceAll("{{BRAND_NAME}}", replacements.brandName)
    .replaceAll("{{CITY}}", replacements.city)
    .replaceAll("{{CONTACT_EMAIL}}", replacements.contactEmail)
    .replaceAll("{{NEIGHBORHOOD}}", replacements.neighborhood)
    .replaceAll("{{PRICE}}", replacements.price)
    .replaceAll("{{RECORDINGS_PRICE}}", replacements.recordingsPrice)
    .replaceAll("{{SESSION_COUNT}}", String(replacements.sessionCount))
    .replaceAll("{{TOTAL_HOURS}}", String(replacements.totalHours));
}
