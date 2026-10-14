# Track Record

A learner's history (cohorts, programs, lessons, quizzes, assessments, certificates) in one shape,
served to three audiences from one query and one permission function so the surfaces cannot drift
apart.

| Surface | Route | Who |
|---|---|---|
| My track record | `/track-record` | the learner; the id always comes from the session |
| Student view | `/students/[userId]/track-record` | instructors and staff |
| Lead profile tab | `/admin/contacts/[id]` → Track record | staff working a lead |

Core: `src/lib/trackRecord.ts` (`getTrackRecord`, `findUserIdForContact`, `canViewTrackRecord`)
and `src/components/track-record/TrackRecordPanel.tsx`, which is presentational only: every
permission decision happens before it renders.

Related: [LEADS.md](./LEADS.md), [CERTIFICATES.md](./CERTIFICATES.md),
[USER_ROLES.md](./USER_ROLES.md), [../SECURITY.md](../SECURITY.md).

## Contact and User

**`Contact` is the person record; `User` is the login.** One human, two rows:

| Model | Owns |
|---|---|
| `Contact` | phone, birthday, tags, notes, attribution, and all communications consent |
| `User` | credentials, role, session, profile, enrollments |

They link through `Contact.userId`:

- The link is set automatically on **normalized email** (`src/lib/leads/linking.ts`). A link with
  `linkSource: "manual"` is never overwritten by auto-linking.
- `Contact.userId` is **not unique**. One person can hold two addresses and therefore two
  Contacts. Readers must pick deterministically: `resolvePersonContactStates` in
  `src/lib/leads/personRecord.ts` prefers the Contact whose email matches the user's, then the
  oldest row.
- **Phone and consent live only on the Contact.** `User` has no phone column. `/settings`, the
  admin user modal and the admin users list all read through the link.
- Consent is three independent fields: `phoneConsentAt` (calls), `smsMarketingConsentAt`,
  `smsTransactionalConsentAt`. A person manages all three in `/settings`; an admin can change call
  consent only.
- `smsOptOutAt` is set only by inbound STOP/START keywords on the Twilio SMS webhook, and
  `doNotCall` only from a recorded verbal request (the voice webhook). No form or admin UI writes
  either, so a form submission cannot launder an opt-out.
- The cohort roster MCP endpoint exposes a `smsable` boolean, never the number.

`Contact.userId` is an indexed column, not a Prisma `@relation`, so joins across it are explicit
two-query joins rather than `include`.

### Why a lead can show "no linked account"

The link is email-derived. A lead who signed up with a different address has no match, and the
profile says so. There is no fuzzy or name-based fallback: attaching one person's learning history
to another person's lead is worse than showing nothing. `findUserIdForContact` prefers
`Contact.userId` and falls back to an exact normalized-email lookup, so a manual link resolves even
when the addresses differ.

## Permissions

`canViewTrackRecord(viewer, viewerId, targetUserId)` allows the learner themselves, or `ADMIN`,
`TEAM_MEMBER` and `INSTRUCTOR`.

`/students/[userId]/track-record` takes its id from the URL, so the check runs **before** the
record is loaded: an unauthorized viewer is redirected and cannot infer whether the account
exists. `/track-record` never reads an id from the request.

**Known limit:** any instructor can view any learner. The role model has no per-cohort ACL to
scope against. Tightening it means a real cohort-scoped helper (for example `Enrollment`
intersected with the instructor's cohorts via `CohortInstructor`), not a partial check here.

## Data notes

- Quiz submissions are per attempt and are collapsed to one line per quiz showing the best score.
- `lessons.completed` is the full count; `lessons.recent` is capped at 10.
- Revoked certificates are listed but flagged and excluded from the headline count, so a
  revocation stays visible.
- A learner with no activity gets one empty state instead of six empty sections.
