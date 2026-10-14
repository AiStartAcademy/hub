"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Plus, Trash2, Camera, User } from "lucide-react";
import dynamic from "next/dynamic";
import { CALL_CONSENT_DISCLOSURE } from "@/lib/phone";

// Tiptap rich-text editor — client-only (avoids SSR hydration issues).
const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });

interface PortfolioItemForm {
  title: string;
  url: string;
  thumbnail: string;
  outcome: string;
}
interface ProfileVideoForm {
  title: string;
  url: string;
}
interface TestimonialForm {
  quote: string;
  authorName: string;
  authorRole: string;
  authorAvatar: string;
}
interface CourseReviewRef {
  id: string;
  rating: number;
  text: string | null;
  createdAt: string;
  program: { title: string } | null;
}

interface ProfileForm {
  name: string;
  image: string;
  headline: string;
  location: string;
  timezone: string;
  languages: string;
  linkedin: string;
  youtube: string;
  x: string;
  site: string;
  expertiseTags: string;
  bio: string;
  profileVisibility: string;
  slug: string;
  isMentor: boolean;
  portfolioItems: PortfolioItemForm[];
  profileVideos: ProfileVideoForm[];
  testimonials: TestimonialForm[];
}

type TabKey = "identity" | "proof" | "mentorship";

/**
 * Downscale + JPEG-recompress an uploaded avatar client-side so it fits in the
 * `User.image` text column as a data URI. Real camera/phone JPEGs routinely run
 * 1-5MB — the old code just rejected those outright (and left the previous
 * `form.image` in place, so the reject read as a silent no-op on Save). Instead:
 * draw at a bounded max dimension, then step JPEG quality down until it's under
 * `maxBytes`. Only genuinely un-shrinkable input (e.g. a huge flat-color PNG)
 * still throws.
 */
function resizeImageToDataUrl(
  file: File,
  { maxDimension, maxBytes }: { maxDimension: number; maxBytes: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That file isn't an image."));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not process that image."));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let quality = 0.9;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > maxBytes && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      if (dataUrl.length > maxBytes) {
        reject(new Error("This image is too large to store even after compression. Try a different photo."));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file."));
    };
    img.src = objectUrl;
  });
}

/**
 * The linked Contact's phone and consent state, read through Contact.userId.
 * `smsOptOutAt` and `doNotCall` are DISPLAY ONLY here: an opt-out belongs to
 * inbound STOP/START and DNC records a human's verbal request, so neither is
 * ever sent back in the PATCH payload.
 */
type PersonContactState = {
  phone: string;
  callConsent: boolean;
  phoneConsentAt: string | null;
  smsMarketingConsentAt: string | null;
  smsTransactionalConsentAt: string | null;
  smsOptOutAt: string | null;
  doNotCall: boolean;
};

const EMPTY_PERSON_CONTACT: PersonContactState = {
  phone: "",
  callConsent: false,
  phoneConsentAt: null,
  smsMarketingConsentAt: null,
  smsTransactionalConsentAt: null,
  smsOptOutAt: null,
  doNotCall: false,
};

/** Never a bare number: the badge says what we may do with it. */
function consentBadgeLabel(state: PersonContactState): string {
  if (state.doNotCall) return "Do not call";
  if (state.smsOptOutAt) return "Replied STOP";
  if (state.phoneConsentAt) return "Call consented";
  return "No consent";
}

const EMPTY_FORM: ProfileForm = {
  name: "",
  image: "",
  headline: "",
  location: "",
  timezone: "",
  languages: "",
  linkedin: "",
  youtube: "",
  x: "",
  site: "",
  expertiseTags: "",
  bio: "",
  profileVisibility: "PRIVATE",
  slug: "",
  isMentor: false,
  portfolioItems: [],
  profileVideos: [],
  testimonials: [],
};

// Identical values to CohortModal — keep the two editors visually in lockstep.
const inputClass =
  "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all";
const labelClass =
  "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

/** Parse the single `socialLinks` JSON column into the four separate inputs. */
function parseSocialLinks(raw: unknown): {
  linkedin: string;
  youtube: string;
  x: string;
  site: string;
} {
  const empty = { linkedin: "", youtube: "", x: "", site: "" };
  if (typeof raw !== "string" || !raw.trim()) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      return {
        linkedin: typeof obj.linkedin === "string" ? obj.linkedin : "",
        youtube: typeof obj.youtube === "string" ? obj.youtube : "",
        x: typeof obj.x === "string" ? obj.x : "",
        site: typeof obj.site === "string" ? obj.site : "",
      };
    }
  } catch {
    // Malformed JSON in the column — fall back to empty inputs rather than
    // crashing the editor. A subsequent save rewrites it cleanly.
  }
  return empty;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "identity", label: "Identity" },
  { key: "proof", label: "Proof" },
  { key: "mentorship", label: "Mentorship" },
];

export default function UserProfileModal({
  userId,
  onClose,
  onSaved,
}: {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("identity");
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [email, setEmail] = useState("");
  const [courseReviews, setCourseReviews] = useState<CourseReviewRef[]>([]);
  const [taughtCohortsCount, setTaughtCohortsCount] = useState(0);
  const [personContact, setPersonContact] = useState<PersonContactState>(
    EMPTY_PERSON_CONTACT
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/profile`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error || "Failed to load profile");
          return;
        }
        const contact = data.personContact ?? {};
        setPersonContact({
          phone: typeof contact.phone === "string" ? contact.phone : "",
          callConsent: Boolean(contact.phoneConsentAt),
          phoneConsentAt: contact.phoneConsentAt ?? null,
          smsMarketingConsentAt: contact.smsMarketingConsentAt ?? null,
          smsTransactionalConsentAt: contact.smsTransactionalConsentAt ?? null,
          smsOptOutAt: contact.smsOptOutAt ?? null,
          doNotCall: Boolean(contact.doNotCall),
        });

        const social = parseSocialLinks(data.socialLinks);
        setForm({
          name: data.name || "",
          image: data.image || "",
          headline: data.headline || "",
          location: data.location || "",
          timezone: data.timezone || "",
          languages: data.languages || "",
          linkedin: social.linkedin,
          youtube: social.youtube,
          x: social.x,
          site: social.site,
          expertiseTags: data.expertiseTags || "",
          bio: data.bio || "",
          profileVisibility: data.profileVisibility || "PRIVATE",
          slug: data.slug || "",
          isMentor: Boolean(data.isMentor),
          portfolioItems: Array.isArray(data.portfolioItems)
            ? data.portfolioItems.map((p: Record<string, unknown>) => ({
                title: (p.title as string) || "",
                url: (p.url as string) || "",
                thumbnail: (p.thumbnail as string) || "",
                outcome: (p.outcome as string) || "",
              }))
            : [],
          profileVideos: Array.isArray(data.profileVideos)
            ? data.profileVideos.map((v: Record<string, unknown>) => ({
                title: (v.title as string) || "",
                url: (v.url as string) || "",
              }))
            : [],
          testimonials: Array.isArray(data.testimonials)
            ? data.testimonials.map((t: Record<string, unknown>) => ({
                quote: (t.quote as string) || "",
                authorName: (t.authorName as string) || "",
                authorRole: (t.authorRole as string) || "",
                authorAvatar: (t.authorAvatar as string) || "",
              }))
            : [],
        });
        setEmail(data.email || "");
        setCourseReviews(Array.isArray(data.courseReviews) ? data.courseReviews : []);
        setTaughtCohortsCount(Number(data.taughtCohortsCount) || 0);
        setLoaded(true);
      } catch {
        if (!cancelled) setError("Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setImageProcessing(true);
    resizeImageToDataUrl(file, { maxDimension: 512, maxBytes: 500 * 1024 })
      .then((result) => setForm((prev) => ({ ...prev, image: result })))
      .catch((err: unknown) => {
        // Ingestion-point failure: reject loudly here so a stale `image` never
        // silently rides along on the next Save (that was the original bug —
        // an oversized upload got dropped with no field ever updated).
        setError(err instanceof Error ? err.message : "Could not process that image.");
      })
      .finally(() => setImageProcessing(false));
    // Allow re-selecting the same file after a failed attempt.
    e.target.value = "";
  };

  // ── Portfolio row editors ──────────────────────────────────────────
  const addPortfolio = () =>
    setForm((p) => ({
      ...p,
      portfolioItems: [...p.portfolioItems, { title: "", url: "", thumbnail: "", outcome: "" }],
    }));
  const removePortfolio = (i: number) =>
    setForm((p) => ({
      ...p,
      portfolioItems: p.portfolioItems.filter((_, idx) => idx !== i),
    }));
  const updatePortfolio = (i: number, field: keyof PortfolioItemForm, value: string) =>
    setForm((p) => ({
      ...p,
      portfolioItems: p.portfolioItems.map((it, idx) =>
        idx === i ? { ...it, [field]: value } : it
      ),
    }));

  // ── Video row editors ──────────────────────────────────────────────
  const addVideo = () =>
    setForm((p) => ({ ...p, profileVideos: [...p.profileVideos, { title: "", url: "" }] }));
  const removeVideo = (i: number) =>
    setForm((p) => ({ ...p, profileVideos: p.profileVideos.filter((_, idx) => idx !== i) }));
  const updateVideo = (i: number, field: keyof ProfileVideoForm, value: string) =>
    setForm((p) => ({
      ...p,
      profileVideos: p.profileVideos.map((it, idx) =>
        idx === i ? { ...it, [field]: value } : it
      ),
    }));

  // ── Testimonial row editors ────────────────────────────────────────
  const addTestimonial = () =>
    setForm((p) => ({
      ...p,
      testimonials: [
        ...p.testimonials,
        { quote: "", authorName: "", authorRole: "", authorAvatar: "" },
      ],
    }));
  const removeTestimonial = (i: number) =>
    setForm((p) => ({ ...p, testimonials: p.testimonials.filter((_, idx) => idx !== i) }));
  const updateTestimonial = (i: number, field: keyof TestimonialForm, value: string) =>
    setForm((p) => ({
      ...p,
      testimonials: p.testimonials.map((it, idx) =>
        idx === i ? { ...it, [field]: value } : it
      ),
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Re-assemble the four inputs into the single socialLinks JSON column.
      const social: Record<string, string> = {};
      if (form.linkedin.trim()) social.linkedin = form.linkedin.trim();
      if (form.youtube.trim()) social.youtube = form.youtube.trim();
      if (form.x.trim()) social.x = form.x.trim();
      if (form.site.trim()) social.site = form.site.trim();

      const payload = {
        name: form.name,
        image: form.image,
        headline: form.headline,
        location: form.location,
        timezone: form.timezone,
        languages: form.languages,
        socialLinks: Object.keys(social).length ? JSON.stringify(social) : "",
        expertiseTags: form.expertiseTags,
        bio: form.bio,
        profileVisibility: form.profileVisibility,
        slug: form.slug,
        isMentor: form.isMentor,
        portfolioItems: form.portfolioItems,
        profileVideos: form.profileVideos,
        testimonials: form.testimonials,
        // Phone and consent only. smsOptOutAt and doNotCall are never sent:
        // the API ignores them, and an admin must not be able to clear either.
        phone: personContact.phone,
        callConsent: personContact.callConsent,
      };

      const res = await fetch(`/api/admin/users/${userId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save profile");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const tabButtonClass = (key: TabKey) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      activeTab === key
        ? "bg-primary text-white shadow-sm"
        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
    }`;

  const rowCardClass =
    "rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 p-3 space-y-2";
  const addButtonClass =
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-colors";
  const removeButtonClass =
    "p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Edit Profile</h2>
            {email && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">{email}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !loaded ? (
          <div className="p-8 text-center space-y-4">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {error || "Failed to load profile"}
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Tab switcher */}
            <div className="flex items-center gap-2 px-6 pt-4">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={tabButtonClass(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {error && (
                <div className="p-3 rounded-xl text-sm bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
                  {error}
                </div>
              )}

              {/* ── Identity ─────────────────────────────────────────── */}
              {activeTab === "identity" && (
                <div className="space-y-5">
                  {/* Avatar */}
                  <div className="flex items-center gap-5">
                    <div className="relative">
                      <div className="h-20 w-20 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center">
                        {imageProcessing ? (
                          <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
                        ) : form.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={form.image} alt="Avatar" className="h-full w-full object-cover" />
                        ) : (
                          <User className="h-8 w-8 text-slate-400" />
                        )}
                      </div>
                      <label className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-primary hover:bg-primary-dark text-white flex items-center justify-center cursor-pointer shadow-lg transition-colors border-2 border-white dark:border-slate-900">
                        <Camera className="h-4 w-4" />
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleImageChange}
                          disabled={imageProcessing}
                        />
                      </label>
                      {form.image && (
                        <button
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, image: "" }))}
                          className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-sm transition-colors border-2 border-white dark:border-slate-900"
                          aria-label="Remove avatar"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                        Avatar
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        JPG or PNG, max 500KB.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Name</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Full name"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Headline</label>
                    <input
                      value={form.headline}
                      onChange={(e) => setForm((p) => ({ ...p, headline: e.target.value }))}
                      placeholder="Founder & CEO, AI Automation Agency"
                      className={inputClass}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Location</label>
                      <input
                        value={form.location}
                        onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                        placeholder="San Francisco, CA"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Timezone</label>
                      <input
                        value={form.timezone}
                        onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                        placeholder="America/Los_Angeles"
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h3 className="text-sm font-medium text-slate-900 dark:text-white mr-1">
                        Phone &amp; messaging
                      </h3>
                      <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                        {consentBadgeLabel(personContact)}
                      </span>
                    </div>

                    <div className="max-w-md">
                      <label className={labelClass}>Phone number</label>
                      <input
                        type="tel"
                        value={personContact.phone}
                        onChange={(e) =>
                          setPersonContact((p) => ({ ...p, phone: e.target.value }))
                        }
                        placeholder="+14155550123"
                        className={inputClass}
                      />
                    </div>

                    <label className="mt-3 flex items-start gap-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      <input
                        type="checkbox"
                        checked={personContact.callConsent}
                        onChange={(e) =>
                          setPersonContact((p) => ({ ...p, callConsent: e.target.checked }))
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/50"
                      />
                      <span>{CALL_CONSENT_DISCLOSURE}</span>
                    </label>

                    <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                      Marketing SMS consent: {personContact.smsMarketingConsentAt ? "on file" : "not granted"}.<br />
                      Transactional SMS consent: {personContact.smsTransactionalConsentAt ? "on file" : "not granted"}.
                      SMS consent is read-only for admins.
                    </p>

                    {personContact.smsOptOutAt !== null && (
                      <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                        They replied STOP. Only an inbound START can resume texts —
                        this cannot be cleared here.
                      </p>
                    )}

                    {personContact.doNotCall && (
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                        Marked do-not-call after a verbal request. Not clearable from
                        this screen.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={labelClass}>Languages</label>
                    <input
                      value={form.languages}
                      onChange={(e) => setForm((p) => ({ ...p, languages: e.target.value }))}
                      placeholder="English, Russian, Tatar"
                      className={inputClass}
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Comma-separated, e.g. English, Russian, Tatar
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>LinkedIn</label>
                      <input
                        value={form.linkedin}
                        onChange={(e) => setForm((p) => ({ ...p, linkedin: e.target.value }))}
                        placeholder="https://linkedin.com/in/..."
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>YouTube</label>
                      <input
                        value={form.youtube}
                        onChange={(e) => setForm((p) => ({ ...p, youtube: e.target.value }))}
                        placeholder="https://youtube.com/@..."
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>X</label>
                      <input
                        value={form.x}
                        onChange={(e) => setForm((p) => ({ ...p, x: e.target.value }))}
                        placeholder="https://x.com/..."
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Website</label>
                      <input
                        value={form.site}
                        onChange={(e) => setForm((p) => ({ ...p, site: e.target.value }))}
                        placeholder="https://..."
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Expertise</label>
                    <input
                      value={form.expertiseTags}
                      onChange={(e) => setForm((p) => ({ ...p, expertiseTags: e.target.value }))}
                      placeholder="Claude Code, n8n, VAPI"
                      className={inputClass}
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Comma-separated — shown as tags on the profile, e.g. Claude Code, n8n, VAPI
                    </p>
                  </div>

                  <div>
                    <label className={labelClass}>Bio</label>
                    <Editor
                      content={form.bio}
                      onChange={(html) => setForm((p) => ({ ...p, bio: html }))}
                      placeholder="Short professional bio…"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Visibility</label>
                      <select
                        value={form.profileVisibility}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, profileVisibility: e.target.value }))
                        }
                        className={inputClass}
                      >
                        <option value="PRIVATE">Private</option>
                        <option value="PUBLIC">Public</option>
                        <option value="UNLISTED">Unlisted</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Public URL slug</label>
                      <input
                        value={form.slug}
                        onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                        placeholder="jane-doe"
                        className={inputClass}
                      />
                      <p className="mt-1 text-xs text-slate-400">
                        Used at /humans/{"{slug}"} when Public or Unlisted.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Proof ────────────────────────────────────────────── */}
              {activeTab === "proof" && (
                <div className="space-y-8">
                  {/* Portfolio */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className={labelClass} style={{ marginBottom: 0 }}>
                        Portfolio Items
                      </label>
                      <button type="button" onClick={addPortfolio} className={addButtonClass}>
                        <Plus className="h-4 w-4" />
                        Add item
                      </button>
                    </div>
                    {form.portfolioItems.length === 0 ? (
                      <p className="text-xs text-slate-400">No portfolio items yet.</p>
                    ) : (
                      form.portfolioItems.map((it, i) => (
                        <div key={i} className={rowCardClass}>
                          <div className="flex items-start gap-2">
                            <input
                              value={it.title}
                              onChange={(e) => updatePortfolio(i, "title", e.target.value)}
                              placeholder="Title"
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={() => removePortfolio(i)}
                              className={removeButtonClass}
                              aria-label="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <input
                            value={it.url}
                            onChange={(e) => updatePortfolio(i, "url", e.target.value)}
                            placeholder="URL (https://...)"
                            className={inputClass}
                          />
                          <input
                            value={it.thumbnail}
                            onChange={(e) => updatePortfolio(i, "thumbnail", e.target.value)}
                            placeholder="Thumbnail URL (optional)"
                            className={inputClass}
                          />
                          <input
                            value={it.outcome}
                            onChange={(e) => updatePortfolio(i, "outcome", e.target.value)}
                            placeholder="Outcome (optional), e.g. Booked 200 calls/mo"
                            className={inputClass}
                          />
                        </div>
                      ))
                    )}
                  </div>

                  {/* Videos */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className={labelClass} style={{ marginBottom: 0 }}>
                        Videos
                      </label>
                      <button type="button" onClick={addVideo} className={addButtonClass}>
                        <Plus className="h-4 w-4" />
                        Add video
                      </button>
                    </div>
                    {form.profileVideos.length === 0 ? (
                      <p className="text-xs text-slate-400">No videos yet.</p>
                    ) : (
                      form.profileVideos.map((it, i) => (
                        <div key={i} className={rowCardClass}>
                          <div className="flex items-start gap-2">
                            <input
                              value={it.title}
                              onChange={(e) => updateVideo(i, "title", e.target.value)}
                              placeholder="Title (optional)"
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={() => removeVideo(i)}
                              className={removeButtonClass}
                              aria-label="Remove video"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <input
                            value={it.url}
                            onChange={(e) => updateVideo(i, "url", e.target.value)}
                            placeholder="Video URL (https://...)"
                            className={inputClass}
                          />
                        </div>
                      ))
                    )}
                  </div>

                  {/* Testimonials */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className={labelClass} style={{ marginBottom: 0 }}>
                        Testimonials
                      </label>
                      <button type="button" onClick={addTestimonial} className={addButtonClass}>
                        <Plus className="h-4 w-4" />
                        Add testimonial
                      </button>
                    </div>
                    {form.testimonials.length === 0 ? (
                      <p className="text-xs text-slate-400">No testimonials yet.</p>
                    ) : (
                      form.testimonials.map((it, i) => (
                        <div key={i} className={rowCardClass}>
                          <div className="flex items-start gap-2">
                            <textarea
                              value={it.quote}
                              onChange={(e) => updateTestimonial(i, "quote", e.target.value)}
                              placeholder="Quote"
                              rows={3}
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={() => removeTestimonial(i)}
                              className={removeButtonClass}
                              aria-label="Remove testimonial"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              value={it.authorName}
                              onChange={(e) => updateTestimonial(i, "authorName", e.target.value)}
                              placeholder="Author name"
                              className={inputClass}
                            />
                            <input
                              value={it.authorRole}
                              onChange={(e) => updateTestimonial(i, "authorRole", e.target.value)}
                              placeholder="Author role (optional)"
                              className={inputClass}
                            />
                          </div>
                          <input
                            value={it.authorAvatar}
                            onChange={(e) => updateTestimonial(i, "authorAvatar", e.target.value)}
                            placeholder="Author avatar URL (optional)"
                            className={inputClass}
                          />
                        </div>
                      ))
                    )}
                  </div>

                  {/* Read-only reference: real course reviews + taught count */}
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Cohorts taught: {taughtCohortsCount}
                    </p>
                    <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Course reviews (for reference)
                    </h4>
                    {courseReviews.length === 0 ? (
                      <p className="text-xs text-slate-400">No course reviews yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {courseReviews.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 p-3"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-amber-600 dark:text-amber-400">
                                {r.rating}/5
                              </span>
                              <span className="truncate">{r.program?.title || "Unknown program"}</span>
                              <span className="flex-shrink-0">
                                {new Date(r.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            {r.text && (
                              <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
                                {r.text}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Mentorship ───────────────────────────────────────── */}
              {activeTab === "mentorship" && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isMentor}
                      onChange={(e) => setForm((p) => ({ ...p, isMentor: e.target.checked }))}
                      className="h-4 w-4"
                    />
                    <span className={labelClass} style={{ marginBottom: 0 }}>
                      Available as a mentor
                    </span>
                  </label>
                  <p className="text-xs text-slate-400">
                    Unlocks the Mentors roster listing and the availability/booking section —
                    availability scheduling itself is managed elsewhere and is not part of this
                    editor.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || imageProcessing}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 hover:shadow-md hover:shadow-primary/20"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
