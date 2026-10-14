# Certificates

Verifiable completion certificates for cohort graduates: rendered from an HTML template to PDF and
PNG, stored in Google Cloud Storage, publicly verifiable at `/verify`, and announced to the
graduate through a drip campaign.

Issuing and notifying are **two separate admin steps**. Generating renders files and creates rows;
nobody is emailed. Notifying is an explicit, dry-run-first action, so a bad render can be caught
before it reaches a cohort's inboxes.

Related: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md), [TRACK_RECORD.md](./TRACK_RECORD.md),
[../ENVIRONMENT.md](../ENVIRONMENT.md).

## Data model

| Model | Fields |
|---|---|
| `CertificateTemplate` | `name`, `layout` (the template's HTML filename in GCS), optional `backgroundUrl` |
| `Certificate` | `id` (`XXXX-XXXX-XXXX`), `userId`, `cohortId`, `templateId`, `pdfUrl`/`pngUrl` (storage proxy keys, not signed URLs), `issuedAt`, `isRevoked`, `notifiedAt` |

`@@unique([userId, cohortId])` makes issuance idempotent: one certificate per person per cohort,
so re-running a batch is safe. `Cohort.certificate` only drives the badge on public listings; the
generate route does not check it.

`notifiedAt` means the holder was **queued** for notification, not that mail was delivered.
Delivery status lives in `DripSend` like any other drip send.

## Templates

`POST /api/admin/certificate-templates` (multipart `file` + `name`, `.html` only, `MANAGE_ROLES`)
uploads the file to `certificate-templates/<timestamp>_<name>.html` in the bucket and records it.
`GET` lists templates; `DELETE /api/admin/certificate-templates/[id]` removes one.

Placeholders substituted at render time:

- Per certificate: `{{STUDENT_NAME}}` (name, else email), `{{COHORT_NAME}}`, `{{DATE}}` (cohort
  date range, else today), `{{CERT_ID}}`.
- Brand, from `src/config/brand.ts` (`src/lib/certificateBrandPlaceholders.ts`, HTML-escaped):
  `{{ACADEMY_NAME}}`, `{{SIGNER_NAME}}`, `{{SIGNER_TITLE}}`, `{{SITE_URL}}`, `{{SITE_DOMAIN}}`,
  `{{HUB_URL}}`.

## Generating

`POST /api/admin/certificates/generate` `{ userId, cohortId, templateId }` — one certificate per
call, `MANAGE_ROLES` only. Downloads the template, fills placeholders, renders with Puppeteer
(`src/lib/pdfGenerator.ts`, 1200×1553 at 2x; Chromium from `PUPPETEER_EXECUTABLE_PATH`), uploads
`cohorts/<cohort-title-slug>/certificates/<certId>.{pdf,png}`, and creates the row. An existing
row short-circuits with `{ skipped: true }`.

The cohort Manage view fans this out from the browser, two requests at a time, with a progress bar
and per-student log. There is no server-side batch endpoint.

`DELETE /api/cohorts/[id]/certificates/[certId]` (`MANAGE_ROLES`) hard-deletes the files and the
row.

## Reading them back

| Surface | Route | Auth |
|---|---|---|
| Public verification | `/verify?id=…` → `GET /api/certificates/verify?id=` | none |
| Stable file link | `GET /api/certificates/[id]/download?format=pdf\|png` → 302 to a fresh signed URL | none |
| Graduate's own list | Settings → My Certificates → `GET /api/me/certificates` | signed in |
| Cohort list | `GET /api/cohorts/[id]/certificates` | signed in; managers see all |

Signed storage URLs expire after one hour, so emails must never embed one. The download route is
permanent and signs on each request. Ids are matched case-insensitively (upper-cased).

Both public routes expose a certificate by id alone, including the holder's name and files. That
is the intended verification model; widen the returned fields or shorten the id space only
deliberately. Revoked certificates verify as invalid and do not download.

## Notifying — the `certificate-issued` campaign

Notification is a drip campaign (trigger `CERTIFICATE_ISSUED`), not a bespoke mailer, so it
inherits `DripSend` idempotency, open/click tracking, UTM tagging, consent gating, and
admin-editable copy.

1. Admin clicks **Notify students** in the cohort Manage view (dry run first: counts only,
   nothing written) → `POST /api/admin/cohorts/[id]/certificates/notify` `{ dryRun?, certificateIds? }`.
2. `enrollCertificateNotifications()` (`src/lib/drip/certificateNotify.ts`) ensures a `Contact`
   for each holder, creates a cohort-scoped `DripEnrollment`, and stamps `notifiedAt`.
3. The ordinary drip tick delivers: email immediately, SMS 24 hours later.

The result counts `queued`, `alreadyNotified`, `revoked`, `noEmail`, `unsubscribed` (queued people
who opted out of course email), and sets `campaignMissing` when no `ACTIVE` `CERTIFICATE_ISSUED`
campaign exists. Re-running only reaches people not yet notified.

Agents reach the same operation through `POST /api/internal/mcp/v1/cohorts/[id]/certificates/notify`
(the `certificate_notify` tool of the companion MCP server); see [../MCP_API.md](../MCP_API.md).

### Merge fields

Besides the standard and cohort fields (`{{cohort_name}}`, dates), certificate steps resolve:

| Token | Value |
|---|---|
| `{{certificate_id}}` | the certificate id |
| `{{certificate_url}}` | `https://hub.example.com/verify?id=…` (also usable in SMS) |
| `{{certificate_pdf_url}}`, `{{certificate_png_url}}` | the stable download route |
| `{{linkedin_add_url}}` | prefilled LinkedIn "add certification" link |

## Gotchas

- **Certificate notices are service messages.** Their SMS step is gated on transactional SMS
  consent, not marketing consent. A holder who opted out of course email is still enrolled: the
  email step is skipped and the SMS step sends if they consented. Settings → My Certificates is
  the guaranteed surface.
- **Nothing sends without an ACTIVE campaign.** The seeded campaign (`npm run seed:drip`) ships as
  `DRAFT`. Activate it in `/admin/contacts/campaigns` before the first notify.
- **Revocation has no writer.** `isRevoked` is honored by verify, download, the track record and
  the notify flow, but no route sets it. Deleting is the only tool offered.
- **Ids can contain stray hyphens.** `generateCertificateId()` includes `-` in its character pool
  and uses `Math.random()` with no collision retry (a collision surfaces as a unique-constraint
  error on create).
- Storage paths use a slug of the cohort title, so renaming a cohort splits its files across two
  folders.
