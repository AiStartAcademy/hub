"use client";
// Public cohort detail view (guest / not-enrolled). Presentation only — the server
// page (../page.tsx) fetches + sanitizes and hands this component a plain object.
// Registration: paid tiers → the existing /cohorts/[id]/pay/[groupId] page; free
// lead-magnet cohorts and $0 tiers → the shared <FreeSeatForm> posting to
// /api/cohorts/[id]/register-free (a free tier never reaches /pay/).
// The Stripe webhook remains the source of truth for granting access.
import { useEffect, useState } from "react";
import { brand } from "@/config/brand";
import Link from "next/link";
import { trackEvent } from "@/lib/analytics";
import FreeSeatForm, { isFreeTier } from "@/components/FreeSeatForm";
import { SESSION_TZ_FALLBACK, sessionWhenLines, viewerTimezone } from "@/lib/sessionTime";

export interface PublicTier {
  id: string;
  name: string;
  inPerson: boolean;
  price: number;
  seats: number;
  seatsLeft: number;
}
export interface PublicCohortDetail {
  id: string;
  slug: string | null;
  title: string;
  descriptionHtml: string | null;
  cover: string | null;
  status: string;
  deliveryMode: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  durationLabel: string | null;
  tools: string | null;
  certificate: boolean;
  leadMagnet: boolean;
  leadMagnetCta: string | null;
  instructors: { id: string; name: string | null; image: string | null; bio?: string | null }[];
  schedule: {
    title: string;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    timezone: string | null;
    /** True for a shared session series occurrence — a call this cohort attends
     *  alongside the other cohorts running that week, not one of its own sessions. */
    shared?: boolean;
  }[];
  tiers: PublicTier[];
  fromPrice: number;
}

const AV_COLORS = ["#56e9eb", "#a06bff", "#00f5d4", "#7209b7", "#009da0"];
const fmtMoney = (n: number) => (n > 0 ? `$${n.toLocaleString()}` : "Free");
const initials = (name: string | null) =>
  (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

function formatChip(mode: string): string {
  if (mode === "INPERSON") return "In-person SF";
  if (mode === "HYBRID") return "In-person SF + Zoom";
  return "Online + Zoom";
}
function whenRange(c: PublicCohortDetail): string {
  // Recurring cohorts (the Q&A) have no start/end date — lead with the next session.
  if (!c.startDate) {
    const next = c.schedule.find((s) => s.date);
    const d = next?.date ? new Date(next.date) : null;
    if (!d || Number.isNaN(d.getTime())) return "Dates TBA";
    const label = /q&a/i.test(c.title) ? "Next Q&A Date" : "Next date";
    // `date` is the exact session instant (Zoom sync) — read it in the SF zone the
    // sessions actually run in, not UTC, or an 18:00 PT session reads as the next day.
    return `${label}: ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: SESSION_TZ_FALLBACK })}`;
  }
  const s = new Date(c.startDate);
  const e = c.endDate ? new Date(c.endDate) : null;
  // Calendar dates stored at UTC midnight — read/format as UTC, not local time.
  const sM = s.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  let out = `${s.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} · ${sM} ${s.getUTCDate()}`;
  if (e) {
    const eM = e.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    out += sM === eM ? ` – ${e.getUTCDate()}` : ` – ${eM} ${e.getUTCDate()}`;
  }
  return out;
}

/**
 * One schedule line: the session's date/time in the zone it actually runs in
 * (PT for our SF cohorts), falling back to the stored title if there's no
 * timestamp. The "Your time" line only renders after mount — the viewer's zone
 * is browser-only, and rendering it during SSR would break hydration.
 * Mirrors ScheduleRow in ../../CohortsPublic.tsx.
 */
function ScheduleRow({ n, s }: { n: number; s: PublicCohortDetail["schedule"][number] }) {
  const [viewerTz, setViewerTz] = useState<string | null>(null);
  useEffect(() => setViewerTz(viewerTimezone()), []);
  const { main, viewer } = sessionWhenLines(s.startTime, s.timezone, viewerTz);

  return (
    <li>
      <b>{n}</b>
      <span className="cd-swrap">
        <span>
          {main ?? s.title}
          {s.shared && <em className="cd-sshared"> · {s.title}</em>}
        </span>
        {viewer && <span className="cd-smine">Your time: {viewer}</span>}
      </span>
    </li>
  );
}

function Tiers({ cohort }: { cohort: PublicCohortDetail }) {
  const [tierId, setTierId] = useState(cohort.tiers[0]?.id ?? "");
  const selected = cohort.tiers.find((t) => t.id === tierId) ?? cohort.tiers[0];
  const free = isFreeTier(selected);

  function register() {
    if (!selected) return;
    trackEvent("begin_checkout", {
      conversion_kind: "cohort",
      value: selected.price,
      currency: "USD",
      item_name: `${cohort.title} — ${selected.name}`,
    });
    window.location.href = `/cohorts/${cohort.slug || cohort.id}/pay/${selected.id}`;
  }

  return (
    <div className="cd-tiers">
      {cohort.tiers.map((t) => (
        <label key={t.id} className="cd-tier">
          <input
            type="radio"
            name="tier"
            checked={tierId === t.id}
            onChange={() => setTierId(t.id)}
            disabled={t.inPerson && t.seatsLeft <= 0}
          />
          <span className="cd-radio" />
          <span className="cd-tname">
            {t.name}
            {t.inPerson && <small>{cohort.location || "In-person"}</small>}
          </span>
          <span className="cd-tseats">
            {t.inPerson ? (t.seatsLeft > 0 ? `${t.seatsLeft} of ${t.seats} left` : "sold out") : "unlimited"}
          </span>
          <span className="cd-tprice">{fmtMoney(t.price)}</span>
        </label>
      ))}
      {free ? (
        <>
          <FreeSeatForm
            cohortRef={cohort.slug || cohort.id}
            groupId={selected!.id}
            requiresWaiver={selected!.inPerson}
            ctaLabel={cohort.leadMagnetCta}
            trackingItemName={`${cohort.title} — ${selected!.name}`}
            variant="detail"
          />
          <p className="cd-hint">Free — no payment needed</p>
        </>
      ) : (
        <>
          <button className="cd-btn cd-checkout" onClick={register} disabled={!selected}>
            Continue — {selected?.name} · {fmtMoney(selected?.price ?? 0)} →
          </button>
          <p className="cd-hint">Secure Stripe checkout · scholarships: {brand.email.contact}</p>
        </>
      )}
    </div>
  );
}

export default function PublicView({ cohort }: { cohort: PublicCohortDetail }) {
  const tools = (cohort.tools || "").split(",").map((t) => t.trim()).filter(Boolean);
  // Paid enrollment closes once the cohort starts; free lead magnets (the
  // recurring Q&A) keep registering between sessions.
  const inProgress = cohort.status === "IN_PROGRESS";
  const enrollmentClosed = inProgress && !cohort.leadMagnet;

  return (
    <div className="cd-wrap">
      <style>{CSS}</style>
      <div className="cd-inner">
        <Link className="cd-back" href="/cohorts">← All cohorts</Link>

        <header className="cd-hero">
          {cohort.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cd-cover" src={cohort.cover} alt={cohort.title} />
          )}
          <div className="cd-when">
            <span className="cd-dates">{whenRange(cohort)}</span>
            {cohort.startTime && cohort.endTime && (
              <span className="cd-time">{cohort.startTime} – {cohort.endTime} {cohort.timezone ?? ""}</span>
            )}
            {cohort.durationLabel && <span className="cd-flag">{cohort.durationLabel}</span>}
          </div>
          <h1>{cohort.title}</h1>
          <div className="cd-meta">
            {inProgress && <span className="cd-chip cd-chip--live"><span className="cd-dot" /> In Progress</span>}
            <span className={`cd-chip${cohort.deliveryMode !== "ONLINE" ? " cd-chip--ip" : ""}`}>● {formatChip(cohort.deliveryMode)}</span>
            {cohort.location && <span className="cd-m">📍 {cohort.location}</span>}
            {cohort.certificate && <span className="cd-m">🎓 Certificate</span>}
          </div>
          {cohort.instructors.length > 0 && (
            <div className="cd-who">
              <span className="cd-avs">
                {cohort.instructors.slice(0, 6).map((i, idx) => (
                  <span key={i.id} className="cd-av" style={{ background: AV_COLORS[idx % AV_COLORS.length] }}>{initials(i.name)}</span>
                ))}
              </span>
              <small>{cohort.instructors.map((i) => i.name).filter(Boolean).join(", ")}</small>
            </div>
          )}
        </header>

        <div className="cd-grid">
          <main className="cd-main">
            {cohort.descriptionHtml && (
              <section className="cd-sec">
                <h2>About</h2>
                <div className="cd-about" dangerouslySetInnerHTML={{ __html: cohort.descriptionHtml }} />
              </section>
            )}
            {tools.length > 0 && (
              <section className="cd-sec">
                <h2>Tools you&apos;ll use</h2>
                <div className="cd-tools">{tools.map((t) => <span key={t} className="cd-tool">{t}</span>)}</div>
              </section>
            )}
            {cohort.schedule.length > 0 && (
              <section className="cd-sec">
                <h2>Schedule</h2>
                <ol className="cd-sched">
                  {cohort.schedule.map((s, i) => (
                    <ScheduleRow key={i} n={i + 1} s={s} />
                  ))}
                </ol>
              </section>
            )}
          </main>

          <aside className="cd-rail">
            <div className="cd-card" id="register">
              {enrollmentClosed ? (
                <p className="cd-hint">
                  Enrollment closed — this cohort is in progress. See{" "}
                  <Link href="/cohorts">upcoming cohorts</Link> or email{" "}
                  {brand.email.contact}.
                </p>
              ) : cohort.leadMagnet ? (
                <>
                  <div className="cd-price"><span className="cd-amt">Free</span></div>
                  <FreeSeatForm
                    cohortRef={cohort.slug || cohort.id}
                    requiresWaiver={
                      cohort.deliveryMode === "INPERSON" || cohort.deliveryMode === "HYBRID"
                    }
                    ctaLabel={cohort.leadMagnetCta}
                    trackingItemName={cohort.title}
                    variant="detail"
                  />
                </>
              ) : cohort.tiers.length > 0 ? (
                <>
                  <div className="cd-price"><span className="cd-from">from</span><span className="cd-amt">{fmtMoney(cohort.fromPrice)}</span></div>
                  <Tiers cohort={cohort} />
                </>
              ) : (
                <p className="cd-hint">Registration opens soon — email {brand.email.contact}.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.cd-wrap{--a:#00f5d4;--b:#7209b7;--teal:#009da0;--ground:#f4f6fc;--panel:#fff;--panel2:#f0f3fb;--line:#e2e6f2;--ink:#161a33;--soft:#454d70;--mute:#79809f;--disp:"Space Grotesk",system-ui,sans-serif;--mono:ui-monospace,Menlo,monospace;background:var(--ground);color:var(--ink);width:100%;height:100%;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;}
:root.dark .cd-wrap{--ground:#0f1330;--panel:#1a1f3d;--panel2:#232a4d;--line:#2f3861;--ink:#eef1fb;--soft:#c2c9e6;--mute:#8791b0;--teal:#56e9eb;}
.cd-inner{max-width:1080px;margin:0 auto;padding:28px 22px 80px;}
.cd-back{display:inline-block;color:var(--mute);text-decoration:none;font-size:13px;margin-bottom:18px;}
.cd-back:hover{color:var(--teal);}
.cd-cover{width:100%;max-height:340px;object-fit:cover;border-radius:18px;margin-bottom:20px;}
.cd-when{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
.cd-dates{font-family:var(--disp);font-weight:700;font-size:18px;}
.cd-time{font-size:13px;color:var(--mute);} .cd-time::before{content:"·";margin-right:8px;}
.cd-flag{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--b);}
.cd-hero h1{font-family:var(--disp);font-weight:700;font-size:34px;line-height:1.1;margin:8px 0 12px;}
.cd-meta{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;}
.cd-chip{font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;background:var(--panel2);color:var(--soft);}
.cd-chip--ip{color:var(--teal);background:color-mix(in srgb,var(--teal) 15%,transparent);}
.cd-chip--live{display:inline-flex;align-items:center;gap:6px;color:#17935f;background:color-mix(in srgb,#17935f 14%,transparent);}
:root.dark .cd-wrap .cd-chip--live{color:#4bd699;background:color-mix(in srgb,#4bd699 14%,transparent);}
.cd-dot{width:7px;height:7px;border-radius:50%;background:currentColor;animation:cd-pulse 1.6s ease-in-out infinite;}
@keyframes cd-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.cd-m{font-size:13.5px;color:var(--soft);}
.cd-who{display:flex;align-items:center;gap:10px;margin-top:16px;} .cd-avs{display:flex;}
.cd-av{width:32px;height:32px;border-radius:50%;border:2px solid var(--panel);margin-left:-8px;font-family:var(--disp);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#0b1020;}
.cd-av:first-child{margin-left:0;} .cd-who small{color:var(--mute);font-size:13px;}
.cd-grid{display:grid;grid-template-columns:1fr 340px;gap:36px;margin-top:34px;align-items:start;}
.cd-sec{margin-bottom:30px;} .cd-sec h2{font-family:var(--disp);font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:0 0 12px;}
.cd-about{font-size:15px;line-height:1.7;color:var(--soft);} .cd-about p{margin:0 0 12px;} .cd-about strong{color:var(--ink);} .cd-about ul{padding-left:20px;} .cd-about a{color:var(--teal);}
.cd-tools{display:flex;flex-wrap:wrap;gap:8px;} .cd-tool{font-family:var(--mono);font-size:12px;padding:5px 11px;border-radius:8px;background:var(--panel2);color:var(--soft);border:1px solid var(--line);}
.cd-sched{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;} .cd-sched li{display:flex;gap:12px;font-size:14px;color:var(--soft);align-items:baseline;} .cd-sched b{font-family:var(--mono);font-size:11px;color:var(--ink);width:22px;flex:none;}
.cd-swrap{display:flex;flex-direction:column;gap:2px;}
.cd-smine{font-size:12px;opacity:.65;}
.cd-sshared{font-style:normal;font-size:12px;color:var(--mute);}
.cd-rail{position:sticky;top:20px;}
.cd-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 14px 34px rgba(20,30,70,.08);}
.cd-price{display:flex;align-items:baseline;gap:8px;margin-bottom:16px;} .cd-from{font-size:12px;color:var(--mute);text-transform:uppercase;} .cd-amt{font-family:var(--disp);font-weight:700;font-size:30px;}
.cd-tiers{display:flex;flex-direction:column;gap:8px;}
.cd-tier{display:grid;grid-template-columns:18px 1fr auto auto;gap:12px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:11px;background:var(--panel2);cursor:pointer;}
.cd-tier:hover{border-color:var(--teal);}
.cd-tier input{position:absolute;opacity:0;width:0;height:0;}
.cd-radio{width:18px;height:18px;border-radius:50%;border:2px solid var(--mute);}
.cd-tier:has(input:checked){border-color:var(--teal);background:var(--panel);box-shadow:0 0 0 3px color-mix(in srgb,var(--teal) 16%,transparent);}
.cd-tier:has(input:checked) .cd-radio{border-color:var(--teal);background:radial-gradient(circle at center,var(--teal) 42%,transparent 46%);}
.cd-tier:has(input:disabled){opacity:.5;cursor:not-allowed;}
.cd-tname{font-family:var(--disp);font-weight:600;font-size:14px;} .cd-tname small{display:block;color:var(--mute);font-weight:400;font-size:12px;font-family:system-ui;}
.cd-tseats{font-size:12px;color:var(--mute);} .cd-tprice{font-family:var(--disp);font-weight:700;font-size:16px;}
.cd-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:var(--disp);font-weight:600;font-size:14px;padding:12px 20px;border-radius:11px;color:#0b1020;background:linear-gradient(135deg,var(--a),var(--b));border:0;cursor:pointer;width:100%;}
.cd-btn:hover{filter:brightness(1.05);} .cd-btn:disabled{opacity:.6;cursor:not-allowed;}
.cd-checkout{margin-top:12px;}
.cd-hint{font-size:12px;color:var(--mute);margin:10px 0 0;}
.cd-free{display:flex;flex-direction:column;gap:8px;} .cd-in{padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);color:var(--ink);font-size:14px;}
.cd-ok{color:var(--teal);font-weight:600;font-size:14px;} .cd-err{color:#c2410c;font-size:12.5px;margin:4px 0 0;}
.cd-waiver{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.4;margin:2px 0;}
.cd-waiver input{margin-top:2px;flex:0 0 auto;}
.cd-waiver a{text-decoration:underline;}
@media (max-width:820px){.cd-grid{grid-template-columns:1fr;}.cd-rail{position:static;}.cd-hero h1{font-size:27px;}}
`;
