// src/components/humans/HumanCard.tsx
//
// One roster card for a human profile. Shared by /mentors and /instructors (and any
// future filtered roster) so a card never drifts between the two lists.
// Presentation only — the server route owns fetching, projection and authorization.
import Link from "next/link";
import type { HumanCardData } from "@/lib/humanProfile";

const AV_COLORS = ["#56e9eb", "#a06bff", "#00f5d4", "#7209b7", "#009da0"];

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** `showBooking` is what makes a mentor card a mentor card — the spec's one visual delta. */
export default function HumanCard({
  human,
  index = 0,
  showBooking = false,
}: {
  human: HumanCardData;
  index?: number;
  showBooking?: boolean;
}) {
  const href = `/humans/${human.slug}`;
  const tags = human.expertiseTags.slice(0, 4);
  const moreTags = human.expertiseTags.length - tags.length;

  return (
    <article className="hc">
      <Link className="hc-hit" href={href} aria-label={`${human.name} — profile`} />

      <div className="hc-top">
        {human.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hc-av hc-av--img" src={human.image} alt="" />
        ) : (
          <span className="hc-av" style={{ background: AV_COLORS[index % AV_COLORS.length] }}>
            {initials(human.name)}
          </span>
        )}
        <div className="hc-id">
          <h3 className="hc-name">
            {human.name}
            {human.isMentor && <span className="hc-mentor">Mentor</span>}
          </h3>
          {human.headline && <p className="hc-head">{human.headline}</p>}
          <p className="hc-sub">
            {human.location && <span>📍 {human.location}</span>}
            {human.cohortsTaught > 0 && (
              <span>
                🎓 {human.cohortsTaught} cohort{human.cohortsTaught === 1 ? "" : "s"} taught
              </span>
            )}
          </p>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="hc-tags">
          {tags.map((t) => (
            <span key={t} className="hc-tag">
              {t}
            </span>
          ))}
          {moreTags > 0 && <span className="hc-tag hc-tag--more">+{moreTags}</span>}
        </div>
      )}

      <div className="hc-foot">
        <span className="hc-view">View profile →</span>
        {showBooking && human.isMentor && (
          <span className="hc-book">Book time</span>
        )}
      </div>
    </article>
  );
}

/**
 * Card styles, exported so the roster page can emit them once per page rather than
 * once per card. Matches the public cohort view's idiom (page-scoped prefix, brand
 * tokens, `:root.dark` overrides) — see cohorts/[id]/views/PublicView.tsx.
 */
export const HUMAN_CARD_CSS = `
.hc{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;transition:border-color .18s,transform .18s,box-shadow .18s;}
.hc:hover{border-color:var(--teal);transform:translateY(-2px);box-shadow:0 14px 34px rgba(20,30,70,.10);}
.hc-hit{position:absolute;inset:0;border-radius:16px;z-index:1;}
.hc-top{display:flex;gap:14px;align-items:flex-start;}
.hc-av{width:56px;height:56px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;font-size:18px;color:#0b1020;object-fit:cover;}
.hc-av--img{background:var(--panel2);}
.hc-id{min-width:0;}
.hc-name{font-family:var(--disp);font-weight:700;font-size:17px;margin:0 0 3px;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.hc-mentor{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;color:var(--teal);border:1px solid var(--teal);background:transparent;}
.hc-head{font-size:13.5px;color:var(--soft);margin:0 0 6px;line-height:1.45;}
.hc-sub{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--mute);margin:0;}
.hc-tags{display:flex;flex-wrap:wrap;gap:6px;}
.hc-tag{font-family:var(--mono);font-size:11px;padding:4px 9px;border-radius:7px;background:var(--panel2);color:var(--soft);border:1px solid var(--line);}
.hc-tag--more{color:var(--mute);}
.hc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:4px;}
.hc-view{font-family:var(--disp);font-size:13px;font-weight:600;color:var(--teal);}
.hc-book{position:relative;z-index:2;font-family:var(--disp);font-size:12px;font-weight:700;padding:6px 13px;border-radius:999px;color:#0b1020;background:linear-gradient(135deg,var(--a),var(--b));}
`;
