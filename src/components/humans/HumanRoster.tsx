// src/components/humans/HumanRoster.tsx
//
// Page chrome for a filtered human roster: hero, card grid, empty state. Shared by
// /mentors and /instructors — the routes differ only in their query and their copy,
// which is the whole point of the "filtered views over one profile" decision in
// docs/features/HUMANS.md.
import { brand } from "@/config/brand";
import HumanCard, { HUMAN_CARD_CSS } from "./HumanCard";
import type { HumanCardData } from "@/lib/humanProfile";

export default function HumanRoster({
  eyebrow,
  title,
  intro,
  humans,
  showBooking = false,
  emptyTitle,
  emptyBody,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  humans: HumanCardData[];
  showBooking?: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <div className="hr-wrap">
      <style>{CSS}</style>
      <div className="hr-inner">
        <header className="hr-hero">
          <p className="hr-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="hr-intro">{intro}</p>
        </header>

        {humans.length === 0 ? (
          // A roster is empty until profiles are published. Say so plainly — a blank
          // grid reads as a broken page, and inventing filler people would be worse.
          <div className="hr-empty">
            <h2>{emptyTitle}</h2>
            <p>{emptyBody}</p>
            <a className="hr-cta" href={`mailto:${brand.email.contact}`}>
              {brand.email.contact}
            </a>
          </div>
        ) : (
          <div className="hr-grid">
            {humans.map((h, i) => (
              <HumanCard key={h.id} human={h} index={i} showBooking={showBooking} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.hr-wrap{--a:#00f5d4;--b:#7209b7;--teal:#009da0;--ground:#f4f6fc;--panel:#fff;--panel2:#f0f3fb;--line:#e2e6f2;--ink:#161a33;--soft:#454d70;--mute:#79809f;--disp:"Space Grotesk",system-ui,sans-serif;--mono:ui-monospace,Menlo,monospace;background:var(--ground);color:var(--ink);width:100%;height:100%;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;}
:root.dark .hr-wrap{--ground:#0f1330;--panel:#1a1f3d;--panel2:#232a4d;--line:#2f3861;--ink:#eef1fb;--soft:#c2c9e6;--mute:#8791b0;--teal:#56e9eb;}
.hr-inner{max-width:1080px;margin:0 auto;padding:34px 22px 80px;}
.hr-hero{margin-bottom:30px;max-width:680px;}
.hr-eyebrow{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--b);margin:0 0 10px;}
:root.dark .hr-wrap .hr-eyebrow{color:var(--a);}
.hr-hero h1{font-family:var(--disp);font-weight:700;font-size:34px;line-height:1.1;margin:0 0 12px;}
.hr-intro{font-size:15.5px;line-height:1.65;color:var(--soft);margin:0;}
.hr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px;}
.hr-empty{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:34px;text-align:center;}
.hr-empty h2{font-family:var(--disp);font-size:19px;margin:0 0 8px;}
.hr-empty p{font-size:14.5px;line-height:1.65;color:var(--soft);margin:0 auto 16px;max-width:460px;}
.hr-cta{display:inline-flex;align-items:center;font-family:var(--disp);font-weight:600;font-size:14px;padding:11px 20px;border-radius:11px;color:#0b1020;background:linear-gradient(135deg,var(--a),var(--b));text-decoration:none;}
.hr-cta:hover{filter:brightness(1.05);}
@media (max-width:640px){.hr-hero h1{font-size:27px;}.hr-grid{grid-template-columns:1fr;}}
${HUMAN_CARD_CSS}
`;
