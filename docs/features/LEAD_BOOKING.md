# Lead 1:1 Booking

Staff ("closers") publish availability, drip messages can include a contact-specific booking
link, and leads book or cancel a Zoom 1:1 without signing in.

## Flow

1. An `ADMIN` or `TEAM_MEMBER` creates one-off or weekly-repeating availability at
   `/admin/closers/availability`. An admin can manage slots for another CRM staff user.
2. A drip email or SMS renders the `{{booking_url}}` merge field for the configured default
   closer: `/book/{bookingToken}?c={contactPublicToken}` (`bookingUrlForContact` in
   `src/lib/booking/bookingUrl.ts`). Both tokens are long-lived and minted lazily. The contact
   token only prefills the lead's name and email; it grants no other access.
3. The public page `/book/[token]` lists that closer's future open slots.
4. The lead submits `POST /api/public/booking/[token]`. The route validates the closer token,
   confirms the slot belongs to that closer, rate-limits per token and IP (10 per hour,
   in-process), and sanitizes the contact fields.
5. `createLeadBooking` reserves the slot and upserts the `Contact` in a transaction, then
   creates a Zoom meeting. If Zoom creation fails, the reservation is removed and the request
   fails. Google Calendar sync, the lead confirmation email and the closer notification are
   best-effort.
6. Staff see bookings on the lead profile (all upcoming, the three most recent past) and in
   the lead timeline, including the Zoom join URL when one was created.

## Data model

- `CloserSlot`: an availability window owned by a `User` (`closerId`). `startAt` / `endAt` are
  UTC instants; `timezone` is the IANA zone used for display. At most one `LeadBooking` per
  slot (unique `LeadBooking.slotId`).
- `LeadBooking`: links a slot to a `Contact`. `status` is `CONFIRMED` or `CANCELLED`. Stores
  `zoomMeetingId`, `zoomJoinUrl`, `gcalEventId`, `gcalSyncError`, an optional `notes`, and a
  unique `cancelToken`. Cancelled rows are kept for history.
- `User.bookingToken` identifies a closer's public page; `Contact.publicToken` identifies the
  optional prefill. Both are unique and populated only when a link is needed.

## Single Zoom host means a global time mutex

All lead meetings are created under one Zoom host (`ZOOM_HOST_EMAIL`). Confirmed bookings are
therefore a **global** time mutex, not a per-closer one: two closers cannot hold overlapping
confirmed 1:1s while they share that host. Slot listing hides any window overlapping any
confirmed booking, and booking creation repeats the overlap check inside the reservation
transaction.

Staff may publish overlapping availability for different closers; once one window is booked,
every overlapping window becomes unavailable. Simultaneous meetings would need per-closer host
assignment and matching Zoom capacity, not just a change to the overlap filter.

## Configuration

Resolved through `getSecret()` (`src/lib/secrets.ts`), so a value saved in Admin → Integrations
(`/admin/integrations`) wins over the environment:

| Key | Purpose | When unset |
|-----|---------|------------|
| `BOOKING_DEFAULT_CLOSER_ID` | `User.id` whose page `{{booking_url}}` links to | Merge field renders empty; no tokens are minted |
| `ZOOM_HOST_EMAIL` | Zoom user id or email for the meeting API | Zoom's `me` alias |

Environment only:

- `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`: Zoom server-to-server OAuth.
- `NEXT_PUBLIC_APP_URL`: public origin for booking and cancellation links (falls back to
  `http://localhost:3000`).

See [../ENVIRONMENT.md](../ENVIRONMENT.md).

## Google Calendar

Calendar sync uses an organizer mailbox's OAuth refresh token, not a bare service account.
`src/lib/googleCalendar.ts` reads these at module load, so restart after changing them:

- `GOOGLE_CALENDAR_ID`: destination calendar.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`: OAuth client.
- `GOOGLE_OAUTH_REFRESH_TOKEN`: refresh token for the organizer mailbox with Calendar scope.
- `GOOGLE_CALENDAR_ORGANIZER_EMAIL`: optional extra organizer attendee.

The event carries the slot timezone and UTC times, the Zoom URL, and the lead and closer as
attendees. Missing configuration skips sync. API failures are stored in
`LeadBooking.gcalSyncError`; the booking stays confirmed so staff can repair the calendar side.

## Cancellation

The lead's confirmation email links to `/book/cancel/{cancelToken}`, a confirmation page whose
form calls `cancelLeadBooking`. The token is the only authorization for this public action;
treat it as a secret bearer link.

Cancellation is idempotent. The first cancel sets `CANCELLED`, deletes the Zoom meeting when
an id exists, removes the calendar event when configured, and emails the closer. Repeat
requests return the cancelled state without repeating side effects. Integration failures are
logged and persisted on the booking; the database state is authoritative.

## Key files

| File | Role |
|------|------|
| `src/app/(dashboard)/admin/closers/availability/` | Availability admin (page, forms, actions) |
| `src/app/book/[token]/page.tsx`, `BookingClient.tsx` | Public booking page |
| `src/app/book/cancel/[cancelToken]/page.tsx` | Public cancellation page |
| `src/app/api/public/booking/[token]/route.ts` | Booking API |
| `src/lib/booking/leadBooking.ts` | Slot listing, booking, cancellation, token minting, emails |
| `src/lib/booking/bookingUrl.ts` | `{{booking_url}}` generation |
| `src/lib/zoom.ts`, `src/lib/googleCalendar.ts` | Zoom and Calendar clients |

Related: [LEADS.md](./LEADS.md), [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md).
