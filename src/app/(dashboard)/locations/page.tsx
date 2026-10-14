// src/app/(dashboard)/locations/page.tsx

import type { Metadata } from "next";
import { brand, brandFullAddress } from "@/config/brand";
import { content } from "@/config/content";
import { MapPin, Train, Car, ExternalLink, Mail, Phone } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";

export const metadata: Metadata = {
  title: `Locations · ${brand.name}`,
};

type Location = {
  slug: string;
  name: string;
  tagline: string;
  address: string;
  transit: string;
  parking: { label: string; href: string; note: string };
  mapsLink: string;
  /** Google Business Profile embed (Google Maps place embed for the academy listing). */
  embedSrc: string;
  email: string;
  phone: string;
};

const LOCATIONS: Location[] = [
  {
    slug: "san-francisco",
    name: brand.venue.locationTitle,
    tagline: content.locations.description,
    address: brandFullAddress,
    transit: brand.venue.transit,
    parking: brand.venue.parking,
    mapsLink: brand.venue.mapsLink,
    embedSrc: brand.venue.mapEmbedSrc,
    email: brand.email.contact,
    phone: brand.phone.display,
  },
];

export default function LocationsPage() {
  return (
    <>
      {/* Header */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MobileMenuButton />
          <div className="min-w-0">
            <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Locations
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              Where to find us in person
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 md:p-8">
        <div className="max-w-7xl mx-auto animate-fade-in space-y-8">
          {LOCATIONS.map((loc) => (
            <section
              key={loc.slug}
              className="rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900 overflow-hidden shadow-sm"
            >
              <div className="grid lg:grid-cols-2">
                {/* Details */}
                <div className="p-6 md:p-8 space-y-5">
                  <div>
                    <h2
                      className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white"
                      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {loc.name}
                    </h2>
                    <p className="mt-2 text-sm md:text-base text-slate-600 dark:text-slate-300">
                      {loc.tagline}
                    </p>
                  </div>

                  <dl className="space-y-4 text-sm">
                    <div className="flex gap-3">
                      <MapPin className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <dt className="font-semibold text-slate-900 dark:text-white">Address</dt>
                        <dd className="text-slate-600 dark:text-slate-300">{loc.address}</dd>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Train className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <dt className="font-semibold text-slate-900 dark:text-white">Public transit</dt>
                        <dd className="text-slate-600 dark:text-slate-300">{loc.transit}</dd>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Car className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <dt className="font-semibold text-slate-900 dark:text-white">Parking</dt>
                        <dd className="text-slate-600 dark:text-slate-300">
                          Closest is{" "}
                          <a
                            href={loc.parking.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {loc.parking.label}
                          </a>{" "}
                          — {loc.parking.note}.
                        </dd>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Mail className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <dt className="font-semibold text-slate-900 dark:text-white">Contact</dt>
                        <dd className="text-slate-600 dark:text-slate-300">
                          <a href={`mailto:${loc.email}`} className="text-primary hover:underline">
                            {loc.email}
                          </a>
                        </dd>
                        <dd className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5" />
                          <a
                            href={`tel:${loc.phone.replace(/\s/g, "")}`}
                            className="text-primary hover:underline"
                          >
                            {loc.phone}
                          </a>
                        </dd>
                      </div>
                    </div>
                  </dl>

                  <a
                    href={loc.mapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30"
                  >
                    Open in Google Maps
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>

                {/* Google Business Profile embed */}
                <div className="min-h-[320px] lg:min-h-[480px] bg-slate-100 dark:bg-slate-800">
                  <iframe
                    src={loc.embedSrc}
                    title={`${loc.name} — Google Business Profile map`}
                    className="w-full h-full min-h-[320px] lg:min-h-[480px] border-0"
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
