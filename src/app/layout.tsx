import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

import { Providers } from "@/components/Providers";
import CookieConsent from "@/components/CookieConsent";
import AnalyticsClicks from "@/components/AnalyticsClicks";
import UtmCapture from "@/components/UtmCapture";
import MetaPixel from "@/components/MetaPixel";
import { FaroProvider } from '@/components/FaroProvider';
import { brand } from "@/config/brand";
import { CONSENT_MODE_INIT_SCRIPT } from "@/lib/cookieConsent";
import { GTM_CONTAINER_ID } from "@/config/catalog";

const GTM_ID = GTM_CONTAINER_ID;

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || brand.urls.hub;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${brand.name} — Learning Hub`,
    template: `%s — ${brand.name}`,
  },
  description:
    `The ${brand.name} learning hub — cohort-based, hands-on AI automation training for founders, operators, and professionals. Deploy real AI systems, not theory.`,
  applicationName: brand.hubName,
  keywords: [
    brand.name,
    "AI automation",
    "AI bootcamp",
    "AI workshops",
    "learning management system",
    "cohort-based courses",
    "AI agency",
    brand.address.city,
  ],
  authors: [{ name: brand.name, url: brand.urls.site }],
  creator: brand.name,
  publisher: brand.name,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: brand.name,
    title: `${brand.name} — Learning Hub`,
    description:
      "Cohort-based, hands-on AI automation training. Deploy real AI systems, not theory.",
    url: SITE_URL,
    locale: "en_US",
    images: [{ url: brand.assets.logo, width: 1200, height: 630, alt: brand.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.name} — Learning Hub`,
    description:
      "Cohort-based, hands-on AI automation training. Deploy real AI systems, not theory.",
    images: [brand.assets.logo],
  },
  icons: {
    icon: brand.assets.favicon,
    apple: brand.assets.logo,
  },
  // The hub is a login-gated app. Index only the public marketing/legal pages;
  // authenticated, auth, and onboarding routes opt out via their own metadata.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

// Organization / EducationalOrganization structured data for brand recognition.
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: brand.name,
  alternateName: brand.shortName,
  url: brand.urls.site,
  logo: `${SITE_URL}${brand.assets.logo}`,
  description:
    `In-person and online AI automation training for founders, operators, and professionals in ${brand.address.city}.`,
  email: brand.email.contact,
  telephone: brand.phone.schema,
  address: {
    "@type": "PostalAddress",
    streetAddress: brand.address.street,
    addressLocality: brand.address.city,
    addressRegion: brand.address.region,
    addressCountry: brand.address.country,
  },
  sameAs: [
    brand.social.linkedin,
    brand.social.youtube,
    brand.social.skool,
    brand.social.lumaLegacy,
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Google Consent Mode v2 defaults — MUST stay above the GTM snippet.
          Denies ads/analytics storage until the visitor accepts in the cookie
          banner; replays a stored grant for returning visitors. See
          src/lib/consent.ts.
        */}
        <Script
          id="consent-mode-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: CONSENT_MODE_INIT_SCRIPT }}
        />
        {/* Google Tag Manager (skipped when no container id is configured) */}
        {GTM_ID && (
          <Script id="gtm-init" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
          </Script>
        )}
        {/* End Google Tag Manager */}
      </head>
      <body className="bg-[#F8F9FA] dark:bg-[#1B1F3B] text-[#11131D] dark:text-[#F8F9FA] antialiased">
        {/* FaroProvider calls useSession, so it must live inside Providers
            (SessionProvider) — outside it, every page 500s on render. */}
        <Providers>
        <FaroProvider>
          {/*
            The GTM <noscript> iframe was removed deliberately: it loads the
            container with no way to apply Consent Mode defaults (which are set
            by JS), so it would fire tags for visitors who cannot be asked for
            consent. No-JS visitors are not measurable in any case.
          */}
          <Script
            id="organization-schema"
            type="application/ld+json"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
          />
          {children}
          <MetaPixel />
          <UtmCapture />
          <AnalyticsClicks />
          <CookieConsent />
        </FaroProvider>
        </Providers>
      </body>
    </html>
  );
}
