# Vapi Receptionist (inbound AI voice agent)

An optional after-hours receptionist: when nobody on the call team picks up, an inbound call to
your Twilio number can fall through to a Vapi assistant that answers questions, captures callback
details, and transfers urgent callers to a human. The call result lands on the lead's timeline.

The assistant itself (model, voice, prompt, tools, structured outputs) is configured in the Vapi
dashboard. The hub only routes calls to it and ingests the results. Outbound AI calls from drip
CALL steps use the same webhook: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md).

Related: [LEADS.md](./LEADS.md) · [CALL_TRANSCRIPTS.md](./CALL_TRANSCRIPTS.md) ·
[INTEGRATIONS.md](./INTEGRATIONS.md) · [../SECURITY.md](../SECURITY.md)

## How a call reaches the assistant

1. Twilio posts the inbound call to `POST /api/webhooks/twilio/voice/inbound`
   (`src/app/api/webhooks/twilio/voice/inbound/route.ts`), which upserts an INBOUND
   `ContactCall` (provider `twilio`) on the CallSid.
2. It builds dial legs from `INBOUND_ROUTE_CHAIN` (`src/lib/calls/inboundRouting.ts`). Steps:
   `owner` (the staff member who last handled a call with this contact, if they are staff and
   available for calls), `closers` (available closers from
   `/admin/call-team`, rung per `CLOSER_RING_STRATEGY`: `simulring` or `round-robin`), `vapi`
   (dial `VAPI_INBOUND_NUMBER`), `forward` (dial `INBOUND_FORWARD_NUMBER`).
3. Each unanswered leg returns to `/api/webhooks/twilio/voice/inbound/after`, which dials the
   next leg; when legs run out, the caller gets voicemail.
4. When the Vapi leg answers, Vapi sends its own webhooks to the hub (below). For an unknown
   Vapi call id on an `inboundPhoneCall`, the hub finds or creates the contact by caller number
   (`src/lib/calls/inboundContact.ts`, source `inbound-call`, no consent granted) and upserts an
   INBOUND `ContactCall` with provider `vapi`.

### Routing rules

- `INBOUND_ROUTE_CHAIN` is a JSON array of `owner`, `closers`, `vapi`, `forward`, e.g.
  `["owner","closers","vapi","forward"]`. Missing or invalid JSON falls back to that default
  order. On save, Admin → Integrations rejects non-arrays, empty arrays, unknown steps and
  duplicates.
- A `vapi` or `forward` step with no number configured is skipped.
- **Loop rule:** `VAPI_INBOUND_NUMBER` and `INBOUND_FORWARD_NUMBER` must be valid E.164 and must
  never equal `TWILIO_PHONE_NUMBER`. Dialing your own Twilio number re-enters this webhook and
  loops. `validateRoutingNumbers()` enforces this both on save and per call; at call time an
  invalid number is logged and dropped from the chain.
- The same rule applies inside Vapi: the assistant's transfer target must be a human's number,
  never the Twilio number.

## Hub configuration

All keys resolve through `getSecret()` (Admin → Integrations at `/admin/integrations`, category
comms, with env fallback). Known keys: `src/app/(dashboard)/admin/integrations/knownKeys.ts`.

| Key | Purpose |
|---|---|
| `VAPI_WEBHOOK_SECRET` | Shared secret Vapi must send in the `x-vapi-secret` header |
| `VAPI_INBOUND_NUMBER` | E.164 of the Vapi phone number attached to the receptionist assistant |
| `INBOUND_FORWARD_NUMBER` | E.164 human fallback / transfer destination |
| `INBOUND_ROUTE_CHAIN` | Ordered routing steps (above) |
| `CLOSER_RING_STRATEGY` | `simulring` (default) or `round-robin` |
| `TWILIO_PHONE_NUMBER` | Your Twilio number; used for the loop check |
| `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_DEFAULT_ASSISTANT_ID` | Outbound calls only (`src/lib/vapi/client.ts`); not needed for inbound |

Twilio voice setup (account, TwiML app, number webhook) is covered in
[INTEGRATIONS.md](./INTEGRATIONS.md) and [../ENVIRONMENT.md](../ENVIRONMENT.md).

## Webhook: `POST /api/webhooks/vapi`

`src/app/api/webhooks/vapi/route.ts`, `force-dynamic`.

- **Auth:** Vapi's server URL secret is sent verbatim in `x-vapi-secret` and compared timing-safe
  against `VAPI_WEBHOOK_SECRET`. Secret not configured → `500`; missing or wrong header → `401`,
  nothing stored. Invalid JSON → `400`.
- **Correlation:** by `message.call.id` (`ContactCall.providerCallId`), then by
  `call.metadata.hubDripSendId` for outbound drip calls, then the inbound path above. Messages
  that cannot be correlated get `200` with a `skipped` reason, because Vapi retries non-2xx.
- **`status-update`:** `ringing` / `in-progress` move the row to RINGING / IN_PROGRESS, never
  regressing a finalized row.
- **`end-of-call-report`:** sets status from `endedReason` (`statusFromEndedReason`: TRANSFERRED,
  VOICEMAIL, NO_ANSWER, FAILED or COMPLETED), transcript, recording URL, summary, duration,
  start/end times, and `analysis` (the structured data as JSON). Bumps
  `Contact.lastActivityAt`.
- Other message types are acknowledged and ignored.

### Structured data the hub reads

`extractStructuredData()` (`src/lib/vapi/structuredData.ts`) accepts both Vapi sources and
flattens them into one record: the legacy `analysis.structuredData` (analysis plan) and the
dashboard's Structured Outputs (`artifact.structuredOutputs`, keyed by output id with
`{name, result}` values; object results are merged, scalar results stored under `name`). On a key
conflict the analysis-plan value wins.

| Field | Effect in the hub |
|---|---|
| `outcome` (string) | Stored as `ContactCall.outcome` |
| `transferred_to` (string) | Stored as `ContactCall.transferredTo` |
| `requested_dnc` (boolean) | `true` sets `Contact.doNotCall`, which blocks automated calls |

Every other field is kept in `ContactCall.analysis` and shown on the lead timeline. A suggested
schema:

```json
{
  "type": "object",
  "properties": {
    "outcome": {"type": "string", "enum": ["lead_captured","question_only","existing_student","transferred","wrong_number","spam","no_answer"]},
    "qualified": {"type": "boolean"},
    "notes": {"type": "string"},
    "caller_name": {"type": "string"},
    "callback_number": {"type": "string"},
    "email": {"type": "string"},
    "interest": {"type": "string"},
    "best_time_to_call": {"type": "string"},
    "callback_requested": {"type": "boolean"},
    "urgent": {"type": "boolean"},
    "transferred_to": {"type": "string"},
    "requested_dnc": {"type": "boolean"}
  },
  "required": ["outcome","qualified","notes","requested_dnc"]
}
```

## Vapi dashboard setup

| Setting | Value |
|---|---|
| Server URL | `https://hub.example.com/api/webhooks/vapi` |
| Server URL secret header | `x-vapi-secret` = your `VAPI_WEBHOOK_SECRET` |
| Phone number | The number you set as `VAPI_INBOUND_NUMBER`, attached to this assistant |
| Tools | `endCall`; `transferCall` to `{{handoff_number}}` (your `INBOUND_FORWARD_NUMBER`), never `TWILIO_PHONE_NUMBER` |
| First message mode | Assistant speaks first |
| Analysis | Summary prompt plus Structured Outputs using the field names above |

Model, voice, transcriber and duration limits are your choice.

## Prompt template

Keep facts that change (prices, dates, seat counts, outcomes) out of the prompt: the hub is the
source of truth, so the assistant offers a callback instead. Replace the placeholders:

```
# Identity
You are the after-hours voice assistant for {{academy_name}}. The team is unavailable right
now. You are an AI and say so if asked. Speak in short, warm sentences, one question at a time.

# Goals, in order
1. Make the caller feel heard and say what happens next.
2. Capture full name, callback number (confirm the calling number), email, interest, and the
   best time to call.
3. Answer general questions only from the facts below.
4. Transfer to a human only if the caller asks for a person or the matter is urgent.
5. Read the details back once, then end the call with endCall.

# Facts (only these)
- Programs: {{programs_summary}}
- Office hours: {{hours}}
- Booking a call: {{booking_url}}

# Never
- State prices, discounts, start dates, seat availability, or job or income outcomes. Say the
  current details are on the website and someone will call back.
- Invent programs, people, policies, or student stories.
- Ask for card numbers, passwords, or ID numbers.
- Keep calling someone who asks not to be called; note it and set requested_dnc.

# Transfers
Use transferCall to {{handoff_number}} only for an explicit request or an urgent matter. If the
transfer fails, apologize once and take callback details.
```

## Verification checklist

1. In the Vapi dashboard test console, ask a price: the assistant declines and offers a callback.
2. Ask for a person: it announces the transfer and calls `transferCall`.
3. Call your Twilio number with every closer unavailable in `/admin/call-team`: the assistant
   answers, and an INBOUND `ContactCall` (provider `vapi`) with transcript, summary and analysis
   appears on the lead in `/admin/contacts`.
4. Say "don't call me again": the contact's `doNotCall` becomes true.
5. Send the webhook without `x-vapi-secret`: the hub answers `401`.

Unit coverage: `tests/unit/inbound-routing.test.ts`, `tests/unit/vapi-inbound.test.ts`,
`tests/unit/vapi-structured-data.test.ts` (`bun test tests/unit`).
