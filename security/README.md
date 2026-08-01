# RBAC Framework — Design Decisions

This is the index; each module's own header comment has the full rationale.
Read this first, then the file itself for the section it summarizes.

## Architecture inspected before writing any code

- **Auth**: none exists. Per `CLAUDE.md`, authentication/RLS is explicitly
  out of scope for this exercise. The app currently mocks "who's acting"
  with a client-side cookie pair (`lib/persona.ts`) read by a handful of
  pages. This RBAC framework replaces *what that cookie means* (a role
  derived from a real worker) without touching the cookie mechanism itself
  or any unrelated business logic (`lib/bp-engine.ts`, `lib/payroll.ts`,
  `lib/planning.ts` are untouched except where explicitly noted below).
- **Routing**: Next.js 14 App Router, no `middleware.ts`. Guards are
  applied per-page (Server Components calling `guardRoute()`) rather than
  centrally in middleware, because several routes need *data-scoped*
  guards (e.g. "can this worker view this specific other worker") that a
  path-only middleware can't express — see `routeGuard.ts`.
- **Supabase**: does not exist yet. `CLAUDE.md`'s own migration doc
  (`prisma/POSTGRES_MIGRATION.md`) describes it as a future deployment
  target. Nothing here assumes Supabase Auth/RLS; if/when that migration
  happens, `buildAuthContext()` is the one seam to swap a cookie-derived
  worker id for a real session's user id — everything downstream is
  already database-and-session-agnostic.
- **Database**: SQLite via Prisma, additive-only schema changes (matches
  the project's established convention — see `CLAUDE.md` "extend only
  additively"). Two new tables: `AnomalyAcknowledgment` (already existed
  from a prior feature) and `ProxyAuditLog` (new, this feature).

## Why "Users" are Workers, not a new table

Workday itself doesn't have a separate "user account" object distinct from
the Worker business object — security groups reference Workers (and
Positions, and dynamically-computed org relationships) directly. Since this
app already has a complete, effective-dated Worker model, inventing a
parallel `User` table would just be a second identity system to keep in
sync. Every `workerId` in this framework *is* the user id.

## Why role assignment is hybrid (fixed + derived)

Six roles (HR Ops, HR Partner, Finance Planner, Payroll Admin, Executive,
Super Admin) are **assigned** — a specific person was named for each,
exactly as specified. Two roles (Manager, Skip Level Manager) are
**derived** from the live supervisory-org tree: whoever currently has
direct/indirect reports holds the role, full stop, with no manual
assignment step to fall out of sync. This is deliberately how Workday's
own "Manager" security group works, and it means promoting someone into
management in this app (e.g. via the existing Worker Data Change ▸
Transfer flow) automatically grants Manager-tier menu/data access with no
separate "assign the Manager role" step — the alternative (a manually
maintained role table) would silently drift from the org chart.

A worker can hold multiple roles; effective permissions are the **union**.
See `security/roles.ts`.

## Why Feature Access and Data Access are separate systems

- **Feature access** (`can(ctx, permission)`, `security/permissions.ts` +
  `security/authorization.ts`) answers "is this capability available to me
  at all" — gates pages, nav items, and buttons.
- **Data access** (`canViewEmployee`/`canEditEmployee`,
  `security/authorization.ts` §`DataScope`) answers "given that I have the
  capability, which specific worker rows can I touch" — self / direct
  reports / org subtree / everyone.

Two roles can share a feature permission while differing entirely in data
reach (Manager and HR Partner both hold `EDIT_EMPLOYEE`; a Manager can only
exercise it on direct reports, HR Partner on anyone). Conflating the two
into one flag per role would make it impossible to extend either dimension
independently — e.g. adding row-level exceptions later only touches
`DataScope`, never `ROLE_PERMISSIONS`.

## Extensibility this design leaves room for (not built, deliberately)

- **Row-level permissions**: `DataScope` is already a per-role *ceiling*;
  a future per-worker override (e.g. "this specific HR Partner is
  restricted to the EMEA org") is a straightforward addition of a
  worker-level scope override checked before the role default, without
  touching `can()` or any page.
- **Supervisory organizations as security groups**: `lib/org-hierarchy.ts`
  already indexes the live org graph; a "Security Group = everyone under
  Supervisory Org X" rule is a new query against the same index, not a new
  subsystem.
- **Additional security groups**: `ROLE_PERMISSIONS` and
  `DATA_SCOPE_BY_ROLE` are both `Record<Role, ...>` — adding a `Role` enum
  member and two matrix rows is the entire surface area to add a role.
- **Delegation** (temporary permission grant, distinct from proxy's full
  impersonation): would live in `security/proxy.ts` alongside
  `ProxyEligibilityResult`, reusing the same audit-log table with a
  different `action` value (e.g. `"DELEGATE_GRANT"`).
- **Feature flags**: `can()`'s signature (`ctx, Permission -> boolean`) is
  already the right shape for a feature-flag check to compose with — a
  flag can gate a permission's presence in `ROLE_PERMISSIONS` per
  environment without changing any call site.

## Proxy: infinite-chain prevention

There is exactly one "actual user" slot and one "proxy target" slot (two
cookies, not a stack): the existing `peopleos_worker` cookie
(`lib/persona-constants.ts` `WORKER_COOKIE`, already used app-wide as "the
acting worker" before this feature existed) continues to mean the actual
user, and a new `peopleos_proxy_worker` cookie holds the proxy target when
one is active. Reusing the existing cookie rather than introducing a
parallel "actual user" cookie is deliberate — every pre-existing call site
that reads `WORKER_COOKIE` keeps meaning exactly what it always meant.
Eligibility (`checkProxyEligibility`) is checked against the **actual**
user's roles only — a proxy target's own roles are never consulted for
proxy eligibility, even if they happen to also hold an eligible role.
Starting a new proxy session while one is active *replaces* the single
proxy-target slot; it cannot nest. The UI additionally hides the proxy
selector entirely while proxying (defense in depth, not the sole guard).
Full detail in `security/proxy.ts`'s header comment.

## What's intentionally NOT changed

- `lib/bp-engine.ts`'s existing `Worker Data Change` business process
  (comp change / transfer, `MANAGER_OF_WORKER` / `COMP_PARTNER` /
  `HR_PARTNER` step routing) is untouched. It answers "who is assigned to
  approve *this specific step instance*," a business-process routing
  concern; this framework answers "can this role see this page / touch
  this data at all," a page/data-access concern. They compose (the new
  Inbox pages reuse the existing generic `getInbox()`) but neither
  subsumes the other.
- The new "Profile Change Request" workflow (Employee → HR Ops; Manager /
  Skip Level → HR Partner) is implemented as a **second `BpDefinition`**
  reusing the same generic BP engine — exactly the extensibility CLAUDE.md
  already documents ("`BpDefinition` → `BpStep` ... the engine could run
  others"). One new `AssigneeRule` value (`ROUTE_BASED_APPROVER`) was
  added additively to resolve to HR Ops or HR Partner based on who
  initiated, per the specified routing table.
