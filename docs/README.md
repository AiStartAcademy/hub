# Hub Documentation

The hub is an open-source academy platform: an LMS for programs, cohorts and lessons, a lead
and communications engine, and the back office around it (payments, venue rentals, instructor
scheduling, telephony). Start with the root [README](../README.md) for the overview and
quickstart.

## Guides

| Doc | What's inside |
|-----|---------------|
| [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) | Run the hub on your machine, seed demo data, work on integrations locally |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Every environment variable, grouped by integration |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Self-hosting with Docker: volume, start script, webhooks, cron |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, layout, data model, `src/lib` map, API surface |
| [CONVENTIONS.md](./CONVENTIONS.md) | Code patterns, build safety, database and testing rules |
| [SECURITY.md](./SECURITY.md) | Authentication, roles, machine tokens, webhook verification, data handling |
| [MCP_API.md](./MCP_API.md) | The internal API used by the companion MCP server |

## Features

**Learning**

| Doc | What's inside |
|-----|---------------|
| [COURSE_ACCESS.md](./features/COURSE_ACCESS.md) | How program access is decided |
| [CERTIFICATES.md](./features/CERTIFICATES.md) | Certificate generation, verification, graduate notifications |
| [TRACK_RECORD.md](./features/TRACK_RECORD.md) | Learner history across cohorts, lessons, tests and certificates |
| [COHORTS_PUBLIC.md](./features/COHORTS_PUBLIC.md) | Public cohorts page and seat registration |
| [PUBLIC_COHORTS_FEED.md](./features/PUBLIC_COHORTS_FEED.md) | Public JSON feed of cohorts for external sites |
| [MEMBERS_AREA.md](./features/MEMBERS_AREA.md) | Membership tiers, members area, pods, community |
| [CHAT.md](./features/CHAT.md) | Cohort and member chat |
| [HUMANS.md](./features/HUMANS.md) | Public instructor and mentor profiles |
| [SESSION_SERIES.md](./features/SESSION_SERIES.md) | Shared recurring session series attached to cohorts, Zoom linkage |
| [INSTRUCTOR_SCHEDULING.md](./features/INSTRUCTOR_SCHEDULING.md) | Per-session instructor proposals, confirmations, Calendar sync, reminders |
| [ZOOM_RECORDINGS.md](./features/ZOOM_RECORDINGS.md) | Zoom cloud recordings imported as lessons |

**Leads and communications**

| Doc | What's inside |
|-----|---------------|
| [ONBOARDING.md](./features/ONBOARDING.md) | Branching onboarding quizzes, tag routing |
| [ATTRIBUTION.md](./features/ATTRIBUTION.md) | UTM and ad click-id capture |
| [LEADS.md](./features/LEADS.md) | Leads CRM and pipeline |
| [LEAD_BOOKING.md](./features/LEAD_BOOKING.md) | Public 1:1 booking with availability, Zoom and Calendar |
| [DRIP_CAMPAIGNS.md](./features/DRIP_CAMPAIGNS.md) | Drip campaigns, broadcasts, segments, send windows |
| [EMAIL_TRACKING.md](./features/EMAIL_TRACKING.md) | Signed open and click tracking |
| [TRANSACTIONAL_EMAIL.md](./features/TRANSACTIONAL_EMAIL.md) | System email over SMTP |
| [COHORT_MESSAGES.md](./features/COHORT_MESSAGES.md) | Cohort email and SMS blasts, SMS consent, STOP handling |
| [TELEPHONY.md](./features/TELEPHONY.md) | Twilio browser softphone, inbound call routing, recordings |
| [VAPI_RECEPTIONIST.md](./features/VAPI_RECEPTIONIST.md) | AI voice receptionist and outbound AI calls |
| [CALL_TRANSCRIPTS.md](./features/CALL_TRANSCRIPTS.md) | Call recording transcription pipeline |
| [ANALYTICS_SEO.md](./features/ANALYTICS_SEO.md) | Tag Manager, server-side conversions, SEO metadata |

**Commerce and platform**

| Doc | What's inside |
|-----|---------------|
| [PAYMENTS.md](./features/PAYMENTS.md) | Stripe checkout, purchases, sales reporting |
| [VENUE_RENTALS.md](./features/VENUE_RENTALS.md) | Venue calendar, event pages, waivers, sign-then-pay rental agreements |
| [CONTENT_CMS.md](./features/CONTENT_CMS.md) | Headless content platform and agents control plane |
| [INTEGRATIONS.md](./features/INTEGRATIONS.md) | Admin-managed secrets and config store |
| [USER_ROLES.md](./features/USER_ROLES.md) | Multi-role users and role management |
| [VIEWS.md](./features/VIEWS.md) | Audience-based view projections |

## Not yet documented here

Coupons and cart recovery have no dedicated feature doc yet; they are covered in
[PAYMENTS.md](./features/PAYMENTS.md) and [DRIP_CAMPAIGNS.md](./features/DRIP_CAMPAIGNS.md).
For anything else, start from [ARCHITECTURE.md](./ARCHITECTURE.md) and the files it lists.
Contributions welcome.
