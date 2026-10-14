// src/lib/brandTokens.ts
//
// Substitutes `{{brand.<token>}}` placeholders in shipped text assets (legal
// markdown, agreement templates) with values from src/config/brand.ts, so the
// documents name whichever academy the brand file describes.
//
// The dotted `brand.` prefix keeps these distinct from agreement variables
// (`{{orgName}}`), whose placeholder pattern only matches `[a-zA-Z0-9_]`.
// An unknown brand token is a programming error in a shipped document and
// throws at load time rather than rendering a raw placeholder to a signer.
import {
  brand,
  brandCityAddress,
  brandFullAddress,
  brandLegalAddress,
  brandStreetCity,
} from "@/config/brand";

export const BRAND_TOKEN_VALUES: Readonly<Record<string, string>> = Object.freeze({
  "brand.name": brand.name,
  "brand.wordmark": brand.wordmark,
  "brand.shortName": brand.shortName,
  "brand.legalName": brand.legalName,
  "brand.hubName": brand.hubName,
  "brand.domains.site": brand.domains.site,
  "brand.domains.hub": brand.domains.hub,
  "brand.urls.site": brand.urls.site,
  "brand.urls.hub": brand.urls.hub,
  "brand.email.contact": brand.email.contact,
  "brand.email.privacy": brand.email.privacy,
  "brand.email.legal": brand.email.legal,
  "brand.legal.governingLaw": brand.legal.governingLaw,
  "brand.legal.venueCounty": brand.legal.venueCounty,
  "brand.address.street": brand.address.street,
  "brand.address.city": brand.address.city,
  "brand.address.regionName": brand.address.regionName,
  "brand.fullAddress": brandFullAddress,
  "brand.cityAddress": brandCityAddress,
  "brand.streetCity": brandStreetCity,
  "brand.legalAddress": brandLegalAddress,
});

const BRAND_TOKEN_PATTERN = /{{\s*(brand\.[a-zA-Z0-9_.]+)\s*}}/g;

/**
 * Replace every `{{brand.*}}` token in `text`. `source` names the document in
 * the error when a token is unknown.
 */
export function renderBrandTokens(text: string, source: string): string {
  return text.replace(BRAND_TOKEN_PATTERN, (_match, token: string) => {
    const value = BRAND_TOKEN_VALUES[token];
    if (value === undefined) {
      throw new Error(`Unknown brand token {{${token}}} in ${source}`);
    }
    return value;
  });
}
