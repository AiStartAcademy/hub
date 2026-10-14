# Analytics and SEO

## Google Tag Manager

GTM is installed once in the root layout (`src/app/layout.tsx`). The container id comes from
`GTM_CONTAINER_ID` in `src/config/catalog.ts`, which reads `NEXT_PUBLIC_GTM_ID`; when it is
empty, no GTM snippet is rendered. Being a `NEXT_PUBLIC_` value, it is baked in at build time.

- The `gtm-init` script uses `<Script strategy="afterInteractive">`.
- A `consent-mode-init` script (`strategy="beforeInteractive"`) runs above it. Order matters.
- There is deliberately no GTM `<noscript>` iframe: Consent Mode defaults are set by JS, so a
  no-JS container load could not honour them.

GA4 lives inside GTM, not in the codebase. Do not add a manual `gtag.js` snippet; it would
double-count. Configure GA4 tags in the GTM UI with your own measurement id (`G-XXXXXXXXXX`).

## Cookie consent (Google Consent Mode v2)

`src/lib/cookieConsent.ts` owns the visitor's choice, stored in `localStorage` under
`CONSENT_KEY` (`accepted` or `declined`; absent means undecided).

- **Default deny.** `CONSENT_MODE_INIT_SCRIPT` calls `gtag('consent','default',…)` with
  `ad_storage`, `ad_user_data`, `ad_personalization` and `analytics_storage` denied
  (`wait_for_update: 500`). `functionality_storage` and `security_storage` stay granted
  (session and preference cookies are strictly necessary). The same script replays a stored
  `accepted` for returning visitors.
- **On decision.** `src/components/CookieConsent.tsx` calls `setConsent()`, which persists the
  choice and pushes a Consent Mode `update`, so already-loaded tags react without a reload.
  Accept grants all four; Decline denies. Dismissing the banner is never an implied grant.
- **Conversion events are gated in code.** GTM can forward conversions to ad platforms whose
  tags ignore Consent Mode, so `trackEvent()` in `src/lib/analytics.ts` drops
  `generate_lead`, `begin_checkout`, `purchase` and `sign_up` (`CONSENT_GATED_EVENTS`) unless
  consent is granted. Other events (`ui_click`, `attribution_captured`) still reach the
  dataLayer and are governed by Consent Mode.

If GTM will forward a new event to an ad platform, add it to `CONSENT_GATED_EVENTS`.

Visitor-facing copy must match the behaviour: the banner in `CookieConsent.tsx` and the cookie
sections of the privacy policy (`src/app/privacy/page.tsx`, `src/content/legal/`). Change both
together.

In the GTM container, enable Consent Mode, and for any non-Google tag that does not read
Consent Mode, set **Require additional consent** (for example `ad_storage`). Verify in Preview
with consent denied that ad tags are blocked and no ad or analytics cookies are set.

## Click tracking

`src/components/AnalyticsClicks.tsx` attaches one delegated capture-phase `click` listener and
pushes a `ui_click` event for `a[href]`, `button`, `[role=button|tab|menuitem|link]`,
`summary`, submit/button inputs, and anything with `data-track`.

| Field | Meaning |
|-------|---------|
| `event` | `"ui_click"` |
| `click_label` | `data-track` value, else aria-label, title, text or name |
| `click_element` | Tag name |
| `click_id` | Element id |
| `click_classes` | Element classes (truncated) |
| `click_region` | `nav`, `header`, `footer`, `sidebar`, `form`, `dialog` or `content` |
| `click_href` | Link destination |
| `click_is_external` | True for off-host `http(s)` links |
| `page_path` | `window.location.pathname` |

Add `data-track="some_action"` to give an element a stable label. Existing labels include
`subscribe_membership`, `register_free` and `buy_self_paced_course`.

To report it in GA4: in GTM create a GA4 Event tag named `ui_click` with Data Layer Variables
for the fields above, triggered by a Custom Event `ui_click`. GTM forwards a dataLayer event
only if a tag and trigger exist for that exact name, so repeat this for each conversion event
below that you want in GA4 from the browser.

## Conversion events

`trackEvent(event, params)` in `src/lib/analytics.ts` pushes standard GA4 events:

| Event | Fires when | Where |
|-------|-----------|-------|
| `begin_checkout` | a paid cohort, membership or course checkout starts | `CohortsPublic.tsx`, `cohorts/[id]/views/PublicView.tsx`, `MembershipPlans.tsx`, `BuyCourseButton.tsx` |
| `generate_lead` | a free-seat registration succeeds | `FreeSeatForm.tsx` (`conversion_kind: "free_cohort"`) |
| `generate_lead` | an onboarding quiz submit succeeds | `onboarding/[slug]/OnboardingPlayer.tsx` (`conversion_kind: "onboarding_quiz"`) |
| `purchase` | Stripe Checkout returns to a success URL | `src/components/ConversionTracker.tsx` |

**Purchase.** The checkout routes (`api/cohorts/[id]/checkout`, `api/membership/checkout`,
`api/programs/[id]/checkout`) append `sid={CHECKOUT_SESSION_ID}` (becomes `transaction_id`, so
reloads dedupe) and `amt=<price>` (becomes `value`) to the success URL. `ConversionTracker`
(mounted in the `(dashboard)` layout) pushes `purchase`, then strips the params. The Stripe
webhook remains the source of truth for access; browser events are analytics only.

**Quiz lead.** It fires once inside `handleSubmit()` right after the POST succeeds, not from a
`useEffect` on the done screen (which has several variants, some redirecting). A
`submissionStarted` ref guards re-entry. Params: `conversion_kind`, `transaction_id` (the
response id), `form_slug`, `form_name`, `steps_completed`. GA4 enhanced-measurement
`form_submit` never fires for the quiz because it submits with `fetch()`.

### Server-side conversions

`src/lib/serverConversions.ts` (`dispatchConversion`) sends the same conversions from the
server via the GA4 Measurement Protocol and the Meta Conversions API, so they survive ad
blockers and GTM misconfiguration:

- `generate_lead` from `POST /api/onboarding/[slug]`, keyed by the response id.
- `purchase` from the Stripe webhook (`reportCheckoutConversion`), keyed by the session id.
- Lead-quality status transitions from `changeLeadStatus` ([LEADS.md](./LEADS.md)).

Dispatch is fire-and-forget and never fails a request. Keys, all resolved through Admin →
Integrations with env fallback: `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `META_PIXEL_ID`,
`META_CAPI_TOKEN`, `META_TEST_EVENT_CODE`. Each platform is skipped when its keys are unset.

### Meta Pixel

`src/components/MetaPixel.tsx` (root layout) loads the pixel directly, not through GTM. The id
comes from `GET /api/meta-pixel`, which resolves `META_PIXEL_ID` at runtime, so the pixel can be
enabled or rotated without a rebuild. Nothing renders until an id is configured. It fires
`PageView` (including client-side route changes) and, via `fbqTrack()` in
`src/lib/metaPixel.ts`:

| Meta event | `eventID` | Browser call site | Server twin |
|---|---|---|---|
| `Lead` | onboarding response id | `OnboardingPlayer.tsx` | onboarding submit route |
| `Purchase` | Stripe session id | `ConversionTracker.tsx` | Stripe webhook |

Meta dedupes browser and server copies on event name plus event id. The pixel also sets the
`_fbp` / `_fbc` cookies that `conversionIdsFromRequest` passes through Stripe metadata, which
improves server-side match quality. Use `META_TEST_EVENT_CODE` with Events Manager → Test
Events to verify.

**Gotcha:** the directly loaded pixel and `fbqTrack()` do not check the cookie-consent choice.
If your jurisdiction requires opt-in before ad pixels, gate `MetaPixel` on
`hasAnalyticsConsent()` (or leave `META_PIXEL_ID` unset and rely on the server-side copy), and
make the privacy copy match.

## SEO and metadata

The hub is mostly login-gated, so the strategy is: present a clean brand to crawlers, index the
genuinely public pages, keep the authenticated app out of the index. All names, URLs, address
and social links come from `src/config/brand.ts`.

### Root metadata (`src/app/layout.tsx`)

- `metadataBase`, a title template (`%s — {brand.name}`), description, Open Graph and Twitter
  card, icons, manifest, `googleBot` directives (`max-image-preview: large`).
- JSON-LD `EducationalOrganization` (name, logo, address, contact, `sameAs` social profiles).

### Crawl control

| File | Role |
|------|------|
| `src/app/robots.ts` | Allows `/`; disallows `/api/`, `/media`, `/admin`, `/dashboard`, `/settings`, `/mind-health`, `/onboarding-responses`, `/users`, `/login`, `/register`, `/verify-email`, `/set-password`, `/onboarding/` |
| `src/app/sitemap.ts` | Dynamic (`force-dynamic`): static public pages (`/courses`, `/self-paced`, `/membership`, `/assets`, `/calendar`, `/cohorts`, `/mentors`, `/instructors`, `/privacy`, `/terms`) plus public cohorts, approved venue events (`/events/[slug]`) and indexable profiles (`/humans/[slug]`) |
| `src/app/manifest.ts` | PWA manifest |

Both robots and sitemap use `NEXT_PUBLIC_APP_URL`, falling back to `brand.urls.hub`. The
sitemap swallows database errors and still returns the static routes.

### Indexing per surface

| Surface | Indexed | How |
|---------|---------|-----|
| `(dashboard)` app | No | Group layout sets `robots: { index: false }` |
| `/courses`, `/assets` | Yes | Page metadata re-enables indexing over the group default |
| `/login`, `/register`, `/verify-email` | No | Folder layouts set noindex |
| `/onboarding/[slug]` | No | Page metadata sets noindex |

A public page placed under `(dashboard)` inherits noindex unless its own metadata sets
`robots: { index: true }`.
