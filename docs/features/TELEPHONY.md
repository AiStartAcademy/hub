# Telephony (Twilio Voice)

Staff place and receive phone calls in the browser through a Twilio Voice SDK softphone that
lives in the dashboard layout. Outbound calls start from a lead profile; inbound calls to the
Twilio number walk a configurable route chain (contact owner, available call team, a Vapi
assistant, an external forwarding number) and end in voicemail. Every call, in either
direction, is logged as a `ContactCall` row on the lead, with dual-channel recordings served
through a staff-only proxy.

SMS shares the same Twilio account, credentials and signature check
(`POST /api/webhooks/twilio/sms` and `/sms/status`) but is not covered here.

## Data model

| Model / field | Meaning |
|---------------|---------|
| `User.isAvailableForCalls` | Defaults to `false`. Only available CRM staff (`ADMIN` or `TEAM_MEMBER`) are rung for inbound calls. |
| `ContactCall.provider` | `twilio` for softphone calls (`vapi` and `manual` are other providers) |
| `ContactCall.providerCallId` | Twilio `CallSid` (unique); webhook upserts are idempotent on it |
| `ContactCall.direction` | `OUTBOUND` or `INBOUND` |
| `ContactCall.status` | `INITIATED`, `RINGING`, `IN_PROGRESS`, then a terminal `COMPLETED`, `NO_ANSWER`, `VOICEMAIL`, `FAILED` or `TRANSFERRED` |
| `ContactCall.phoneNumber` | E.164 snapshot of the number dialed or calling in |
| `ContactCall.authorId` / `authorLabel` | Staff who placed or answered the call |
| `ContactCall.transferredTo` / `outcome` | Number a call was handed to; `outcome: "ai_handoff"` when that was the Vapi leg |
| `ContactCall.recordingUrl` | Hub proxy path `/api/twilio/recordings/{RecordingSid}`, never a Twilio URL |
| `ContactCall.durationSec`, `startedAt`, `endedAt`, `transcript` | Timing and (voicemail) transcription |

Calls appear in the lead profile timeline with a link to the recording. Transcripts for
answered calls are produced offline ([CALL_TRANSCRIPTS.md](./CALL_TRANSCRIPTS.md)).

## The softphone

`SoftphoneProvider` wraps the dashboard (`src/app/(dashboard)/layout.tsx`) and renders a
draggable, collapsible widget (position and collapsed state kept in `localStorage`).

1. When a staff user is available, the provider lazy-loads `@twilio/voice-sdk`, calls
   `POST /api/twilio/voice-token`, creates a `Device` and registers it. When unavailable, the
   Device is destroyed (an active call is kept until it ends).
2. The token route requires staff (`assertStaff`) and mints a one-hour Twilio `AccessToken`
   with identity `closer-{userId}` and a `VoiceGrant` (`outgoingApplicationSid` =
   `TWILIO_TWIML_APP_SID`, `incomingAllow: true`). `tokenWillExpire` refetches it.
3. The widget's availability toggle calls the `setCallAvailability` server action for the
   current user. Admins can toggle anyone on `/admin/call-team`.
4. Incoming calls show the caller and the lead name (from Twilio custom parameters) with
   accept and decline. A second incoming call while busy is declined automatically.

## Outbound: calling a lead

The lead profile (`/admin/contacts/[id]`) has a **Call (browser)** button next to **Call with
AI**. It is disabled when the lead has no phone, the phone is not valid E.164, or another call
is incoming or active. Do-not-call and call consent gate only the automated AI call; the UI
states that consent rules apply to automated calls only.

1. `device.connect({ params: { contactId } })` makes Twilio request the TwiML app's voice URL,
   `POST /api/webhooks/twilio/voice`.
2. The handler verifies the signature, parses `From` as `client:closer-{userId}`, and checks
   the user still exists and has a CRM staff role, and the contact has a valid phone.
3. It upserts an `OUTBOUND` `ContactCall` (status `INITIATED`, author set) on the `CallSid`.
4. The TwiML says "This call may be recorded.", then dials the lead with `callerId` =
   `TWILIO_PHONE_NUMBER`, `answerOnBridge`, `record-from-answer-dual`, a status callback
   carrying `contactCallId`, and the recording callback.

Validation failures answer with spoken TwiML and hang up rather than an HTTP error.

## Inbound: the route chain

The Twilio number's voice webhook is `POST /api/webhooks/twilio/voice/inbound`.

1. Verify the signature; normalize `From` to E.164.
2. Find the most recently updated `Contact` with that phone, or create one named
   `Unknown caller {number}` with source `inbound-call`, a synthetic
   `inbound-call-{digits}@unknown.invalid` email and no consent of any kind.
3. Upsert an `INBOUND` `ContactCall` on the `CallSid`.
4. Build the legs (`buildLegs` in `src/lib/calls/inboundRouting.ts`) from `INBOUND_ROUTE_CHAIN`:

| Step | Leg | Skipped when |
|------|-----|--------------|
| `owner` | Rings the staff user who authored the contact's most recent call (sticky owner) | No prior author, or they are unavailable or no longer staff |
| `closers` | Rings available CRM staff (the owner excluded) per the ring strategy | Nobody is available |
| `vapi` | Dials `VAPI_INBOUND_NUMBER` | Unset or invalid |
| `forward` | Dials `INBOUND_FORWARD_NUMBER` | Unset or invalid |

5. With no legs at all, the caller goes straight to voicemail. Otherwise the first leg's TwiML
   is returned. Each `<Dial>` records dual-channel and has an `action` of
   `/api/webhooks/twilio/voice/inbound/after?contactCallId=…&legs=…&i=…`, where `legs` is the
   whole chain packed as versioned base64url JSON (at most 8 legs). Closer legs dial
   `<Client>` identities `closer-{userId}` with `contactId` and `leadName` parameters.
6. `/inbound/after` unpacks and validates the chain. `DialCallStatus` `completed` finalizes
   the call; `busy`, `no-answer`, `failed` or `canceled` dials the next leg; after the last leg
   it plays the voicemail prompt.

On finalize, a closer leg sets status `COMPLETED` and attributes the answering closer (from the
callback identity, or by fetching the child call's `to` from Twilio). A number leg sets
`TRANSFERRED`, `transferredTo`, and for Vapi `outcome: "ai_handoff"`; those calls are never
attributed to a closer. Exhausted chains set `NO_ANSWER`.

### Ring strategy

`CLOSER_RING_STRATEGY` is `simulring` (default, any other value) or `round-robin`.

- **simulring**: one leg that rings up to 10 available closers at once, 20-second timeout.
- **round-robin**: one leg per closer, at most 4, ordered by least recent call authored
  (never-called first, ties by user id), 15-second timeout each. Number legs also use 15s.

### Vapi and the forward number

The `vapi` step hands the live call to a Vapi assistant by dialing its number; what happens
next is in [VAPI_RECEPTIONIST.md](./VAPI_RECEPTIONIST.md). The `forward` step is a plain
external fallback (for example `+15555550100`). Both numbers are normalized and rejected if they
equal `TWILIO_PHONE_NUMBER`, which would re-enter this webhook and loop; rejected numbers are
logged and their step skipped.

### Voicemail

The prompt thanks the caller using the configured brand wordmark and records up to 120 seconds
with Twilio transcription. The recording callback flips a `NO_ANSWER` call to `VOICEMAIL`; the
transcription callback stores `TranscriptionText` on `ContactCall.transcript`.

## Admin: Call Team (`/admin/call-team`)

Admin only. Lists CRM staff with their call count over the last 30 days and an availability
switch per person (`setUserCallAvailability`). Above it, `RoutingChainEditor` reorders and
enables the four steps and picks the ring strategy. Saving writes `INBOUND_ROUTE_CHAIN` (JSON
array) and `CLOSER_RING_STRATEGY` as `config` keys through `PUT /api/admin/integrations`. The
editor warns when an enabled `vapi` or `forward` step has no number or a looping number.
Changes reach every instance within the 30-second secrets cache.

Closer availability for booked meetings (`/admin/closers/availability`) is a separate concept:
calendar slots for [LEAD_BOOKING.md](./LEAD_BOOKING.md), unrelated to `isAvailableForCalls`.

## Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/twilio/voice-token` | POST | Staff session | Mint the softphone access token |
| `/api/twilio/recordings/[sid]` | GET | Staff session | Stream `Recordings/{sid}.mp3` from Twilio |
| `/api/webhooks/twilio/voice` | POST | Twilio signature | TwiML app voice URL (outbound) |
| `/api/webhooks/twilio/voice/inbound` | POST | Twilio signature | Number voice webhook; starts the chain |
| `/api/webhooks/twilio/voice/inbound/after` | POST | Twilio signature | Dial action; next leg or finalize |
| `/api/webhooks/twilio/voice/status` | POST | Twilio signature | Call progress (`ringing`, `in-progress`, `completed`, `busy`, `no-answer`, `failed`, `canceled`) and `CallDuration` |
| `/api/webhooks/twilio/voice/recording` | POST | Twilio signature | Saves the proxy `recordingUrl` and duration |
| `/api/webhooks/twilio/voice/transcription` | POST | Twilio signature | Voicemail transcript |

## Configuration

All keys are Admin → Integrations managed keys (category `comms`) read with `getSecret`, with
`process.env` fallback. See [../ENVIRONMENT.md](../ENVIRONMENT.md).

| Key | Kind | Purpose |
|-----|------|---------|
| `TWILIO_ACCOUNT_SID` | config | API client, tokens, recordings (`AC…` shape checked) |
| `TWILIO_AUTH_TOKEN` | secret | API client and webhook signature verification |
| `TWILIO_PHONE_NUMBER` | config | Outbound caller id; loop check for routing numbers |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | config / secret | Sign softphone tokens (`SK…`) |
| `TWILIO_TWIML_APP_SID` | config | TwiML app in the voice grant (`AP…`) |
| `INBOUND_ROUTE_CHAIN` | config | JSON array of `owner`, `closers`, `vapi`, `forward` |
| `CLOSER_RING_STRATEGY` | config | `simulring` or `round-robin` |
| `INBOUND_FORWARD_NUMBER` | config | E.164 external fallback |
| `VAPI_INBOUND_NUMBER` | config | E.164 Vapi assistant number |

`NEXT_PUBLIC_APP_URL` (env only) builds every callback URL and the signed URL.

Twilio console setup: create an API key and a TwiML app whose voice URL is
`https://hub.example.com/api/webhooks/twilio/voice`, and point the number's voice webhook at
`https://hub.example.com/api/webhooks/twilio/voice/inbound` (both `POST`).

## Security

- Every Twilio webhook goes through `verifiedTwilioParams`
  (`src/app/api/webhooks/twilio/_shared.ts`): no auth token configured returns `500`, a missing or invalid `x-twilio-signature` returns
  `401`, a malformed or file-bearing form body `400`. `verifyTwilioWebhook` rebuilds the URL from
  `NEXT_PUBLIC_APP_URL` plus the request path and query, so it must match the public origin.
- The outbound webhook re-checks the caller identity against the database on every call; a
  token for a user who lost staff access cannot dial.
- The routing chain rides in the callback query string but is only trusted after the signature
  check, then strictly re-validated (user id pattern, E.164 targets, leg limits).
- Recordings are fetched server-side with Basic auth, require a staff session, validate the
  `RE…` SID, time out after 30 seconds and return `Cache-Control: private, no-store`.
  See [../SECURITY.md](../SECURITY.md).

## Operational notes

- Status updates never overwrite a different terminal status; out-of-order callbacks are
  ignored. Callbacks that match no call are acknowledged with empty TwiML.
- Disabling every step in the editor saves `[]`, which the parser treats as invalid and
  replaces with the default chain; voicemail is always the final fallback.
- Sticky ownership is derived from call history, not a contact field: whoever last authored a
  call on the contact is the owner.
- Unknown-caller contacts can race; the deterministic email makes the losing create fall back
  to a lookup by phone.

## Key files

| File | Role |
|------|------|
| `src/components/softphone/SoftphoneProvider.tsx` | Device lifecycle, widget, `useSoftphone` |
| `src/components/softphone/actions.ts` | Availability server actions |
| `src/app/api/twilio/voice-token/route.ts` | Access token |
| `src/app/api/twilio/recordings/[sid]/route.ts` | Recording proxy |
| `src/app/api/webhooks/twilio/_shared.ts` | Signature-verified form parsing |
| `src/app/api/webhooks/twilio/voice/_shared.ts` | TwiML helpers, voicemail, call correlation |
| `src/app/api/webhooks/twilio/voice/route.ts` | Outbound TwiML |
| `src/app/api/webhooks/twilio/voice/inbound/route.ts` | Inbound entry, leg building |
| `src/app/api/webhooks/twilio/voice/inbound/after/route.ts` | Chain advancement and outcome |
| `src/app/api/webhooks/twilio/voice/{status,recording,transcription}/route.ts` | Call callbacks |
| `src/lib/calls/inboundRouting.ts` | Chain parsing, legs, packing, TwiML per leg |
| `src/lib/calls/inboundContact.ts` | Unknown-caller contact creation |
| `src/lib/twilio/client.ts` | Client and credential resolution |
| `src/lib/twilio/verify.ts` | `verifyTwilioWebhook` |
| `src/app/(dashboard)/admin/call-team/` | Call Team page, `RoutingChainEditor.tsx` |
| `src/app/(dashboard)/admin/contacts/[id]/LeadProfileClient.tsx` | Call (browser) button |

Related: [LEADS.md](./LEADS.md), [VAPI_RECEPTIONIST.md](./VAPI_RECEPTIONIST.md),
[CALL_TRANSCRIPTS.md](./CALL_TRANSCRIPTS.md), [LEAD_BOOKING.md](./LEAD_BOOKING.md),
[INTEGRATIONS.md](./INTEGRATIONS.md), [../ENVIRONMENT.md](../ENVIRONMENT.md),
[../SECURITY.md](../SECURITY.md).
