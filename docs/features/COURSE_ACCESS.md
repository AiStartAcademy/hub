# Course access: `accessMode`, grants, and `locked`

Who can open a course (`Program`) is decided in one place, `checkProgramAccess()` in
`src/lib/programAccess.ts`. It gates the course page, the lesson viewer, the module/quiz/complete
APIs, and signed media streaming (`/api/media/[...path]`). Gating anywhere else would leave media
URLs reachable.

Related: [MEMBERS_AREA.md](./MEMBERS_AREA.md) (membership tiers),
[PAYMENTS.md](./PAYMENTS.md) (course purchases), [USER_ROLES.md](./USER_ROLES.md).

## `Program.accessMode` — the real gate

Access sources are **additive**. A real grant always counts, and `accessMode` only widens the
audience on top of it (`cohort` ⊂ `direct` ⊂ `member`), so a course can be a members product and a
cohort's curriculum at the same time.

| Mode | Who gets in |
|---|---|
| `public` | everyone, no login |
| `auth` | any signed-in user |
| `cohort` (default) | enrolled in, or grouped into, a cohort linked to the program (`Cohort.programs` or `Cohort.rawProgramId`) |
| `direct` | cohort grant, or a `ProgramAccess` row |
| `member` | cohort grant, `ProgramAccess` row, or an active membership at or above `Program.memberMinTier` (`null` = any tier) |

Any other value denies access. The truth table is the pure function `decideAccess()`, covered by
`tests/unit/programAccess.test.ts`.

**Grants:**

- Cohort enrollment (`Enrollment`) or tier membership (`GroupMember`) in a linked cohort.
- `ProgramAccess` — written by a paid course checkout (the Stripe webhook) or by staff through
  `POST /api/admin/programs/[programId]/access` `{ userId }`; removed with
  `DELETE .../access?userId=`. A full Stripe refund of a course purchase deletes the row.
- Active membership, for `member` mode only (via `src/lib/entitlements.ts`).

**`ProgramEnrollment` is not a grant.** It is the "my courses / track progress" row. Self-enroll
(`enrollInProgram` in `src/app/(dashboard)/courses/actions.ts`) is allowed only for
`SELF_ENROLL_MODES` (`public`, `auth`), so counting it as access would let anyone grant
themselves a gated course. `scripts/audit-program-access.ts` is a read-only report of users whose
only link to a gated program is such a row (run it with
`node --env-file=.env --import tsx scripts/audit-program-access.ts`).

**Consent gate.** When a signed-in user has access but has not accepted the current legal
documents, `checkProgramAccess` returns `hasAccess: false, needsConsent: true` and pages send them
to `/consent` instead of showing a buy button. Guests and `public` courses are never gated.

## Configuring a course

- `GET/PATCH /api/admin/programs/[programId]/access` (`MANAGE_ROLES`) reads and sets
  `accessMode` and `memberMinTier`; the course edit modal uses it.
- `Program.priceCents` (null = not sellable) plus `status: "open"` makes the course purchasable
  through `POST /api/programs/[id]/checkout`. For a sellable course in `cohort`, `direct` or
  `member` mode the CTA becomes "buy course" (`accessRouteFor`).
- `Program.includesWeeklyCalls` lets purchasers see weekly calls for 90 days
  (see [MEMBERS_AREA.md](./MEMBERS_AREA.md)).

## `Program.locked` — not access control

`locked` is never read by `checkProgramAccess()` or the media route. What it does:

1. `enrollInProgram` refuses self-enrollment.
2. `POST /api/programs/[id]/checkout` returns 404, so a locked course cannot be bought.
3. The course page hides the Enroll / Sign up to Access button and shows a Locked badge.

A locked course's content is exactly as reachable as its `accessMode` allows. The edit-modal
label "Locked (only enrolled students can view)" overstates this; read it as "disable
self-enrollment and sale".

## Which setting to use

| Goal | Setting |
|---|---|
| Free course anyone can watch | `accessMode: public` |
| Free, but capture the signup | `accessMode: auth` |
| Membership perk | `accessMode: member`, optional `memberMinTier` |
| Content unlocked by a cohort seat | `accessMode: cohort` (default), link the program to the cohort |
| Sold on its own | set `priceCents`, `status: open`, any gated mode |
| Hand-granted (scholarship, partner) | `accessMode: direct` + a `ProgramAccess` grant |
| No self-enrollment or sale | `locked: true` |
