# Email Tracking

Open and click instrumentation for drip mail and one-off outreach email. The hub sends over raw
SMTP (`src/lib/mail.ts`), which reports nothing back, so the only signals are the ones the hub
generates itself: a tracking pixel and a signed click redirect.

Related: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md) · [LEADS.md](./LEADS.md) ·
[TRANSACTIONAL_EMAIL.md](./TRANSACTIONAL_EMAIL.md)

## What the numbers mean

- **Clicks are the trustworthy signal.** A click means someone followed a link.
- **Opens are directional only.** Apple Mail Privacy Protection and image proxies pre-fetch
  pixels (inflating opens); clients that block images suppress them. Never build a rule, score
  or branch on opens.
- **Bounces and spam complaints are invisible** on raw SMTP. A dead address keeps receiving a
  sequence with `DripSend.status = SENT`.
- Campaign counts are **first-touch per recipient**: "3 opened" means three recipients opened at
  least once.

## Data model

`EmailEvent` (`prisma/schema.prisma`) is provider-agnostic, so a future provider webhook can
write into the same table.

| Field | Notes |
|---|---|
| `contactId` | Always set |
| `dripSendId` | Null for one-off and other non-drip mail |
| `type` | `SENT` `FAILED` `OPENED` `CLICKED` `UNSUBSCRIBED`; `DELIVERED` `BOUNCED` `COMPLAINED` are defined but never written today |
| `url` | `CLICKED` only: the destination followed |
| `subject` | Snapshot, so a timeline row reads on its own |
| `bodyHtml` | `SENT` only: the rendered fragment the recipient received |
| `userAgent` | Truncated to 500 characters |
| `ipHash` | Salted HMAC-SHA256, truncated to 16 hex characters. A raw IP is never stored |
| `source` | `"hub"` today |
| `metadata` | JSON; one-off mail stores `{kind: "oneoff", sourceEmailEventId}` |

`DripSend` carries denormalized rollups so campaign stats never scan `EmailEvent`: `contactId`,
plus first-touch `openedAt` and `firstClickedAt`.

## Token scheme

`src/lib/drip/tracking.ts`. There is no token table. Everything the endpoint needs is inside an
HMAC-SHA256-signed token:

```
base64url(JSON payload) "." base64url(HMAC)
```

Payload: `k` (`o` open / `c` click), `s` (DripSend id for drip mail, the `SENT` EmailEvent id for
one-off mail), `c` (contact id), `t` (`drip` or `oneoff`; tokens without it resolve as drip), and
for clicks `u`, the destination. Because the URL is inside the signed payload, the click endpoint
cannot be used as an open redirect. Only `http(s)` destinations are signed or followed.

`createTrackingSigner()` resolves the secret once per send and returns a synchronous signer, so
rendering stays synchronous.

## Configuration

| Key | Behaviour when unset |
|---|---|
| `DRIP_TRACKING_SECRET` | Tracking is disabled and mail sends untracked: a safe degrade, never an error |
| `DRIP_TRACKING_SALT` | IP hashing falls back to `DRIP_TRACKING_SECRET` as the salt |

Both resolve through `getSecret()` (Admin → Integrations at `/admin/integrations`, then env;
`src/lib/secrets.ts`), per call and never at module scope, so builds without env still pass. See
[../ENVIRONMENT.md](../ENVIRONMENT.md).

Rotating `DRIP_TRACKING_SECRET` invalidates tracking links in mail already delivered: they stop
recording and redirect to the app root.

## Endpoints

Both are public and unauthenticated (the caller is a mail client), `force-dynamic`, and send
`X-Robots-Tag: noindex, nofollow`.

- `GET /api/e/o/[token]` always returns a 1×1 GIF with no-store caching, whatever happens. An
  invalid token, missing secret or database error never produces a broken image. A valid token
  writes `OPENED`, sets `DripSend.openedAt` on the first open (drip only), and bumps
  `Contact.lastActivityAt`. Deduped to one `OPENED` event per send per 60 seconds.
- `GET /api/e/c/[token]` answers `307` to the signed destination, writes `CLICKED`, sets
  `firstClickedAt` on the first click (drip only), and bumps `lastActivityAt`. An invalid or
  tampered token redirects to the app root and records nothing.

One-off tokens are only honoured when the referenced `SENT` event belongs to the same contact
and carries one-off metadata.

## Rendering

`renderStepHtml` (`src/lib/drip/template.ts`) applies tracking last, after UTM tagging, so the
URL sealed in a click token is exactly what the reader would otherwise reach, UTM parameters
included.

Deliberate exclusions:

1. **The unsubscribe link is never wrapped.** It must work even if tracking is misconfigured,
   and an opt-out is not engagement. An unsubscribe writes an `UNSUBSCRIBED` event attributed to
   the contact's most recent `DripSend`, and no `CLICKED` event.
2. **Relative, `mailto:` and `tel:` hrefs are left alone.** Only absolute http(s) URLs are
   signed.

With no signer the output is byte-identical to an untracked render, which keeps test sends and
admin previews unaffected. Pinned by `tests/unit/drip-template.test.ts` and
`tests/unit/drip-tracking.test.ts` (run with `bun test tests/unit`).

## Instrumentation never breaks the send

`recordEmailEvent` in `src/lib/drip/engine.ts` swallows its own errors. A failure to record a
send must never mark a delivered email as `FAILED`. Order: claim the `DripSend`, render, send,
record the event. `SENT` bumps `lastActivityAt`; `FAILED` does not.

## Backfill

`npm run backfill:email-events` (`scripts/backfill-email-events.ts`, add `-- --dry-run` to
report only) is idempotent. It sets `DripSend.contactId` from the enrollment and synthesizes one
`SENT` event per historical send, preserving the original `sentAt`. It never fabricates opens or
clicks for mail sent before tracking existed.

## Privacy posture

- Raw IP addresses are never written, only a salted, truncated hash.
- User agents are truncated to 500 characters.
- Tracking degrades silently to "no tracking" rather than failing a send.
- See [../SECURITY.md](../SECURITY.md) for the wider PII rules.
