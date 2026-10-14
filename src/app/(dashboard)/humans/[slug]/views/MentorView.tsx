// Mentor profile view (docs/features/VIEWS.md — Human profile / MentorView).
// Objective: book a 1:1. Same body as PublicProfileView plus a sticky booking rail.
//
// Booking is a contact intent, not checkout: HUMANS.md puts paid 1:1 booking out of
// scope for v1, and `InstructorSlot` is scoped to a `groupId` (cohort-internal), so it
// cannot back a public booking flow without a schema change. The authenticated
// slot/booking flow stays where it is; this CTA opens a prefilled email.
//
// The CTA itself is Accelerator-only (`canBookMentor`, computed in page.tsx): 1:1 mentor time
// is the Accelerator perk, while the $50 "Access To All Recordings" tier buys recordings alone.
// Only the booking card swaps to an upsell — the profile body stays public for everyone, so
// mentors remain discoverable and indexable. This is a soft upsell, not a paywall.
import Link from "next/link";
import { brand } from "@/config/brand";
import type { PublicHumanProfile } from "@/lib/humanProfile";
import { ProfileBody, ProfileHeader, PROFILE_CSS } from "./PublicProfileView";

const BOOKING_EMAIL = brand.email.contact;

export default function MentorView({
  human,
  canBookMentor,
}: {
  human: PublicHumanProfile;
  canBookMentor: boolean;
}) {
  const bookingCard = canBookMentor ? (
    <BookingCard human={human} />
  ) : (
    <div className="hp-card">
      <h3>Accelerator perk</h3>
      <p>
        1:1 mentorship is reserved for Accelerator members; Access To All Recordings covers the
        recordings library, not private mentor time.
      </p>
      <Link className="hp-btn" href="/cohorts">
        See Accelerator membership →
      </Link>
    </div>
  );

  return (
    <div className="hp-wrap">
      <style>{PROFILE_CSS}</style>
      <div className="hp-inner">
        <Link className="hp-back" href="/mentors">
          ← All mentors
        </Link>
        <ProfileHeader human={human} />

        <div className="hp-grid">
          <main>
            <ProfileBody human={human} />
          </main>

          <aside className="hp-rail">
            {bookingCard}
          </aside>
        </div>
      </div>
    </div>
  );
}

function BookingCard({ human }: { human: PublicHumanProfile }) {
  const subject = encodeURIComponent(`1:1 mentorship with ${human.name}`);
  const body = encodeURIComponent(
    `Hi — I'd like to book 1:1 time with ${human.name}.\n\nWhat I'm working on:\n\nWhat I'd like help with:\n\nMy timezone:\n`
  );

  return (
    <div className="hp-card">
      <h3>Book 1:1 time</h3>
      <p>
        Bring a real problem — a build you&apos;re stuck on, a pipeline that isn&apos;t
        converting, an agency you&apos;re launching.
      </p>
      {human.expertiseTags.length > 0 && (
        <ul className="hp-helps">
          {human.expertiseTags.slice(0, 5).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <a className="hp-btn" href={`mailto:${BOOKING_EMAIL}?subject=${subject}&body=${body}`}>
        Book time →
      </a>
      <p className="hp-hint">
        {/* Same reason as the header: "UTC" is the unset default, not a real location. */}
        {human.timezone && human.timezone !== "UTC" ? `Based in ${human.timezone}. ` : ""}
        We&apos;ll confirm a slot by email, usually within a day.
      </p>
    </div>
  );
}
