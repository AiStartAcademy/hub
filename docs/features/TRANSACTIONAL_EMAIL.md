# Transactional Email

How the hub sends system-triggered email: verification, invites, account setup, purchase
welcomes, free-seat confirmations, lead-magnet delivery, issue reports. Transactional means one
message per user action.

It is not scheduled or bulk mail. Nurtures, broadcasts, cohort reminders and cohort messages run
on the drip engine ([DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md)), which reuses this module's
`sendMail()` but has its own scheduler and suppression rules. Leads live in
[LEADS.md](./LEADS.md).

## Architecture

One [nodemailer](https://nodemailer.com) SMTP transport in `src/lib/mail.ts` is the only send
path. There is no queue and no provider API, just SMTP to whatever host `SMTP_*` points at.

```
caller (route / webhook / service)
        ├─ helpers in src/lib/mail.ts and src/services/emails/*
        └─ sendMail({ to, subject, html, from?, replyTo?, text?, headers?, attachments? })
                     │
             nodemailer transport (SMTP_HOST:SMTP_PORT)
```

SMTP settings are read per send and the transport is rebuilt when they change, so a key saved
in Admin → Integrations takes effect without a redeploy (within the 30-second `getSecret` cache).

### `sendMail`

The primitive for any new email. It:

- Builds `From` from the override or the managed `MAIL_FROM` (see below).
- Adds a plain-text part derived from the HTML by `htmlToText()` (`src/lib/mailText.ts`) unless
  `text` is passed. Every message is `multipart/alternative`.
- Passes optional `headers` (used only by nurture mail for `List-Unsubscribe`) and attachments.
- Throws on SMTP errors, and also when the server does not accept every recipient.
- **No-ops when `SMTP_HOST` is unset**: it logs `to` / `subject` / `from` and returns. This makes
  local dev work with no mail config, and means a missing `SMTP_HOST` in production silently
  drops mail. `isMailConfigured()` reports the state (the drip tick `GET` exposes it).

### The `From` header

`fromHeader(override?)` builds one RFC 5322 `From`. The display name is
`brand.email.fromName` from `src/config/brand.ts`.

| `MAIL_FROM` value | Result |
|---|---|
| unset | `"<fromName>" <onboarding@example.com>` (fallback; set `MAIL_FROM` in production) |
| `hello@example.com` | `"<fromName>" <hello@example.com>` |
| `"Example Academy" <hello@example.com>` | used as-is, never double-wrapped |

Pass `from` to `sendMail` to override per message.

## Configuration

Keys resolve through `getSecret()` (`src/lib/secrets.ts`): the managed store at
`/admin/integrations` wins, `process.env` is the fallback. See
[../ENVIRONMENT.md](../ENVIRONMENT.md) and [INTEGRATIONS.md](./INTEGRATIONS.md).

| Key | Kind | Purpose |
|---|---|---|
| `SMTP_HOST` | config | SMTP host. Unset means mail is logged, not sent |
| `SMTP_PORT` | config | Port, default `587` |
| `SMTP_SECURE` | config | `"true"` for implicit TLS; implied on port `465` |
| `SMTP_USER` | config | SMTP auth user |
| `SMTP_PASS` | secret | SMTP password or provider auth token |
| `MAIL_FROM` | config | From address or full mailbox |
| `REPORT_ISSUE_EMAIL` | env only | Destination for Report Issue; read from `process.env` directly, falls back to the `MAIL_FROM` env var, then `support@example.com` |
| `NEXT_PUBLIC_APP_URL` | env | Base URL for links in mail; read at module load in `mail.ts`, defaults to `http://localhost:3000` |

The SMTP keys are not in the Integrations suggestion list (`knownKeys.ts`); add them as custom
keys, or set them as env vars.

## Current emails

| Helper | Trigger | Link / payload |
|---|---|---|
| `sendVerificationEmail` | `POST /api/register`, `POST /api/me/resend-verification`, `POST /api/lead/claim-account` | `/verify-email?token=…` (optional `callbackUrl`, `groupId`); 24h expiry; hand-written text part |
| `sendInviteEmail` | `POST /api/admin/users/invite` | `/set-password?token=…&email=…` |
| `sendGroupInviteEmail` | cohort group invites (`/api/cohorts/[id]/groups/[groupId]/invites`) | `/set-password?token=…` plus a login link back to the cohort |
| `sendAccountSetupEmail` | Stripe webhook: paid cohort seat or membership for a passwordless user | `/set-password?token=…`; one-hour link |
| `sendFreeSeatEmail` | `POST /api/cohorts/[id]/register-free` | next session join link, cohort URL, set-password link for new accounts |
| `sendSelfPacedWelcomeEmail` | self-paced program purchase (`src/lib/programPurchaseLifecycle.ts`) | course link |
| `sendMembershipWelcomeEmail` | membership activation (`src/lib/membershipLifecycle.ts`) | getting-started message; idempotent, failure bubbles for Stripe retry |
| `sendLeadMagnetEmail` (`src/services/emails/lead-magnet.ts`) | `POST /api/download-contact` | download URL, "expires in 24 hours" |
| `sendNewsletterWelcomeEmail` (`src/services/emails/newsletter-welcome.ts`) | `POST /api/public/newsletter/subscribe` | immediate confirmation; the nurture is a separate drip campaign |
| `sendMail` inline | `POST /api/report-issue` | issue report to `REPORT_ISSUE_EMAIL`, `replyTo` = reporter |

Booking ([LEAD_BOOKING.md](./LEAD_BOOKING.md)), instructor outreach and reminders, and venue
event mail also call `sendMail` directly from their own modules.

## Conventions and gotchas

- **Inline-styled HTML, no templating engine.** Each helper builds an HTML string with inline
  CSS (clients strip `<style>` blocks). Use `src/config/brand.ts` for names and addresses.
- **Escape user input.** `mail.ts` exports `escapeHtml()`. Most helpers escape titles and names;
  the report-issue route only escapes `<` in the description. Use `escapeHtml()` for every
  user-controlled value in new mail.
- **Failure semantics belong to the caller.** `register-free` wraps the send in try/catch so a
  mail failure never loses the seat. The Stripe webhook lets it throw so Stripe's retry
  re-attempts delivery.
- **Idempotency for paid flows.** Setup mail is gated on `accountSetupSentAt` on the `Payment` /
  `Membership` row and stamped only after the send succeeds. Never send unconditionally from a
  webhook.
- **Links use `NEXT_PUBLIC_APP_URL`.** A wrong value means broken verify/setup links.

## Deliverability

- **Every message is `multipart/alternative`.** HTML-only mail is a spam signal. `htmlToText`
  is dependency-free and template-shaped: it drops `<style>`/`<script>`/`<head>`, renders links
  as `label (url)`, breaks on block tags, decodes entities and collapses whitespace. Pass `text`
  when a hand-written version reads better.
- **Nurture mail carries RFC 8058 one-click unsubscribe.** `unsubscribeHeaders(token, replyTo,
  scope)` in `src/lib/drip/engine.ts` builds:

  ```
  List-Unsubscribe: <mailto:hello@example.com?subject=unsubscribe>, <https://hub.example.com/api/unsubscribe?token=…>
  List-Unsubscribe-Post: List-Unsubscribe=One-Click
  ```

  Course-scope drip mail appends `&scope=course`. The headers are set by exactly two send sites:
  the drip runner and one-off outreach (`sendOneOffEmail` in `src/lib/outreach/email.ts`). The
  campaign test send does not set them. The `mailto:` half carries no scope and needs manual
  handling.
- **Transactional mail never gets these headers.** A recipient cannot opt out of a message they
  triggered, and claiming otherwise is its own compliance problem.
- Configure SPF, DKIM and DMARC for your sending domain; the hub does not manage DNS.

### `/api/unsubscribe`

`src/app/api/unsubscribe/route.ts`, `force-dynamic`:

- `POST` is the one-click endpoint. The token comes from the query string, or a form-encoded or
  JSON body; `scope=course` selects the course opt-out. No auth and no CSRF check: the
  unguessable per-contact token is the credential, and the endpoint can do nothing else.
  Returns `200 {ok:true}` on success or an already-unsubscribed token, `404 {ok:false}` for a
  missing or unknown token.
- `GET` only `302`-redirects to the human-facing `/unsubscribe` page, so a link scanner's
  prefetch cannot unsubscribe anyone.

## Adding a transactional email

1. Add a helper in `src/services/emails/<name>.ts` (or `src/lib/mail.ts` for auth-adjacent
   mail) that wraps `sendMail`.
2. Inline styles only; run every user-controlled value through `escapeHtml()`.
3. Build links from `NEXT_PUBLIC_APP_URL`.
4. Decide failure semantics at the call site (swallow vs throw for a webhook retry), and add a
   `*SentAt` guard if a retry could double-send.
5. Do not add `List-Unsubscribe` headers.
6. Verify locally with `SMTP_HOST` unset and check the logged `to` / `subject` / `from`.

## Limits

No queue or retry layer of its own (relies on caller logic and webhook retries), no bounce or
complaint feedback, no i18n. The single `sendMail` seam is where an SMTP-to-provider swap would
go without touching callers. Architecture context: [../ARCHITECTURE.md](../ARCHITECTURE.md).
