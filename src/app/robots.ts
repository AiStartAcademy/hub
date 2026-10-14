import type { MetadataRoute } from "next";

import { brand } from "@/config/brand";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || brand.urls.hub;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep the authenticated app, APIs, auth screens, and private
        // onboarding forms out of search indexes.
        // /courses, /assets, and /cohorts are public-facing and intentionally indexable.
        disallow: [
          "/api/",
          "/media",
          "/admin",
          "/dashboard",
          "/settings",
          "/mind-health",
          "/onboarding-responses",
          "/users",
          "/login",
          "/register",
          "/verify-email",
          "/set-password",
          "/onboarding/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
