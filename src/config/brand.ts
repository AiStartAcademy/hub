// src/config/brand.ts
//
// The single source of every academy-specific value the hub shows or sends:
// names, domains, contact data, venue, social profiles, legal identity, and the
// copy fragments that must name the academy (SMS consent, email footers, ICS ids).
//
// To run the hub for your own academy, edit the values in `brand` below.
// Nothing else under src/ hardcodes the academy's name, domains, address, or
// contact details; tests/unit/brand-config.test.ts enforces that.
//
// Constraints:
// - Plain constant module: importable from server AND client components. No
//   "server-only", no node: imports, no env reads at import time.
// - These values flow into live copy, legal text, consent disclosures, and
//   structured data. Review src/content/legal/ with counsel before going live.

export interface BrandPostalAddress {
  /** Street line only, e.g. "100 Main Street". */
  street: string;
  city: string;
  /** Two-letter region code used in short addresses and schema.org. */
  region: string;
  /** Full region name used in legal prose. */
  regionName: string;
  postalCode: string;
  /** ISO-3166 alpha-2. */
  country: string;
}

export interface BrandVenue {
  /** Neighbourhood / district label used in copy. */
  neighborhood: string;
  /** Location card heading on /locations. */
  locationTitle: string;
  transit: string;
  parking: { label: string; href: string; note: string };
  mapsLink: string;
  /** Google Maps place embed for the academy's Business Profile listing. */
  mapEmbedSrc: string;
}

export interface Brand {
  /** Canonical academy name in prose: "Example Academy". */
  name: string;
  /** Stylized wordmark used in some UI, SMS, and ICS copy: "EXAMPLE academy". */
  wordmark: string;
  /** Acronym used in UI copy: "EA". */
  shortName: string;
  /** Registered legal entity: "Example Academy, Inc.". */
  legalName: string;
  /** Hub product name: "Example Academy Hub". */
  hubName: string;
  /** Short hub name for the PWA manifest: "Example Hub". */
  hubShortName: string;

  urls: {
    /** Public marketing site origin (no trailing slash). */
    site: string;
    /** www variant of the marketing site, allowed as a CORS origin. */
    siteWww: string;
    /** Hub origin (no trailing slash). Runtime code may override via NEXT_PUBLIC_APP_URL where it already did. */
    hub: string;
    /** Marketing-site terms page linked from SMS consent copy. */
    termsOfService: string;
    /** Marketing-site privacy page linked from SMS consent copy. */
    privacyPolicy: string;
    /** Example webhook URL shown as a placeholder in the Integrations admin. */
    automationsWebhookExample: string;
    /** Public proof-of-insurance document referenced in venue agreements. */
    insuranceCertificate: string;
    /** Grafana Faro collector baked into production builds when NEXT_PUBLIC_TELEMETRY_URL is unset. */
    telemetryCollector: string;
  };

  /** Bare hostnames, for prose like "operates hub.example.com and example.com". */
  domains: {
    site: string;
    hub: string;
  };

  email: {
    /** General contact / support inbox. */
    contact: string;
    privacy: string;
    legal: string;
    /** Placeholder recipient for admin email previews. Never delivered. */
    preview: string;
    /** Display name for From headers. */
    fromName: string;
  };

  phone: {
    /** Human-readable, e.g. "+1 555 010 0000". */
    display: string;
    /** schema.org telephone form, e.g. "+1-555-010-0000". */
    schema: string;
  };

  address: BrandPostalAddress;
  venue: BrandVenue;

  social: {
    linkedin: string;
    youtube: string;
    youtubeChannelId: string;
    skool: string;
    /** Luma calendar link used in schema.org sameAs. */
    lumaLegacy: string;
    /** Luma calendar link used in user-facing copy. */
    luma: string;
    /** Display label for `luma`, e.g. "luma.com/example". */
    lumaLabel: string;
  };

  assets: {
    /** Square logo under /public. */
    logo: string;
    /** Wide logo under /public. */
    logoWide: string;
    favicon: string;
    /** Countersignature image, repo-relative. Never served from /public. */
    signatureImage: string;
  };

  /** Identity used by the shipped HTML certificate templates. */
  certificate: {
    logoText: string;
    /** Image source inserted into templates that use an image logo. Empty hides the image. */
    logoImage: string;
    /** Image source inserted into templates that use a signature image. Empty hides the image. */
    signatureImage: string;
    /** Handwritten-style signature text used by the text-only template. Empty hides it. */
    signatureText: string;
  };

  /** Jurisdiction terms inserted into the legal markdown. */
  legal: {
    governingLaw: string;
    venueCounty: string;
  };

  /** Person who countersigns venue agreements. */
  signer: { name: string; title: string };

  /** First name the founder signs personal emails with. */
  founderFirstName: string;

  /** Title appended to the founder's name in email sign-offs. */
  founderTitle: string;

  /** Prefix every outbound SMS carries so recipients know the sender. */
  smsSenderPrefix: string;

  /** Default IANA timezone for the academy's in-person operations. */
  timezone: string;

  /** Stripe product names created at checkout. */
  products: {
    membership: string;
  };

  /** Identifier fragments embedded in machine-readable output. */
  ids: {
    /** ICS PRODID organisation segment. */
    icsOrganization: string;
    /** File-name prefix for lead-booking ICS attachments. */
    icsFilePrefix: string;
    /** schema.org / CAPI lead_event_source label. */
    leadEventSource: string;
    /** MCP health-check service id. */
    serviceId: string;
    /** File-name prefix for the personal data export. */
    dataExportFilePrefix: string;
    /** File-name prefix for the admin sales CSV export. */
    salesExportFilePrefix: string;
  };
}

const SITE = "https://your-academy.example";
const HUB = "https://hub.your-academy.example";

export const brand: Brand = {
  name: "Example Academy",
  wordmark: "EXAMPLE academy",
  shortName: "EA",
  legalName: "Example Academy, Inc.",
  hubName: "Example Academy Hub",
  hubShortName: "Example Hub",

  urls: {
    site: SITE,
    siteWww: "https://www.your-academy.example",
    hub: HUB,
    termsOfService: `${SITE}/terms`,
    privacyPolicy: `${SITE}/privacy`,
    automationsWebhookExample: "https://automations.your-academy.example/webhook/...",
    insuranceCertificate: `${HUB}/documents/insurance-certificate.pdf`,
    // Empty disables browser telemetry unless NEXT_PUBLIC_TELEMETRY_URL is set.
    telemetryCollector: "",
  },

  domains: {
    site: "your-academy.example",
    hub: "hub.your-academy.example",
  },

  email: {
    contact: "hello@your-academy.example",
    privacy: "privacy@your-academy.example",
    legal: "legal@your-academy.example",
    preview: "preview@your-academy.example",
    fromName: "Example Academy",
  },

  phone: {
    display: "+1 555 010 0000",
    schema: "+1-555-010-0000",
  },

  address: {
    street: "100 Main Street",
    city: "Springfield",
    region: "CA",
    regionName: "California",
    postalCode: "90000",
    country: "US",
  },

  venue: {
    neighborhood: "Downtown",
    locationTitle: "Springfield — Downtown",
    transit: "Central Station — about a 5-minute walk",
    parking: {
      label: "Main Street Parking",
      href: "https://maps.google.com/?q=Main+Street+Parking",
      note: "2-minute walk; street parking also available",
    },
    mapsLink: "https://maps.google.com/?q=100+Main+Street",
    mapEmbedSrc: "https://maps.google.com/maps?q=100+Main+Street&output=embed",
  },

  social: {
    linkedin: "https://www.linkedin.com/company/example",
    youtube: "https://www.youtube.com/@example",
    youtubeChannelId: "",
    skool: "https://www.skool.com/example",
    lumaLegacy: "https://lu.ma/example",
    luma: "https://luma.com/example",
    lumaLabel: "luma.com/example",
  },

  assets: {
    logo: "/logo.png",
    logoWide: "/assets/big_logo.png",
    favicon: "/favicon.ico",
    signatureImage: "src/content/signatures/signature.png",
  },

  certificate: {
    logoText: "EXAMPLE",
    logoImage: "",
    signatureImage: "",
    signatureText: "",
  },

  legal: {
    governingLaw: "Example",
    venueCounty: "Example County",
  },

  signer: { name: "Alex Example", title: "President" },

  founderFirstName: "Alex",

  founderTitle: "Founder, Example Academy",

  smsSenderPrefix: "Example Academy: ",

  timezone: "America/Los_Angeles",

  products: {
    membership: "Example Academy Membership",
  },

  ids: {
    icsOrganization: "Example Academy",
    icsFilePrefix: "academy",
    leadEventSource: "Example Hub",
    serviceId: "academy-hub",
    dataExportFilePrefix: "academy-data-export",
    salesExportFilePrefix: "academy-sales",
  },
};

/** "100 Main Street, Springfield, CA 90000" */
export const brandFullAddress = `${brand.address.street}, ${brand.address.city}, ${brand.address.region} ${brand.address.postalCode}`;

/** "100 Main Street, Springfield, CA" */
export const brandCityAddress = `${brand.address.street}, ${brand.address.city}, ${brand.address.region}`;

/** "100 Main Street, Springfield" */
export const brandStreetCity = `${brand.address.street}, ${brand.address.city}`;

/** "100 Main Street, Springfield, California 90000" — legal prose form. */
export const brandLegalAddress = `${brand.address.street}, ${brand.address.city}, ${brand.address.regionName} ${brand.address.postalCode}`;

/** `"Example Academy" <hello@your-academy.example>` */
export const brandFromMailbox = `"${brand.email.fromName}" <${brand.email.contact}>`;
