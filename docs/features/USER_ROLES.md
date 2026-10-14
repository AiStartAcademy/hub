# User roles

A user can hold several roles at once. Examples: an admin who also teaches, or a student who
signed a venue agreement and is now also an event organizer. Every permission check goes
through `src/lib/roles.ts`. Code should never compare `user.role` directly.

## Roles

`ROLE_VALUES` in `src/lib/roles.ts`:

| Role | Meaning |
|------|---------|
| `STUDENT` | Default for new accounts (the column default on `User.role`) |
| `EVENT_ORGANIZER` | Venue customer. Granted automatically when a venue agreement is signed (`src/app/api/agreements/[token]/sign/route.ts`, via `addRole`). |
| `TEAM_MEMBER` | Staff |
| `INSTRUCTOR` | Teaches cohorts; listed on `/instructors` when the profile is public (see [HUMANS.md](./HUMANS.md)) |
| `ADMIN` | Full access |

Role groups:

```ts
ADMIN_ROLES  = ["ADMIN"]
MANAGE_ROLES = ["TEAM_MEMBER", "INSTRUCTOR", "ADMIN"]   // staff / manager tier
STAFF_ROLES  = MANAGE_ROLES                             // alias
```

Some route files define their own local `ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"]`. Examples:
the content CMS and agent routes under `src/app/api/admin/{content,agents}` and
`src/app/api/agents`. That local constant is not the exported `ADMIN_ROLES`, so read the
import before assuming a gate is ADMIN-only.

## Data model

- `User.role` (`String`, default `"STUDENT"`): the legacy primary role, used for display and
  sorting.
- `User.roles` (`String`, default `"[]"`): a JSON array of role values, for example
  `["ADMIN","INSTRUCTOR"]`. Once populated, this is the source of truth.

When `roles` is empty, missing, or not valid JSON, `getRoles()` falls back to `[role]`. An
unreadable value never widens to "all roles". Writers keep the two columns in sync:
`role = roles[0]`.

## Helpers

`src/lib/roles.ts` (safe in both server and client code):

```ts
getRoles(source): string[]          // source: legacy role string | string[] | { role, roles } (user row or session.user)
hasRole(source, role): boolean
hasAnyRole(source, allowed): boolean
primaryRole(source): string         // roles[0] ?? "STUDENT"; for display only, never for gating
isValidRole(value): boolean
serializeRoles(roles): string       // JSON.stringify for writes
```

`src/lib/roles.server.ts` (server-only):
`addRole(userId, role)` appends a role without duplicating it and rewrites both columns.

Pass `session?.user` (or the user row) to these helpers rather than a bare `.role` string. A
bare string throws away the extra roles.

Related gates in `src/lib/auth.ts`: `canViewUserData(session)` and `canEditUserData(session)`.
Both are ADMIN-only today and control access to other users' profile data.

## Where roles are checked

- **Admin pages:** each `src/app/(dashboard)/admin/**/page.tsx` checks the role in its server
  component and redirects to `/dashboard`. Most admit `MANAGE_ROLES` or ADMIN + TEAM_MEMBER.
  Sensitive pages are ADMIN-only, for example `/admin/integrations`, `/admin/billing`, and
  `/admin/onboarding`.
- **API routes:** every session route calls `hasRole`/`hasAnyRole` on `(await auth())?.user`.
  Machine routes use bearer tokens instead (see [../SECURITY.md](../SECURITY.md)).
- **Navigation:** `src/components/Sidebar.tsx` hides sections by role. Hiding a link is
  cosmetic; the page and API checks are what enforce access.
- **Audience resolution:** `src/lib/audience.ts` maps `MANAGE_ROLES` to the `manager` audience
  (see [VIEWS.md](./VIEWS.md)).
- **Chat:** staff (`MANAGE_ROLES`) are invited into every cohort chat group (see
  [CHAT.md](./CHAT.md)).

## Session and JWT

Auth.js uses the JWT session strategy (`src/lib/auth.ts`). The `jwt` and `session` callbacks
carry both `role` and `roles: string[]`. `src/types/next-auth.d.ts` declares `roles` on
`Session.user`, `User`, and `JWT`.

Gotcha: roles are copied into the token at sign-in. The `trigger === "update"` path re-reads
them from the database, but nothing in the UI calls `update()`. A user who is granted a role
has to sign out and back in (or wait for the token to refresh) before the new role applies.

## Admin UI and API

`/admin/users` shows each role as its own toggle. A toggle calls
`PATCH /api/admin/users/[userId]/role` with `{ roles: string[] }`. The legacy `{ role }` body
is still accepted. The endpoint:

- requires the caller to hold ADMIN (otherwise 401)
- rejects an empty list (400)
- rejects unknown role values (400)
- writes `roles` and `role = roles[0]` together

`POST /api/admin/users/invite` creates an invited user with one role and emails a setup link.

## Backfill

The schema change is additive (`npm run db:push`). Because `getRoles()`
falls back to `role`, nothing breaks while `roles` is still empty. To populate `roles` anyway,
run this idempotent script:

```bash
node --env-file=.env --import tsx scripts/backfill-user-roles.ts
```

## Tests

`bun test tests/unit` runs `tests/unit/roles.test.ts` (multi-role membership, empty and
malformed `roles` falling back, `primaryRole`, `isValidRole`) and
`tests/unit/roles.server.test.ts` (`addRole`).
