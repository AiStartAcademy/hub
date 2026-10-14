# Views: one object, many audiences

Views are a convention for showing the same domain object differently depending on who is
looking and why, instead of one large page that branches on role internally.

## What a view is

A **view** is a self-contained rendering of one domain object for one audience and one goal.
The views that exist today:

| Object | View | Audience | Goal |
|--------|------|----------|------|
| Cohort | `cohorts/[id]/views/PublicView.tsx` | guest, or a student not enrolled in this cohort | convert (go to checkout) |
| Cohort | `cohorts/[id]/views/ManageView.tsx` | enrolled member, or staff | learn, deliver, administer |
| Human profile | `humans/[slug]/views/PublicProfileView.tsx` | anyone who can reach the profile | credibility, discovery |
| Human profile | `humans/[slug]/views/MentorView.tsx` | anyone, on a mentor's profile | book a 1:1 (gated; see [HUMANS.md](./HUMANS.md)) |

The cohort list follows the same idea with `cohorts/CohortsPublic.tsx` and
`cohorts/CohortsManage.tsx`. See [COHORTS_PUBLIC.md](./COHORTS_PUBLIC.md). All paths are
under `src/app/(dashboard)/`.

## The three parts

1. **Server selector.** The route's `page.tsx` is a thin server component. It fetches the
   object (by slug or ID), resolves the audience, renders the matching view, and exports
   `generateMetadata` for public views. There is no `"use client"` at this layer.
2. **Audience resolver** (`src/lib/audience.ts`). It defines a shared vocabulary,
   `Audience = "guest" | "student" | "member" | "manager"`, plus a small resolver per object,
   because "enrolled" means something different for each one.
   - `resolveCohortAudience(session, { enrolled })` returns:
     - `manager` for any `MANAGE_ROLES` holder
     - `member` if the viewer is enrolled in this cohort
     - `student` if signed in but not enrolled
     - `guest` if signed out
   - `isWorkspaceAudience(a)` is true for `manager` and `member`.
3. **Views**, kept next to the route under `views/`. Views only present data. They do no
   fetching and make no auth decisions; the server page owns those, and the API routes and
   webhooks remain the source of truth for state.

## The selector

```tsx
// <object>/[id]/page.tsx (server component)
export async function generateMetadata({ params }) { /* public SEO for the object */ }

export default async function Page({ params }) {
  const object = await fetchBySlugOrId((await params).id);
  if (!object) notFound();
  const audience = resolveCohortAudience(await auth(), { enrolled });
  if (isWorkspaceAudience(audience)) return <ManageView />;
  return <PublicView object={object} />; // plus JSON-LD; indexable
}
```

Use an explicit branch, not a registry. Add a registry only if the mapping grows large enough
to need one.

## Profiles don't use an audience resolver

`src/lib/audience.ts` deliberately has no `resolveProfileAudience`. Which profile view renders
depends on `isMentor`, which is a fact about the profile, not the viewer. Whether a `PRIVATE`
profile can be reached at all depends on `canViewUserData` (ADMIN-only) or ownership. A
resolver that returned `manager` for all of `MANAGE_ROLES` would be wider than that gate. If
someone later wired reachability to it, every private profile would be exposed to all staff.
If you add a profile resolver, make its privileged tier match `canViewUserData`.

## Adding a view

1. Create `views/<Audience>View.tsx`, presentation only.
2. Add or extend the object's resolver in `src/lib/audience.ts`.
3. Add the branch in the route's server `page.tsx`.
4. If the view is public, cover it in `generateMetadata`, JSON-LD, and `src/app/sitemap.ts`.
   The sitemap already lists public cohorts and `PUBLIC` human profiles.

## Why

- **Safety.** A public view can only show what the server page passes to it. Guests never land
  in the role-branching workspace.
- **Readability.** "What does a guest see?" is answered by one file.
- **Reuse.** Audience resolution and the public SEO wrapper are shared, so a new goal means a
  new view, not new routing.

Shared helpers: `src/lib/audience.ts` and `src/lib/sanitize.ts`. The architecture is described
in [../ARCHITECTURE.md](../ARCHITECTURE.md).
