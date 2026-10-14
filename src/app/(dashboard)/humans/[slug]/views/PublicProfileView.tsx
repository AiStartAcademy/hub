// Public human profile view (docs/features/VIEWS.md — Human profile / PublicProfileView).
// The credibility layout: identity header, bio, proof (portfolio / video / testimonials).
// Presentation only — ../page.tsx owns fetching, sanitizing and authorization.
//
// `ProfileBody` and `PROFILE_CSS` are exported so MentorView can reuse the exact same
// body and add only the booking rail, rather than forking a second profile layout.
import Link from "next/link";
import type { PublicHumanProfile } from "@/lib/humanProfile";
import { initials } from "@/components/humans/HumanCard";

const AV_GRADIENT = "linear-gradient(135deg,#00f5d4,#7209b7)";

/** YouTube id from a watch/short/youtu.be URL, for a thumbnail. Null for anything else. */
function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

export function ProfileHeader({ human }: { human: PublicHumanProfile }) {
  return (
    <header className="hp-hero">
      {human.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="hp-av hp-av--img" src={human.image} alt="" />
      ) : (
        <span className="hp-av" style={{ background: AV_GRADIENT }}>
          {initials(human.name)}
        </span>
      )}
      <div className="hp-idblock">
        <h1>{human.name}</h1>
        {human.headline && <p className="hp-head">{human.headline}</p>}
        <p className="hp-facts">
          {human.location && <span>📍 {human.location}</span>}
          {/* "UTC" is the column default every user starts with, so showing it would put a
              wrong-looking timezone on every profile until someone edits it. Show it only
              when it's been set to something real. */}
          {human.timezone && human.timezone !== "UTC" && <span>🕜 {human.timezone}</span>}
          {human.languages.length > 0 && <span>🗣 {human.languages.join(", ")}</span>}
          {human.cohortsTaught > 0 && (
            <span>
              🎓 {human.cohortsTaught} cohort{human.cohortsTaught === 1 ? "" : "s"} taught
            </span>
          )}
        </p>
        {human.expertiseTags.length > 0 && (
          <div className="hp-tags">
            {human.expertiseTags.map((t) => (
              <span key={t} className="hp-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        {human.socialLinks.length > 0 && (
          <div className="hp-socials">
            {human.socialLinks.map((l) => (
              // Only http(s) reaches here — see parseSocialLinks in src/lib/humanProfile.ts.
              <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

/** Bio + proof sections. Shared verbatim by PublicProfileView and MentorView. */
export function ProfileBody({ human }: { human: PublicHumanProfile }) {
  return (
    <>
      {human.bioHtml && (
        <section className="hp-sec">
          <h2>About</h2>
          {/* Sanitized server-side by sanitizeDescription (allowlisted tags + schemes). */}
          <div className="hp-prose" dangerouslySetInnerHTML={{ __html: human.bioHtml }} />
        </section>
      )}

      {human.portfolio.length > 0 && (
        <section className="hp-sec">
          <h2>Work</h2>
          <div className="hp-port">
            {human.portfolio.map((p) => (
              <a
                key={p.id}
                className="hp-pitem"
                href={p.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {p.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="hp-pthumb" src={p.thumbnail} alt="" />
                )}
                <span className="hp-ptext">
                  <b>{p.title}</b>
                  {p.outcome && <small>{p.outcome}</small>}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {human.videos.length > 0 && (
        <section className="hp-sec">
          <h2>Video</h2>
          <div className="hp-vids">
            {human.videos.map((v) => {
              const yt = youtubeId(v.url);
              return (
                <a
                  key={v.id}
                  className="hp-vid"
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {yt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" />
                  ) : (
                    <span className="hp-vidph">▶</span>
                  )}
                  <span className="hp-vidtitle">{v.title || "Watch"}</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {human.testimonials.length > 0 && (
        <section className="hp-sec">
          <h2>What people say</h2>
          <div className="hp-quotes">
            {human.testimonials.map((t) => (
              <blockquote key={t.id} className="hp-quote">
                <p>“{t.quote}”</p>
                <footer>
                  {t.authorAvatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.authorAvatar} alt="" />
                  )}
                  <span>
                    <b>{t.authorName}</b>
                    {t.authorRole && <small>{t.authorRole}</small>}
                  </span>
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** The non-mentor profile: credibility and discovery, no booking rail. */
export default function PublicProfileView({ human }: { human: PublicHumanProfile }) {
  return (
    <div className="hp-wrap">
      <style>{PROFILE_CSS}</style>
      <div className="hp-inner">
        <Link className="hp-back" href="/instructors">
          ← All instructors
        </Link>
        <ProfileHeader human={human} />
        <div className="hp-single">
          <ProfileBody human={human} />
        </div>
      </div>
    </div>
  );
}

export const PROFILE_CSS = `
.hp-wrap{--a:#00f5d4;--b:#7209b7;--teal:#009da0;--ground:#f4f6fc;--panel:#fff;--panel2:#f0f3fb;--line:#e2e6f2;--ink:#161a33;--soft:#454d70;--mute:#79809f;--disp:"Space Grotesk",system-ui,sans-serif;--mono:ui-monospace,Menlo,monospace;background:var(--ground);color:var(--ink);width:100%;height:100%;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif;}
:root.dark .hp-wrap{--ground:#0f1330;--panel:#1a1f3d;--panel2:#232a4d;--line:#2f3861;--ink:#eef1fb;--soft:#c2c9e6;--mute:#8791b0;--teal:#56e9eb;}
.hp-inner{max-width:1080px;margin:0 auto;padding:28px 22px 80px;}
.hp-back{display:inline-block;color:var(--mute);text-decoration:none;font-size:13px;margin-bottom:18px;}
.hp-back:hover{color:var(--teal);}
.hp-note{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:color-mix(in srgb,var(--b) 10%,transparent);border:1px solid color-mix(in srgb,var(--b) 35%,transparent);color:var(--ink);border-radius:12px;padding:11px 15px;font-size:13px;margin-bottom:18px;}
.hp-note b{font-family:var(--disp);}
.hp-note a{color:var(--teal);}
.hp-hero{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap;}
.hp-av{width:104px;height:104px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;font-size:34px;color:#0b1020;object-fit:cover;}
.hp-av--img{background:var(--panel2);}
.hp-idblock{min-width:260px;flex:1;}
.hp-hero h1{font-family:var(--disp);font-weight:700;font-size:32px;line-height:1.12;margin:0 0 8px;}
.hp-head{font-size:16px;color:var(--soft);margin:0 0 12px;line-height:1.5;}
.hp-facts{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;color:var(--mute);margin:0 0 12px;}
.hp-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}
.hp-tag{font-family:var(--mono);font-size:11.5px;padding:4px 10px;border-radius:7px;background:var(--panel2);color:var(--soft);border:1px solid var(--line);}
.hp-socials{display:flex;flex-wrap:wrap;gap:14px;}
.hp-socials a{font-size:13px;font-weight:600;color:var(--teal);text-decoration:none;}
.hp-socials a:hover{text-decoration:underline;}
.hp-grid{display:grid;grid-template-columns:1fr 320px;gap:36px;margin-top:34px;align-items:start;}
.hp-single{margin-top:34px;max-width:760px;}
.hp-sec{margin-bottom:30px;}
.hp-sec h2{font-family:var(--disp);font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:0 0 12px;}
.hp-prose{font-size:15px;line-height:1.7;color:var(--soft);}
.hp-prose p{margin:0 0 12px;} .hp-prose strong{color:var(--ink);} .hp-prose ul,.hp-prose ol{padding-left:20px;} .hp-prose a{color:var(--teal);}
.hp-port{display:flex;flex-direction:column;gap:10px;}
.hp-pitem{display:flex;gap:13px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none;color:inherit;transition:border-color .18s;}
.hp-pitem:hover{border-color:var(--teal);}
.hp-pthumb{width:64px;height:44px;object-fit:cover;border-radius:7px;flex:none;}
.hp-ptext b{display:block;font-family:var(--disp);font-size:14.5px;color:var(--ink);}
.hp-ptext small{display:block;font-size:12.5px;color:var(--mute);margin-top:2px;}
.hp-vids{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;}
.hp-vid{text-decoration:none;color:inherit;}
.hp-vid img,.hp-vidph{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:11px;background:var(--panel2);color:var(--mute);font-size:22px;}
.hp-vidtitle{display:block;font-size:13px;color:var(--soft);margin-top:7px;}
.hp-quotes{display:flex;flex-direction:column;gap:12px;}
.hp-quote{margin:0;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--teal);border-radius:12px;padding:16px 18px;}
.hp-quote p{font-size:14.5px;line-height:1.65;color:var(--soft);margin:0 0 10px;}
.hp-quote footer{display:flex;align-items:center;gap:9px;}
.hp-quote footer img{width:28px;height:28px;border-radius:50%;object-fit:cover;}
.hp-quote footer b{font-family:var(--disp);font-size:13px;color:var(--ink);}
.hp-quote footer small{display:block;font-size:12px;color:var(--mute);}
.hp-rail{position:sticky;top:20px;}
.hp-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 14px 34px rgba(20,30,70,.08);}
.hp-card h3{font-family:var(--disp);font-size:16px;margin:0 0 6px;}
.hp-card p{font-size:13.5px;line-height:1.6;color:var(--soft);margin:0 0 14px;}
.hp-btn{display:flex;align-items:center;justify-content:center;gap:7px;font-family:var(--disp);font-weight:600;font-size:14px;padding:12px 20px;border-radius:11px;color:#0b1020;background:linear-gradient(135deg,var(--a),var(--b));text-decoration:none;}
.hp-btn:hover{filter:brightness(1.05);}
.hp-hint{font-size:12px;color:var(--mute);margin:10px 0 0;}
.hp-helps{list-style:none;padding:0;margin:0 0 14px;display:flex;flex-direction:column;gap:6px;}
.hp-helps li{font-size:13px;color:var(--soft);display:flex;gap:8px;}
.hp-helps li::before{content:"→";color:var(--teal);}
@media (max-width:820px){.hp-grid{grid-template-columns:1fr;}.hp-rail{position:static;}.hp-hero h1{font-size:26px;}.hp-av{width:80px;height:80px;font-size:26px;}}
`;
