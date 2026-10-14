# Chat (Rocket.Chat)

All messaging inside the hub runs on a self-hosted **Rocket.Chat** (RC) workspace. The hub
embeds it in an iframe and signs users in with RC tokens. The hub has no message or post model
of its own; cohort discussion and announcements live in RC.

## Surfaces

| Surface | Route | RC group | Gate |
|---------|-------|----------|------|
| Chat home | `/chat` | RC's own channel list (`path="/home"`) | any signed-in user |
| Cohort panel | `/cohorts/[id]` (card in the workspace view) | `cohort-<slug>` | enrolled, or staff |
| Cohort full page | `/cohorts/[id]/chat` | same | enrolled, or staff |
| Members lounge | `/members/community` | `members-lounge` | `community` entitlement |
| Pod | `/members/pod` | `pod-<slug>` | `pod` entitlement |

`/chat` deliberately has no entitlement gate. RC only lists groups a user was invited to, so
the list scopes itself. Entitlements are covered in [MEMBERS_AREA.md](./MEMBERS_AREA.md).

## API

| Route | Auth | Returns |
|-------|------|---------|
| `GET /api/cohorts/[id]/chat` | session; enrolled (group seat or `Enrollment` row) or `MANAGE_ROLES` | `{ authToken, channelName, chatUrl }`. Provisions the RC user and group on first use. 403 if not enrolled. |
| `GET /api/members/chat` | session + `community` entitlement | lounge iframe token |
| `GET /api/chat/unread` | session | `{ unread: number }`. Never throws; returns 0 when signed out or not provisioned. |

The sidebar polls `/api/chat/unread` every 60 seconds.

## Modules

- `src/lib/rocketchat.ts`, `RocketChatService` (admin REST wrapper):
  - `syncUser(name, email, role)`: find-or-create. It never overwrites an existing account's
    password.
  - `syncGroup(name, memberIds)` / `syncCohortGroup(title, memberIds)`: create a private group,
    or invite the members who are missing.
  - `createIframeToken(email)`, `getGroupNameById(roomId)`, `getUnreadCount(email, rcUserId)`.
- `src/lib/chat/cohortChatAccess.ts`: pure functions `canAccessCohortChat`,
  `cohortChannelName`, `slugifyCohortChannel`. Every cohort chat surface must use these, so the
  API route and the page agree on who may see a chat.
- `src/lib/chat/provisionUser.ts`: `provisionChatUser` (idempotent; stores the RC ID in
  `User.rocketchatId`) and `provisionStaffChatIds`.
- `src/lib/chat/embedUrl.ts`: pure functions `isTrustedChatOrigin` (strict origin equality)
  and `buildChatEmbedUrl`.
- `src/lib/memberChat.ts`: lounge and pod provisioning (`provisionMemberChat`,
  `provisionPodChannel`, `podGroupName`, `MEMBERS_LOUNGE_GROUP`).
- `src/components/chat/RocketChatEmbed.tsx`: the iframe. It renders at `w-full h-full` with no
  height of its own, so the parent must give it a resolved height or it collapses to zero.
- `src/components/chat/ChatSignInNotice.tsx`: shown when RC isn't configured or the user has to
  log in to RC by hand.

## Data model

- `User.rocketchatId`, `User.rocketchatUsername` (both unique).
- `Cohort.rocketchatGroupId`, `Cohort.rocketchatChannelName`.
- `Pod.rocketchatGroupId`.

## Channel naming: the rename trap

A cohort's group name comes from its title **once**, and is then stored in
`Cohort.rocketchatChannelName`. Never derive it again from the current title: after a cohort is
renamed, that points chat at a new, empty group and orphans the history. For cohorts created
before the field existed, the API looks the real name up with
`getGroupNameById(rocketchatGroupId)` and backfills the field on first access.

`slugifyCohortChannel` must stay byte-identical to the rule inside
`RocketChatService.syncCohortGroup`: lowercase, and every character outside `[a-z0-9]` becomes
a dash. If the two drift, existing groups stop resolving.

Staff (`MANAGE_ROLES`) are invited into a cohort group only when the group is first created.
Inviting them again on every page view would cost one RC call per staff member per request.

## Accounts and sign-in

- The hub creates "shadow" RC accounts with a deterministic password: an HMAC-SHA256 of the
  lowercased email, keyed by `RC_PASSWORD_SECRET`. `createIframeToken` logs in with that
  password and returns the RC auth token.
- When `createIframeToken` returns `null`, that is **not** an error. It means the person has
  set their own RC password. The UI should fall back to a manual RC login instead of showing a
  failure.
- Cohort students are created with the RC `guest` role. Staff and paying members (lounge and
  pods) get `user`. Your RC workspace settings can limit how many channels a guest may join.

## Environment

| Variable | Purpose |
|----------|---------|
| `RC_URL` | Base URL of the RC workspace, for example `https://chat.example.com` |
| `RC_ADMIN_USER_ID` | RC admin (bot) user ID for REST calls (`X-User-Id`) |
| `RC_ADMIN_AUTH_TOKEN` | Personal access token for that admin (`X-Auth-Token`) |
| `RC_PASSWORD_SECRET` | HMAC key for shadow-account passwords. Do not rotate it once accounts exist, or seamless sign-in breaks for everyone. |

These four are read from `process.env` only, not through the Integrations registry. The
service class captures them when the module loads, so changing one requires a restart. With
`RC_URL` unset, `/chat` shows a notice instead of the embed. See
[../ENVIRONMENT.md](../ENVIRONMENT.md).

## Known limitations

- The resume token travels in the iframe URL (`?resumeToken=`). That is RC's own iframe-SSO
  contract, but it means the token lands in browser history and referrer headers. See
  [../SECURITY.md](../SECURITY.md).
- `syncGroup` reads existing members with a hard `count=100`. In larger groups it re-invites
  people who are already members (harmless, but wasted calls).

## Tests

`bun test tests/unit` runs `tests/unit/cohortChatAccess.test.ts` and
`tests/unit/chatEmbedUrl.test.ts`.
