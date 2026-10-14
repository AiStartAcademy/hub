"use client";
// src/app/(dashboard)/cohorts/CohortsPublic.tsx
// Public, Luma-style cohorts list (guest-friendly). Renders server-fetched cohort
// data; ticket tiers are selectable and flow into the existing Stripe checkout
// (POST /api/cohorts/[id]/checkout with the chosen groupId). Logged-out buyers
// enter name/email on the pay page; account creation happens after payment.
import { Fragment, useEffect, useState } from "react";
import { brand } from "@/config/brand";
import { content } from "@/config/content";
import { trackEvent } from "@/lib/analytics";
import FreeSeatForm, { isFreeTier } from "@/components/FreeSeatForm";
import {
  MEMBERSHIP_TIER_CONFIG,
  MEMBERSHIP_TIERS,
  type MembershipTier,
} from "@/lib/membershipTiers";
import { SESSION_TZ_FALLBACK, sessionWhenLines, viewerTimezone } from "@/lib/sessionTime";
import type { PublicCohort, PublicInstructor, PublicSession } from "@/lib/publicCohorts";
import { isUpcomingPublicCohort } from "@/lib/publicCohortVisibility";

export type { PublicCohort, PublicInstructor, PublicSession } from "@/lib/publicCohorts";

const AV_COLORS = ["#56e9eb", "#a06bff", "#00f5d4", "#7209b7", "#009da0"];
const fmtMoney = (n: number) => (n > 0 ? `$${n.toLocaleString()}` : "Free");
const fmtMembershipPrice = (amountCents: number) => `$${(amountCents / 100).toLocaleString("en-US")}`;
const initials = (name: string | null) =>
  (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

function formatWhen(c: PublicCohort): { dow: string; dates: string; time: string } {
  // Recurring cohorts (the Q&A) have no start/end date — they just have a rolling
  // list of sessions. Lead with the next one instead of a dead "Dates TBA".
  if (!c.startDate) {
    const next = c.schedule.find((s) => s.startTime);
    if (next?.startTime) {
      const d = new Date(next.startTime);
      const tz = next.timezone || SESSION_TZ_FALLBACK;
      const label = /q&a/i.test(c.title) ? "Next Q&A Date" : "Next date";
      const fmt = (zone: string) =>
        new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone }).format(d);
      let day: string | null = null;
      if (!Number.isNaN(d.getTime())) {
        try {
          day = fmt(tz);
        } catch {
          day = fmt(SESSION_TZ_FALLBACK); // Intl throws RangeError on unknown zones
        }
      }
      const dates = day ? `${label}: ${day}` : "Dates TBA";
      return { dow: "", dates, time: "" };
    }
    return { dow: "", dates: "Dates TBA", time: "" };
  }
  const s = new Date(c.startDate);
  const e = c.endDate ? new Date(c.endDate) : null;
  // startDate/endDate are calendar dates stored at UTC midnight — format/read them as UTC,
  // not the browser's local timezone, or a Pacific (UTC-behind) viewer sees the day before.
  const dow = s.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const sM = s.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  let dates = `${sM} ${s.getUTCDate()}`;
  if (e) {
    const eM = e.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    dates += sM === eM ? ` – ${e.getUTCDate()}` : ` – ${eM} ${e.getUTCDate()}`;
  }
  const time =
    c.startTime && c.endTime ? `${c.startTime} – ${c.endTime} ${c.timezone ?? ""}`.trim() : "";
  return { dow, dates, time };
}

/**
 * One row in the Schedule list. Main line is the session in its own timezone
 * (PT for our SF sessions); the "Your time" line only renders after mount, both
 * because the viewer's zone is browser-only and to keep SSR markup stable.
 */
function ScheduleRow({ n, s }: { n: number; s: PublicSession }) {
  const [viewerTz, setViewerTz] = useState<string | null>(null);
  useEffect(() => setViewerTz(viewerTimezone()), []);
  const { main, viewer } = sessionWhenLines(s.startTime, s.timezone, viewerTz);

  return (
    <div className="cq-d">
      <b>{n}</b>
      <span className="cq-dwrap">
        <span className="cq-dwhen">{main ?? s.title}</span>
        {viewer && <span className="cq-dmine">Your time: {viewer}</span>}
      </span>
    </div>
  );
}

function formatChip(mode: string): string {
  if (mode === "INPERSON") return "In-person SF";
  if (mode === "HYBRID") return "In-person SF + Zoom";
  return "Online + Zoom";
}

function startCheckout(
  cohortId: string,
  groupId: string,
  opts?: { value?: number; label?: string }
) {
  trackEvent("begin_checkout", {
    conversion_kind: "cohort",
    value: opts?.value,
    currency: "USD",
    item_name: opts?.label,
  });
  window.location.href = `/cohorts/${cohortId}/pay/${groupId}`;
}

function InstructorIdentity({
  instructor,
  color,
  showAvatar,
}: {
  instructor: PublicInstructor;
  color: string;
  showAvatar: boolean;
}) {
  const displayName = instructor.name?.trim() || "Instructor";
  const content = (
    <>
      {showAvatar && (
        <span className="cq-av" style={{ background: color }}>
          {instructor.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={instructor.image} alt={instructor.name ?? ""} className="cq-av-img" />
          ) : (
            initials(instructor.name)
          )}
        </span>
      )}
      <span className="cq-person-name">{displayName}</span>
    </>
  );

  if (instructor.profileVisibility === "PUBLIC" && instructor.slug) {
    return (
      <a className="cq-person cq-person--link" href={`/humans/${instructor.slug}`}>
        {content}
      </a>
    );
  }

  return <span className="cq-person">{content}</span>;
}

function Instructors({ instructors }: { instructors: PublicInstructor[] }) {
  if (instructors.length === 0) return null;

  return (
    <div className="cq-who">
      <span className="cq-who-label">Instructors:</span>
      <small>
        {instructors.map((instructor, idx) => (
          <Fragment key={instructor.id}>
            {idx > 0 ? ", " : ""}
            <InstructorIdentity
              instructor={instructor}
              color={AV_COLORS[idx % AV_COLORS.length]}
              showAvatar={idx < 5}
            />
          </Fragment>
        ))}
      </small>
    </div>
  );
}

// Teaser only. The full pitch (perks, photos, objection handling) and the
// checkout buttons live on /membership — this keeps one canonical sales surface
// instead of two copies of the tier copy drifting apart.
function MembershipCard({ tier }: { tier: MembershipTier }) {
  const tierConfig = MEMBERSHIP_TIER_CONFIG[tier];

  return (
    <a href="/membership" className="cq-mem" data-track="membership_teaser">
      <div className="cq-mem-body">
        <div className="cq-mem-badge">Membership</div>
        <h3 className="cq-mem-title">{tierConfig.cardTitle}</h3>
        <p className="cq-mem-desc">{tierConfig.description}</p>
        <div className="cq-mem-price">
          <span className="cq-mem-amt">{fmtMembershipPrice(tierConfig.amountCents)}</span>
          <span className="cq-mem-per">/ month</span>
        </div>
      </div>
      <div className="cq-mem-rail">
        <span className="cq-btn cq-mem-btn">See what&rsquo;s included →</span>
        <p className="cq-mem-terms">Cancel anytime · Terms &amp; conditions apply.</p>
      </div>
    </a>
  );
}

function CohortCard({ c, past }: { c: PublicCohort; past?: boolean }) {
  const { dow, dates, time } = formatWhen(c);
  const [tierId, setTierId] = useState(c.tiers[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const selected = c.tiers.find((t) => t.id === tierId) ?? c.tiers[0];
  const inPersonTier = c.tiers.find((t) => t.inPerson);
  const tools = (c.tools || "").split(",").map((t) => t.trim()).filter(Boolean);
  const feat = !past && c.status === "ENROLLMENT";
  const inProgress = c.status === "IN_PROGRESS";
  // Register/checkout only for open-enrollment cohorts the viewer isn't in yet.
  const canRegister = !past && !inProgress && !c.isEnrolled && c.tiers.length > 0;

  return (
    <article className={`cq-ev${feat ? " cq-ev--feat" : ""}${past ? " cq-ev--past" : ""}${c.isEnrolled ? " cq-ev--mine" : ""}`}>
      <div className="cq-row">
        <div className="cq-body">
          <div className="cq-when">
            {dow && <span className="cq-dow">{dow}</span>}
            <span className="cq-dates">{dates}</span>
            {time && <span className="cq-time">{time}</span>}
          </div>
          {c.durationLabel && <span className="cq-flag">{c.durationLabel}</span>}
          <h3><a className="cq-title" href={`/cohorts/${c.slug || c.id}`}>{c.title}</a></h3>
          <div className="cq-meta">
            {inProgress && <span className="cq-chip cq-chip--live"><span className="cq-dot" /> In Progress</span>}
            {c.isEnrolled && !inProgress && !past && <span className="cq-chip cq-chip--live">✓ Enrolled</span>}
            <span className={`cq-chip${c.deliveryMode !== "ONLINE" ? " cq-chip--ip" : ""}`}>● {formatChip(c.deliveryMode)}</span>
            {c.certificate && <span className="cq-chip cq-chip--cert">🎓 Certificate</span>}
            {c.location && <span className="cq-m">📍 {c.location}</span>}
          </div>
          <Instructors instructors={c.instructors} />
        </div>
        <div className="cq-rail">
          {past && !c.isEnrolled ? (
            <span className="cq-done">Completed</span>
          ) : c.isEnrolled ? (
            <a className="cq-btn cq-btn--enrolled" href={`/cohorts/${c.slug || c.id}`}>Enter the cohort →</a>
          ) : inProgress ? (
            <p className="cq-note">Enrollment closed — this cohort is in progress. Grab a seat in the next one below, or email {brand.email.contact}.</p>
          ) : (
            <>
              <div className="cq-price">
                <div className="cq-from">from</div>
                <div className="cq-amt">{fmtMoney(c.fromPrice)}</div>
              </div>
              {inPersonTier && (
                <div className="cq-seats">
                  <div className="cq-bar"><div className="cq-fill" style={{ width: `${Math.min(100, 100 - (inPersonTier.seatsLeft / Math.max(1, inPersonTier.seats)) * 100)}%` }} /></div>
                  <div className={`cq-lbl ${inPersonTier.seatsLeft <= 5 ? "low" : "ok"}`}>{inPersonTier.seatsLeft} of {inPersonTier.seats} in-person seats left</div>
                </div>
              )}
              {c.tiers.length > 0 && (
                <button className="cq-btn" onClick={() => setOpen((o) => !o)}>Register →</button>
              )}
            </>
          )}
        </div>
      </div>

      {(c.description || tools.length > 0 || c.schedule.length > 0 || c.tiers.length > 0) && (
        <details className="cq-acc" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary><span className="cq-caret">▶</span> More details</summary>
          <div className="cq-acc-inner">
            {c.description && (
              <div className="cq-sec"><h4>About</h4><div className="cq-about" dangerouslySetInnerHTML={{ __html: c.description }} /></div>
            )}
            {tools.length > 0 && (
              <div className="cq-sec"><h4>Tools you&apos;ll use</h4><div className="cq-tools">{tools.map((t) => <span key={t} className="cq-tool">{t}</span>)}</div></div>
            )}
            {c.schedule.length > 0 && (
              <div className="cq-sec"><h4>Schedule</h4><div className="cq-sched">{c.schedule.map((s, i) => <ScheduleRow key={i} n={i + 1} s={s} />)}</div></div>
            )}
            {canRegister && (
              <div className="cq-sec" id={`register-${c.id}`}>
                <h4>Choose your ticket</h4>
                <div className="cq-tiers">
                  {c.tiers.map((t) => (
                    <label key={t.id} className="cq-tier">
                      <input type="radio" name={`tier-${c.id}`} checked={tierId === t.id} onChange={() => setTierId(t.id)} disabled={t.inPerson && t.seatsLeft <= 0} />
                      <span className="cq-radio" />
                      <div className="cq-tname">{t.name}{t.inPerson && <small>{c.location || "In-person"}</small>}</div>
                      <div className="cq-tseats">{t.inPerson ? (t.seatsLeft > 0 ? `${t.seatsLeft} of ${t.seats} left` : "sold out") : "unlimited"}</div>
                      <div className="cq-tprice">{fmtMoney(t.price)}</div>
                    </label>
                  ))}
                </div>
                {isFreeTier(selected) ? (
                  <>
                    <FreeSeatForm
                      cohortRef={c.slug || c.id}
                      groupId={selected!.id}
                      requiresWaiver={selected!.inPerson}
                      ctaLabel={c.leadMagnetCta}
                      trackingItemName={`${c.title} — ${selected!.name}`}
                      variant="list"
                    />
                    <p className="cq-hint">Free — no payment needed</p>
                  </>
                ) : (
                  <>
                    <button className="cq-btn cq-checkout" data-track="enroll_cohort" onClick={() => selected && startCheckout(c.slug || c.id, selected.id, { value: selected.price, label: `${c.title} — ${selected.name}` })}>
                      Continue — {selected?.name} · {fmtMoney(selected?.price ?? 0)} →
                    </button>
                    <p className="cq-hint">Secure Stripe checkout · scholarships: {brand.email.contact}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  );
}

function LeadMagnetCard({ c }: { c: PublicCohort }) {
  const { dow, dates, time } = formatWhen(c);
  // No group is chosen on a lead magnet, so the waiver follows the cohort's
  // delivery mode — in-person and hybrid cohorts meet at the venue.
  const requiresWaiver = c.deliveryMode === "INPERSON" || c.deliveryMode === "HYBRID";

  return (
    <article className="cq-ev cq-ev--free">
      <div className="cq-row">
        <div className="cq-body">
          <div className="cq-when">
            {dow && <span className="cq-dow">{dow}</span>}
            <span className="cq-dates">{dates}</span>
            {time && <span className="cq-time">{time}</span>}
          </div>
          <span className="cq-flag cq-flag--free">Free · Live event</span>
          <h3><a className="cq-title" href={`/cohorts/${c.slug || c.id}`}>{c.title}</a></h3>
          <div className="cq-meta">
            <span className={`cq-chip${c.deliveryMode !== "ONLINE" ? " cq-chip--ip" : ""}`}>● {formatChip(c.deliveryMode)}</span>
            {c.location && <span className="cq-m">📍 {c.location}</span>}
          </div>
          <Instructors instructors={c.instructors} />
          {c.description && (
            <details className="cq-acc"><summary><span className="cq-caret">▶</span> More details</summary>
              <div className="cq-acc-inner"><div className="cq-sec"><div className="cq-about" dangerouslySetInnerHTML={{ __html: c.description }} /></div></div>
            </details>
          )}
        </div>
        <div className="cq-rail">
          <div className="cq-price"><div className="cq-amt">Free</div></div>
          <FreeSeatForm
            cohortRef={c.slug || c.id}
            requiresWaiver={requiresWaiver}
            ctaLabel={c.leadMagnetCta}
            trackingItemName={c.title}
            variant="list"
          />
        </div>
      </div>
    </article>
  );
}

export default function CohortsPublic({ cohorts }: { cohorts: PublicCohort[] }) {
  const leadMagnets = cohorts.filter((c) => c.leadMagnet && c.status !== "COMPLETE");
  const upcoming = cohorts.filter(isUpcomingPublicCohort);
  const past = cohorts.filter((c) => !c.leadMagnet && c.status === "COMPLETE");

  return (
    <div className="cq-wrap">
      <style>{CSS}</style>
      <div className="cq-inner">
      <header className="cq-org">
        <div className="cq-mark" />
        <div>
          <div className="cq-name">{brand.wordmark}</div>
          {content.cohortsPage.tagline && (
            <div className="cq-tag">{content.cohortsPage.tagline}</div>
          )}
        </div>
      </header>
      <div className="cq-links">
        {content.cohortsPage.communityEventsLabel && (
          <a href={brand.social.luma} target="_blank" rel="noopener">
            {content.cohortsPage.communityEventsLabel}
          </a>
        )}
        {content.cohortsPage.scholarshipNote && (
          <span className="cq-scholar">· {content.cohortsPage.scholarshipNote} — {brand.email.contact}</span>
        )}
      </div>

      {leadMagnets.length > 0 && (
        <>
          <hr className="cq-rule" />
          <h2 className="cq-h">Free events <span className="cq-count">{leadMagnets.length}</span></h2>
          <div className="cq-events">{leadMagnets.map((c) => <LeadMagnetCard key={c.id} c={c} />)}</div>
        </>
      )}

      {MEMBERSHIP_TIERS.length > 0 && (
        <>
          <hr className="cq-rule" />
          <h2 className="cq-h" id="membership">
            Membership
            <a className="cq-memlink" href="/membership">Compare both tiers →</a>
          </h2>
          <div className="cq-mem-grid">
            {MEMBERSHIP_TIERS.map((tier) => (
              <MembershipCard key={tier} tier={tier} />
            ))}
          </div>
        </>
      )}

      <hr className="cq-rule" />
      <h2 className="cq-h">Upcoming cohorts <span className="cq-count">{upcoming.filter((c) => c.status === "ENROLLMENT").length} open</span></h2>
      {upcoming.length === 0 ? (
        <p className="cq-empty">No cohorts open right now — check the <a href={brand.social.luma} target="_blank" rel="noopener">Luma calendar</a> or email {brand.email.contact}.</p>
      ) : (
        <div className="cq-events">{upcoming.map((c) => <CohortCard key={c.id} c={c} />)}</div>
      )}

      {past.length > 0 && (
        <>
          <h2 className="cq-h" style={{ marginTop: 38 }}>Past cohorts</h2>
          <div className="cq-events">{past.map((c) => <CohortCard key={c.id} c={c} past />)}</div>
        </>
      )}
      </div>
    </div>
  );
}

const CSS = `
.cq-wrap{--cq-ground:#f4f6fc;--cq-panel:#fff;--cq-panel2:#f0f3fb;--cq-line:#e2e6f2;--cq-ink:#161a33;--cq-soft:#454d70;--cq-mute:#79809f;--cq-teal:#009da0;--cq-violet:#7209b7;--cq-a:#00f5d4;--cq-b:#7209b7;--cq-ok:#17935f;--cq-low:#c2721b;--cq-disp:"Space Grotesk",system-ui,sans-serif;--cq-mono:ui-monospace,Menlo,monospace;color:var(--cq-ink);font-family:system-ui,-apple-system,sans-serif;overflow-y:auto;overflow-x:hidden;height:100%;width:100%;background:var(--cq-ground);}
.cq-inner{width:100%;max-width:1080px;margin:0 auto;padding:40px clamp(16px,4vw,40px) 96px;box-sizing:border-box;}
/* Dark palette follows the hub's day/night switcher (next-themes writes html.dark),
   not the OS. Fallback to OS only when the app hasn't set an explicit theme class. */
:root.dark .cq-wrap,:root:not(.light):not(.dark) .cq-wrap{--cq-ground:#0f1330;--cq-panel:#1a1f3d;--cq-panel2:#232a4d;--cq-line:#2f3861;--cq-ink:#eef1fb;--cq-soft:#c2c9e6;--cq-mute:#8791b0;--cq-teal:#56e9eb;--cq-violet:#b58bff;--cq-ok:#4bd699;--cq-low:#f0b055;}
@media (prefers-color-scheme:light){:root:not(.dark):not(.light) .cq-wrap{--cq-ground:#f4f6fc;--cq-panel:#fff;--cq-panel2:#f0f3fb;--cq-line:#e2e6f2;--cq-ink:#161a33;--cq-soft:#454d70;--cq-mute:#79809f;--cq-teal:#009da0;--cq-violet:#7209b7;--cq-ok:#17935f;--cq-low:#c2721b;}}
.cq-org{display:flex;align-items:center;gap:16px;}
.cq-mark{width:52px;height:52px;border-radius:15px;flex:none;background:linear-gradient(135deg,var(--cq-a),var(--cq-b));}
.cq-name{font-family:var(--cq-disp);font-weight:700;font-size:22px;} .cq-name span{font-weight:400;color:var(--cq-mute);}
.cq-tag{color:var(--cq-soft);font-size:14.5px;margin-top:2px;}
.cq-links{margin:16px 0 0;display:flex;flex-wrap:wrap;gap:10px 16px;font-size:13.5px;}
.cq-links a{color:var(--cq-teal);text-decoration:none;font-weight:600;} .cq-scholar{color:var(--cq-mute);}
.cq-mem-grid{margin:24px 0 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
.cq-mem{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:22px 26px;border-radius:16px;border:1.5px solid transparent;background:linear-gradient(var(--cq-panel),var(--cq-panel)) padding-box,linear-gradient(135deg,var(--cq-a),var(--cq-b)) border-box;box-shadow:0 1px 2px rgba(20,30,70,.05),0 14px 34px rgba(20,30,70,.08);color:inherit;text-decoration:none;transition:transform .18s ease,box-shadow .18s ease;}
.cq-mem:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(20,30,70,.06),0 20px 44px rgba(20,30,70,.13);}
.cq-memlink{margin-left:auto;font-family:system-ui,sans-serif;font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--cq-teal);text-decoration:none;}
.cq-mem-badge{display:inline-block;font-family:var(--cq-mono);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--cq-violet);margin-bottom:8px;}
.cq-mem-title{font-family:var(--cq-disp);font-weight:700;font-size:20px;line-height:1.15;margin:0 0 8px;}
.cq-mem-desc{font-size:13.5px;color:var(--cq-soft);line-height:1.6;margin:0 0 12px;max-width:52ch;}
.cq-mem-price{display:flex;align-items:baseline;gap:8px;}
.cq-mem-amt{font-family:var(--cq-disp);font-weight:700;font-size:28px;line-height:1;}
.cq-mem-per{font-size:14px;color:var(--cq-mute);}
.cq-mem-rail{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:190px;}
.cq-mem-btn{width:100%;justify-content:center;}
.cq-mem-btn:disabled{opacity:.6;cursor:not-allowed;}
.cq-mem-err{font-size:12px;color:var(--cq-low);margin:0;text-align:right;}
.cq-mem-terms{font-size:11.5px;color:var(--cq-mute);margin:0;text-align:right;}
@media (max-width:900px){.cq-mem-grid{grid-template-columns:1fr;}}
@media (max-width:680px){.cq-mem{grid-template-columns:1fr;}.cq-mem-rail{align-items:stretch;min-width:0;}.cq-mem-err,.cq-mem-terms{text-align:center;}}
.cq-rule{height:1px;background:var(--cq-line);border:0;margin:30px 0 26px;}
.cq-h{font-family:var(--cq-disp);font-weight:600;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--cq-mute);margin:0 0 16px;display:flex;align-items:center;gap:10px;}
.cq-count{font-family:var(--cq-mono);font-size:11px;color:var(--cq-teal);background:var(--cq-panel2);padding:2px 8px;border-radius:999px;letter-spacing:0;}
.cq-empty{color:var(--cq-soft);font-size:14px;} .cq-empty a{color:var(--cq-teal);}
.cq-events{display:flex;flex-direction:column;gap:16px;}
.cq-ev{background:var(--cq-panel);border:1px solid var(--cq-line);border-radius:16px;padding:22px 24px;box-shadow:0 1px 2px rgba(20,30,70,.05),0 14px 34px rgba(20,30,70,.07);}
.cq-ev--feat{border:1.5px solid transparent;background:linear-gradient(var(--cq-panel),var(--cq-panel)) padding-box,linear-gradient(135deg,var(--cq-a),var(--cq-b)) border-box;}
.cq-ev--past{opacity:.62;box-shadow:none;}
.cq-ev--mine{border-color:color-mix(in srgb,var(--cq-ok) 45%,var(--cq-line));background:color-mix(in srgb,var(--cq-ok) 4%,var(--cq-panel));}
.cq-ev--past.cq-ev--mine{opacity:1;}
.cq-row{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:start;}
.cq-when{display:flex;align-items:baseline;gap:2px 10px;flex-wrap:wrap;margin-bottom:8px;}
.cq-dow{flex-basis:100%;font-family:var(--cq-mono);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--cq-teal);}
.cq-dates{font-family:var(--cq-disp);font-weight:700;font-size:17px;} .cq-time{font-size:13px;color:var(--cq-mute);}
.cq-time::before{content:"·";margin-right:8px;}
.cq-flag{font-family:var(--cq-mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--cq-violet);}
.cq-body h3{font-family:var(--cq-disp);font-weight:700;font-size:21px;line-height:1.15;margin:5px 0 11px;}
.cq-title{color:inherit;text-decoration:none;} .cq-title:hover{color:var(--cq-teal);}
.cq-meta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;}
.cq-chip{display:inline-flex;gap:6px;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--cq-panel2);color:var(--cq-soft);}
.cq-chip--ip{color:var(--cq-teal);background:color-mix(in srgb,var(--cq-teal) 15%,transparent);}
.cq-chip--cert{color:var(--cq-violet);background:color-mix(in srgb,var(--cq-violet) 14%,transparent);}
.cq-chip--live{color:var(--cq-ok);background:color-mix(in srgb,var(--cq-ok) 14%,transparent);align-items:center;}
.cq-dot{width:7px;height:7px;border-radius:50%;background:var(--cq-ok);animation:cq-pulse 1.6s ease-in-out infinite;}
@keyframes cq-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.cq-note{font-size:12.5px;color:var(--cq-mute);line-height:1.5;margin:0;max-width:230px;text-align:right;}
.cq-btn--enrolled{background:color-mix(in srgb,var(--cq-ok) 16%,transparent);color:var(--cq-ok);text-decoration:none;}
.cq-m{font-size:13px;color:var(--cq-soft);}
.cq-who{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;}
.cq-who-label{font-family:var(--cq-mono);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--cq-mute);}
.cq-av{width:28px;height:28px;border-radius:50%;border:2px solid var(--cq-panel);font-family:var(--cq-disp);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#0b1020;}
.cq-av-img{width:100%;height:100%;object-fit:cover;border-radius:inherit;}
.cq-who small{color:var(--cq-mute);font-size:12.5px;line-height:1.5;}
.cq-person{display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none;vertical-align:middle;}
.cq-person--link:hover{color:var(--cq-teal);}
.cq-person--link:hover .cq-person-name{text-decoration:underline;text-underline-offset:2px;}
.cq-person-name{display:inline-block;}
.cq-rail{display:flex;flex-direction:column;align-items:flex-end;gap:11px;min-width:180px;}
.cq-from{font-size:11px;color:var(--cq-mute);text-transform:uppercase;letter-spacing:.08em;text-align:right;}
.cq-amt{font-family:var(--cq-disp);font-weight:700;font-size:26px;line-height:1;font-variant-numeric:tabular-nums;text-align:right;}
.cq-seats{width:100%;} .cq-bar{height:6px;border-radius:999px;background:var(--cq-panel2);overflow:hidden;} .cq-fill{height:100%;background:var(--cq-teal);}
.cq-lbl{font-size:11.5px;font-weight:600;margin-top:5px;text-align:right;} .cq-lbl.ok{color:var(--cq-ok);} .cq-lbl.low{color:var(--cq-low);}
.cq-done{font-family:var(--cq-mono);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cq-mute);background:var(--cq-panel2);padding:4px 10px;border-radius:999px;}
.cq-btn{display:inline-flex;align-items:center;gap:7px;font-family:var(--cq-disp);font-weight:600;font-size:14px;padding:10px 22px;border-radius:11px;color:#0b1020;background:linear-gradient(135deg,var(--cq-a),var(--cq-b));border:0;cursor:pointer;}
.cq-btn:hover{filter:brightness(1.05);}
.cq-acc{margin-top:16px;border-top:1px solid var(--cq-line);}
.cq-acc>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding-top:14px;font-family:var(--cq-disp);font-weight:600;font-size:13.5px;color:var(--cq-teal);}
.cq-acc>summary::-webkit-details-marker{display:none;} .cq-caret{font-size:11px;transition:transform .2s;} .cq-acc[open] .cq-caret{transform:rotate(90deg);}
.cq-acc-inner{padding:16px 0 4px;display:flex;flex-direction:column;gap:22px;}
.cq-sec h4{font-family:var(--cq-disp);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--cq-mute);margin:0 0 9px;}
.cq-about{font-size:13.5px;color:var(--cq-soft);line-height:1.65;} .cq-about p{margin:0 0 10px;} .cq-about strong{color:var(--cq-ink);} .cq-about ul{padding-left:18px;margin:0 0 10px;} .cq-about a{color:var(--cq-teal);}
.cq-tools{display:flex;flex-wrap:wrap;gap:7px;} .cq-tool{font-family:var(--cq-mono);font-size:11.5px;padding:4px 10px;border-radius:8px;background:var(--cq-panel2);color:var(--cq-soft);border:1px solid var(--cq-line);}
.cq-sched{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;} .cq-d{font-size:13px;color:var(--cq-soft);display:flex;gap:8px;} .cq-d b{color:var(--cq-ink);font-family:var(--cq-mono);font-size:11px;flex:none;width:20px;padding-top:1px;}
.cq-dwrap{display:flex;flex-direction:column;gap:1px;min-width:0;} .cq-dwhen{color:var(--cq-ink);font-variant-numeric:tabular-nums;} .cq-dmine{font-size:11px;color:var(--cq-mute);}
.cq-tiers{display:flex;flex-direction:column;gap:8px;}
.cq-tier{display:grid;grid-template-columns:20px 1fr auto auto;gap:14px;align-items:center;padding:12px 14px;border:1px solid var(--cq-line);border-radius:11px;background:var(--cq-panel2);cursor:pointer;}
.cq-tier:hover{border-color:var(--cq-teal);}
.cq-tier input{position:absolute;opacity:0;width:0;height:0;}
.cq-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--cq-mute);}
.cq-tier:has(input:checked){border-color:var(--cq-teal);background:var(--cq-panel);box-shadow:0 0 0 3px color-mix(in srgb,var(--cq-teal) 16%,transparent);}
.cq-tier:has(input:checked) .cq-radio{border-color:var(--cq-teal);background:radial-gradient(circle at center,var(--cq-teal) 42%,transparent 46%);}
.cq-tier:has(input:disabled){opacity:.5;cursor:not-allowed;}
.cq-tname{font-family:var(--cq-disp);font-weight:600;font-size:14px;} .cq-tname small{display:block;color:var(--cq-mute);font-weight:400;font-size:12px;font-family:system-ui;}
.cq-tseats{font-size:12px;color:var(--cq-mute);} .cq-tprice{font-family:var(--cq-disp);font-weight:700;font-size:16px;}
.cq-checkout{width:100%;justify-content:center;margin-top:12px;}
.cq-hint{font-size:12px;color:var(--cq-mute);margin:8px 0 0;}
.cq-ev--free{border:1.5px solid transparent;background:linear-gradient(var(--cq-panel),var(--cq-panel)) padding-box,linear-gradient(135deg,var(--cq-teal),var(--cq-a)) border-box;}
.cq-flag--free{color:var(--cq-teal);}
.cq-reg{display:flex;flex-direction:column;gap:8px;width:100%;min-width:210px;}
.cq-in{padding:9px 12px;border:1px solid var(--cq-line);border-radius:9px;background:var(--cq-panel);color:var(--cq-ink);font-size:13.5px;font-family:inherit;width:100%;}
.cq-in:focus{outline:2px solid var(--cq-teal);outline-offset:1px;border-color:var(--cq-teal);}
.cq-reg-btn{width:100%;justify-content:center;}
.cq-reg-done{font-size:13px;color:var(--cq-ok);font-weight:600;text-align:right;max-width:210px;}
.cq-waiver{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.4;text-align:left;max-width:230px;}
.cq-waiver input{margin-top:2px;flex:0 0 auto;}
.cq-waiver a{text-decoration:underline;}
@media (max-width:680px){.cq-row{grid-template-columns:1fr;}.cq-reg{min-width:0;}.cq-rail{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;min-width:0;border-top:1px solid var(--cq-line);padding-top:14px;}.cq-seats{order:3;flex-basis:100%;}.cq-sched{grid-template-columns:1fr;}.cq-tier{grid-template-columns:20px 1fr auto;}.cq-tseats{display:none;}}
`;
