// src/components/TestimonialsSection.tsx
"use client";

import { useState } from "react";
import { Play, Quote, Star } from "lucide-react";
import { brand } from "@/config/brand";
import {
  featuredTestimonials,
  testimonials,
  videoWallTestimonials,
  type Testimonial,
} from "@/lib/testimonials";

/** A single click-to-play YouTube testimonial card. */
function VideoCard({
  t,
  featured = false,
}: {
  t: Testimonial;
  featured?: boolean;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#23284A] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
        featured ? "hover:shadow-primary/10" : ""
      }`}
    >
      {/* Video / thumbnail */}
      <div className="relative aspect-video w-full bg-[#11131D]">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${t.youtubeId}?autoplay=1&rel=0`}
            title={t.name ? `${t.name} — testimonial` : "Student testimonial"}
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play testimonial${t.name ? ` from ${t.name}` : ""}`}
            className="absolute inset-0 h-full w-full"
          >
            <img
              src={`https://i.ytimg.com/vi/${t.youtubeId}/maxresdefault.jpg`}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity duration-300 group-hover:opacity-100"
              onError={(e) => {
                const img = e.currentTarget;
                img.onerror = null;
                img.src = `https://i.ytimg.com/vi/${t.youtubeId}/hqdefault.jpg`;
              }}
            />
            {/* teal→violet scrim */}
            <span className="absolute inset-0 bg-gradient-to-t from-[#11131D]/70 via-transparent to-transparent" />
            {/* play button */}
            <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform duration-300 group-hover:scale-110">
              <Play className="ml-0.5 h-6 w-6 fill-[#720987] text-[#720987]" />
            </span>
          </button>
        )}
      </div>

      {/* Caption */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        {featured && t.quote && (
          <div className="relative">
            <Quote className="absolute -left-1 -top-1 h-5 w-5 text-primary/30" />
            <p className="pl-6 text-[15px] font-medium leading-relaxed text-[#11131D] dark:text-[#F8F9FA]">
              {t.quote}
            </p>
          </div>
        )}
        {!featured && t.quote && (
          <p className="text-sm leading-relaxed text-[#6C757D] dark:text-[#9AA3B2]">
            “{t.quote}”
          </p>
        )}

        <div className="mt-auto flex items-center gap-3 pt-1">
          <span
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg,#00F5D4,#7209B7)" }}
            aria-hidden="true"
          >
            {(t.name ?? brand.name)
              .split(" ")
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
          </span>
          <div className="min-w-0">
            {t.name && (
              <p className="truncate text-sm font-semibold text-[#11131D] dark:text-[#F8F9FA]">
                {t.name}
              </p>
            )}
            <p className="truncate text-xs text-[#6C757D] dark:text-[#9AA3B2]">
              {t.role}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function TestimonialsSection() {
  if (testimonials.length === 0) {
    return (
      <p className="rounded-2xl border border-[#D9DEE8] bg-white p-8 text-center text-sm text-[#6C757D] dark:border-[#2e3560] dark:bg-[#23284A] dark:text-[#9AA3B2]">
        No testimonials yet
      </p>
    );
  }

  return (
    <section className="space-y-10">
      {/* Section header — hero gradient reserved for this stage element */}
      <div className="overflow-hidden rounded-2xl border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#23284A]">
        <div
          className="relative px-6 py-10 md:px-10 md:py-12"
          style={{
            background:
              "linear-gradient(135deg,#1B1F3B 0%,#3A0CA3 60%,#720987 100%)",
          }}
        >
          <div className="relative z-10 max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#56E9EB] ring-1 ring-inset ring-[#56E9EB]/30">
              <Star className="h-3.5 w-3.5 fill-[#56E9EB]" />
              Student results
            </span>
            <h2
              className="mt-4 text-3xl font-bold leading-tight text-white md:text-4xl"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              From curious to deployed —{" "}
              <span
                className="bg-gradient-to-r from-[#00F5D4] to-[#56E9EB] bg-clip-text text-transparent"
              >
                in their own words
              </span>
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70 md:text-base">
              Founders, engineers, and career-changers who came through our {brand.address.city}
              {" "}AI Automation Bootcamp — building secure assistants,
              live voice agents, and real automations they took home.
            </p>
          </div>
          {/* soft ribbon motif */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-30 blur-2xl"
            style={{ background: "radial-gradient(circle,#00F5D4,transparent 70%)" }}
          />
        </div>
      </div>

      {/* Featured testimonials */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {featuredTestimonials.map((t) => (
          <VideoCard key={t.youtubeId} t={t} featured />
        ))}
      </div>

      {/* Video wall */}
      {videoWallTestimonials.length > 0 && <div>
        <h3
          className="mb-5 text-lg font-semibold text-[#11131D] dark:text-[#F8F9FA]"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          More from our students
        </h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {videoWallTestimonials.map((t) => (
            <VideoCard key={t.youtubeId} t={t} />
          ))}
        </div>
      </div>}
    </section>
  );
}
