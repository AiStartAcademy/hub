# Architecture

The hub is one Next.js application backed by one SQLite file. It serves three jobs from the
same codebase and database: a learning platform, a lead and communications engine, and an
operations back office (payments, venue rentals, instructor scheduling, telephony).

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack, `output: "standalone"`) |
| UI | React 19, Tailwind CSS v4, `lucide-react`, Tiptap rich text, dnd-kit |
| Language | TypeScript |
| ORM / DB | Prisma 6, SQLite (one file on a persistent volume) |
| Auth | Auth.js / NextAuth v5 (JWT sessions; Google OAuth + email/password) |
| Payments | Stripe (hosted Checkout, subscriptions, payment links) |
| Media | Google Cloud Storage |
| Email | Nodemailer over SMTP |
| SMS / voice | Twilio (messaging, Voice SDK softphone), Vapi (AI voice) |
| Meetings | Zoom Server-to-Server OAuth, Google Calendar |
| Chat | Rocket.Chat |
| PDFs | Puppeteer + system Chromium, `pdf-lib` |
| Logging | Pino (pretty locally; Loki + file in other environments), optional Grafana Faro in the browser |
| Tests | `bun test` over `tests/unit` |

## Repository layout

```
prisma/schema.prisma      # the whole data model (applied with `prisma db push`)
src/
├── app/
│   ├── (dashboard)/      # signed-in app shell (noindex): courses, cohorts, admin, members…
│   ├── (marketing)/      # public marketing pages (events, newsletter)
│   ├── api/              # route handlers (see "API surface")
│   ├── onboarding/[slug] # public onboarding quiz player
│   ├── agreements, book, join, waiver, instructor-response, instructor-schedule, …
│   │                     # token-addressed public flows
│   ├── legal, privacy, terms, login, register, set-password, verify-email, unsubscribe
│   └── layout.tsx, robots.ts, sitemap.ts, manifest.ts
├── components/           # shared UI (admin, chat, cohorts, members, softphone, venue, …)
├── config/
│   ├── brand.ts          # every academy-specific value (name, domains, contacts, copy)
│   └── catalog.ts        # optional catalog ids from env
├── content/              # legal markdown, agreement templates, countersignature image
├── generated/client/     # generated Prisma client (not committed; run `prisma generate`)
├── lib/                  # domain logic and integrations (see below)
└── services/emails/      # transactional email builders
tests/unit/               # bun unit tests for src/lib
scripts/                  # one-off and backfill scripts (tsx), call-transcript pipeline
audio-extractor/          # optional ffmpeg microservice used by the n8n audio workflow
certificate-templates/    # HTML certificate templates
```

Route groups in parentheses add no URL segment: `src/app/(dashboard)/courses/page.tsx` serves
`/courses`.

## Domains and data model

`prisma/schema.prisma` has about 90 models. SQLite conventions: enums are `String` columns and
structured data is JSON stored as `String`.

**Identity and people**: `User` (multi-role via `roles` JSON array), `Account`, `Session`,
`VerificationToken`, `UserConsent`, profile extras (`PortfolioItem`, `ProfileVideo`,
`Testimonial`). See [features/USER_ROLES.md](./features/USER_ROLES.md) and
[features/HUMANS.md](./features/HUMANS.md).

**Learning content**: `Program` → `Module` → `Lesson` (+ `LessonVideo`), with `Quiz*` and
`Assessment*` trees and their submissions, `LessonProgress`, `CourseReview`, `ProgramMaterial`,
`LearningPath` / `LearningPathItem`, `MediaFolder` / `Media`, `DuplicateJob` for async copies.

**Cohorts and scheduling**: `Cohort` → `Group` (seat tier with price and seats) →
`GroupMember`; `Enrollment`, `ProgramEnrollment`, `ProgramAccess`; `CohortSession` (synced from
Zoom occurrences), `SessionSeries` / `SessionSeriesCohort` / `SeriesOccurrence` (shared
recurring calls), `CohortInstructor`, `SessionAssignment`,
`CohortSessionInstructorResponse`, `InstructorOutreach*`, `InstructorReminderSend`,
`InstructorSlot` / `OneOnOneBooking`. See [features/COHORTS_PUBLIC.md](./features/COHORTS_PUBLIC.md)
and [features/COURSE_ACCESS.md](./features/COURSE_ACCESS.md).

**Commerce**: `Payment`, `Membership`, `Coupon` / `Redemption`, plus community objects for
members (`Pod`, `PodMember`, `Milestone`, `MilestoneAchievement`, `MemberEvent`,
`MemberResource`). See [features/PAYMENTS.md](./features/PAYMENTS.md) and
[features/MEMBERS_AREA.md](./features/MEMBERS_AREA.md).

**Leads and communications**: `Contact` (the person record for leads and students, including
consent fields), `ContactEvent` (timeline), `ContactNote`, `ContactCall`, `ContactMessage`,
`CloserSlot` / `LeadBooking`, `OnboardingForm` → `OnboardingStep` → `OnboardingElement` →
`OnboardingOption`, `OnboardingTagCohort`, `OnboardingResponse`, `DripCampaign` / `DripStep` /
`DripEnrollment` / `DripSend`, `EmailEvent`. See [features/LEADS.md](./features/LEADS.md),
[features/ONBOARDING.md](./features/ONBOARDING.md) and
[features/DRIP_CAMPAIGNS.md](./features/DRIP_CAMPAIGNS.md).

**Venue**: `VenueEvent`, `VenueEventRegistration`, `VenueAgreement` (public calendar, event
pages, waivers, signed agreements, Stripe payment links for rentals).

**Certificates**: `CertificateTemplate`, `Certificate`. See
[features/CERTIFICATES.md](./features/CERTIFICATES.md).

**Content platform and agents**: `ContentPage`, `ImportBatch`, `Agent`, `AgentRun`. See
[features/CONTENT_CMS.md](./features/CONTENT_CMS.md).

**Platform**: `Secret` / `SecretAudit` (Integrations store), `AiUsage` (LLM usage and cost),
`MindHealthConfig`.

## `src/lib` map

| Area | Files |
|------|-------|
| Auth and roles | `auth.ts`, `roles.ts`, `roles.server.ts`, `adminGuard.ts`, `audience.ts`, `password.ts`, `tokens.ts` |
| Access | `programAccess.ts`, `entitlements.ts`, `membershipTiers.ts`, `consent.ts`, `legalDocs.ts` |
| Data | `prisma.ts`, `secrets.ts`, `secretsCrypto.ts`, `mcpApi.ts` |
| Payments | `stripe.ts`, `payments/`, `purchases.ts`, `coupons.ts`, `seats.ts`, `freeSeat.ts`, `selfPaced.ts`, `membershipLifecycle.ts`, `programPurchaseLifecycle.ts` |
| Leads | `leads/`, `attribution.ts`, `onboarding-*.ts`, `lead-cookie.ts`, `booking/`, `serverConversions.ts`, `metaPixel.ts` |
| Messaging | `mail.ts`, `drip/`, `cohortMessages/`, `sms/`, `outreach/`, `communicationPreferences.ts` |
| Telephony | `twilio/`, `vapi/`, `calls/` |
| Scheduling | `zoom.ts`, `googleCalendar.ts`, `sessionSeries.ts`, `seriesSchedule.ts`, `instructorSchedule.ts`, `instructorParticipation.ts`, `instructorReminders.ts`, `recordings.ts` |
| Venue | `venue*.ts`, `waiver.ts`, `agreementTemplates.ts`, `agreementDocument.ts` |
| Content | `content.ts`, `gcs.ts`, `googleDrive.ts`, `driveUtils.ts`, `certificates.ts`, `pdfGenerator.ts` |
| AI | `inference.ts` (OpenRouter), `ai/features.ts` |
| Chat | `rocketchat.ts`, `chat/`, `memberChat.ts` |
| Infra | `logger.ts`, `rateLimit.ts`, `serviceAuth.ts`, `sanitize.ts` |

Keep decision logic in `src/lib` as pure functions over plain inputs; route handlers and
server actions stay thin. See [CONVENTIONS.md](./CONVENTIONS.md).

## API surface

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/api/admin/*` | session + staff/admin role | Admin CRUD |
| `/api/*` (other) | session, role checked per route | App features |
| `/api/public/*` | none, rate-limited where it writes | Public cohorts feed, venue calendar and registration, booking, newsletter |
| `/api/webhooks/*` | provider signature | Stripe, Twilio, Vapi, Zoom |
| `/api/internal/drip/tick`, `/api/internal/instructor/tick` | `DRIP_CRON_TOKEN` | Scheduled runners |
| `/api/internal/mcp/*` | `HUB_MCP_TOKEN` (+ write switch) | MCP API ([MCP_API.md](./MCP_API.md)) |
| `/api/content/*`, `/api/agents/*` | dedicated bearer tokens | Content pipeline and agents service |
| `/api/n8n/*` | n8n bearer secrets | Automation callbacks |
| `/api/e/o/[token]`, `/api/e/c/[token]` | signed token | Email open/click tracking |

Details: [SECURITY.md](./SECURITY.md).

## Request flow

1. Pages and route handlers call `auth()` (no global middleware) and check roles with the
   helpers in `src/lib/roles.ts`.
2. Server components fetch with Prisma directly; client components call route handlers or
   server actions.
3. Integration credentials are resolved at request time (`getSecret()` or lazily constructed
   clients), never at module import, so `next build` works with an empty environment.

## Background work

There is no job queue. Time-based work runs when an external scheduler calls the tick routes
(drip campaigns, broadcasts, cohort messages, instructor reminders). Provider events arrive by
webhook. See [DEPLOYMENT.md](./DEPLOYMENT.md#7-scheduled-jobs).
