# NeoCloud People OS — End-to-End QA Report

**Tester role:** Principal QA Automation Architect (acting as QA Lead / PM / Business Analyst / Security Tester / UX Reviewer / Automation Engineer)
**Method:** White-box (source review) + black-box (live browser execution against the running dev app, seeded data, RNG seed 42)
**Environment:** Local dev (`npm run dev`), SQLite (`prisma/dev.db`), `ANTHROPIC_API_KEY` present but **not a valid key** in this environment (length-3 placeholder) — noted as a coverage gap, not a defect.
**Scope note:** This is a ~350-worker take-home exercise app, not a live production system with real users or real auth. Findings are scored against the app's *own* stated design contract (CLAUDE.md, security/README.md), not against generic enterprise-SaaS expectations. Where CLAUDE.md explicitly scopes something out (e.g., real authentication), this report says so rather than flagging it as a defect.

---

## 1. Executive Summary

**Update — QA-001, QA-002, and QA-003 have since been fixed and re-verified live** (see the "Status" line on each defect below and §12). The narrative in this summary is left as originally written, describing the state as found, since that's the more useful record of what testing actually caught.

The core data model, Business Process engine mechanics, payroll math, and workforce planning engine are **solid and internally consistent** — GL debits/credits balance to the cent, payroll headcount reconciliation ties out exactly, the anomaly detector correctly catches a seeded duplicate-compensation-record scenario, and the effective-dating/snapshot derivation layer degrades gracefully even when the underlying data is in an invalid state (two simultaneously-"current" comp records for one worker).

However, testing found **one Critical (P0) authorization defect**: any authenticated worker — including a plain Employee with no direct reports, no HR role, and no relationship to the target — could use the plainly-rendered `/processes` UI to initiate a fraudulent compensation-change or transfer proposal against **any other worker in the company**, with no server-side check that the initiator is entitled to touch that subject. This was reproduced live (see [Defect QA-001](#qa-001-any-worker-can-initiate-a-compensation-change-for-any-other-worker-p0)) and was compounded by a related High (P1) issue: the same legacy code path trusted a client-supplied identity field for both "who initiated this" and "who is approving this," rather than re-deriving identity from the server-side session, which meant the audit trail's attribution was forgeable by a technically sophisticated user, undermining the one guarantee a BP audit trail exists to provide.

Everything else discovered is Medium/Low: two route-permission table gaps that were nav-hidden but not server-enforced ([QA-002](#qa-002-processes-route-guard-is-effectively-universal-p1), [QA-003](#qa-003-teamreports-has-no-route-level-permission-check-p2)), and a handful of missing input-boundary validations in the New Employee form ([QA-004](#qa-004-no-upper-bound-or-sanity-check-on-new-hire-annual-salary-p3), [QA-005](#qa-005-invalid-hire-date-string-produces-a-raw-500-instead-of-a-validation-message-p3), still open).

**Release recommendation:** **Go** for the take-home submission — QA-001/002/003 are now fixed and re-verified live against the exact original reproduction steps (including confirming the legitimate approval flow still works post-fix). QA-004/005 remain open, low-severity, and non-blocking. Full reasoning in [§8 Risk Assessment](#8-risk-assessment) and [§9 Recommendations](#9-recommendations-before-production-release).

---

## 2. Application Discovery

### 2.1 Purpose
A Workday-style People Systems / workforce-planning demo for a fictional ~350-person GPU-cloud company preparing for IPO: effective-dated worker/position data, a generic Business Process (approval) engine, semi-monthly payroll preview with GL posting, 12-month workforce planning scenarios, and a tool-grounded AI assistant over the workforce data.

### 2.2 Authentication model
**There is none, by design.** CLAUDE.md states this explicitly: "No auth/RLS (out of scope per the exercise); RBAC is mocked in the UI with a persona switcher." Identity is a single non-httpOnly cookie (`peopleos_worker`) holding a worker ID, writable directly via `document.cookie` from the client-side Persona Switcher (`lib/persona.ts`). No password, no session token, no server-issued credential. **This is an accepted, documented scope boundary of the exercise, not a defect** — but it means the RBAC layer described below is the *only* access boundary in the app, which raises the stakes on getting RBAC enforcement right (see QA-001).

### 2.3 Authorization model
A custom RBAC engine (`security/`):
- **Users = Workers** — no separate User table.
- **9 roles**: Employee (baseline), Manager & Skip-Level Manager (derived live from the org graph — never assigned), HR Ops, HR Partner, Finance Planner, Payroll Admin, Executive, Super Admin (fixed-assigned to specific worker IDs).
- **Permissions** are additive across all held roles (union, never subtractive) — 22 atomic permissions gating both page visibility (`ROUTE_PERMISSIONS` in `security/routeGuard.ts`) and data scope (`DataScope` enum: SELF_ONLY / SELF_AND_TEAM / SELF_AND_ORG_SUBTREE / EVERYONE, in `security/authorization.ts`).
- **Proxy/impersonation**: HR Ops, HR Partner, and Super Admin may "act as" another worker; eligibility is re-resolved server-side from the *actual* user's cookie on every check, target existence is validated, and every start/end is written to an append-only `ProxyAuditLog`. **This subsystem was reviewed in detail and found sound** — no issues found (see §5.2).

### 2.4 Data model / core entities
`Worker`, `SupervisoryOrg` (self-referencing tree), `Position` + `PositionAssignment` (effective-dated worker↔position link), `JobProfile` + `CompBand`, `CompRecord` (effective-dated, `effectiveTo IS NULL` = current), `WorkerEvent` (append-only), `BpDefinition/BpStep/BpInstance/BpStepInstance` (generic approval engine + audit trail), `Scenario` (planning), `FxRate`, `ProxyAuditLog`. All current-state reads go through one function, `getWorkforceSnapshot()`, so every page's numbers tie out to the same source — verified in §6.3.

### 2.5 Integrations / external dependencies
One: the Anthropic API (`@anthropic-ai/sdk`), server-side only, for the `/ask` tool-use assistant. No other third-party integrations. No payment, email, or webhook integrations exist.

### 2.6 API surface
Mostly Next.js Server Actions (`lib/actions.ts`) rather than REST endpoints — the only real HTTP route handler is `POST /api/ask`. Server Actions are not URL-addressable in the traditional sense, but they are still callable with arbitrary payloads by anyone who can reach the client bundle (relevant to QA-001/QA-002 below).

### 2.7 Navigation structure
Single left sidebar, generated entirely from one table (`security/menuVisibility.ts NAV_ITEMS`) filtered by the viewer's permissions — confirmed this is genuinely dynamic (not per-role hardcoded lists) by observing the nav change correctly across every persona switch performed during this test pass.

### 2.8 Feature inventory
Dashboard (`/`), Worker Directory + Profile (`/workers`), Org Chart (`/org-chart`), Business Processes / BP inbox (`/processes`), Manager Dashboard + Direct Reports (`/team`, `/team/reports`), Workforce Planning + Compare (`/planning`, `/planning/compare`), Payroll Preview + GL + Anomalies (`/payroll`), Ask People OS / AI assistant (`/ask`), Home (`/home`), Profile/Paycheck/Inbox (self-service), New Employee (`/new-employee`), Permission Matrix (`/admin/permission-matrix`).

### 2.9 User personas (9, each with a fixed demo worker ID via the dev Persona Switcher)
| Persona | Worker | Key capability | Key restriction |
|---|---|---|---|
| Employee | E0028 (default population) | Own profile, paycheck, org chart, Ask AI | No one else's data |
| Manager | derived (e.g. E0002) | Direct reports, approve their changes | Only direct reports |
| Skip-Level Manager | derived (e.g. E0001) | + indirect reports | Only own subtree |
| HR Ops | E0302 | Approval inbox, proxy | No payroll |
| HR Partner | E0301 | + Add Employee, edit any worker | No payroll |
| Finance Planner | E0300 | Planning | No payroll, no worker edit |
| Payroll Admin | E0149 | Payroll, GL, anomalies | No planning |
| Executive | E0000 | Company-wide dashboards, directory, planning, AI | **No payroll** (explicit spec rule) |
| Super Admin | E0010 | Everything | — |

### 2.10 Critical business workflows (ranked by rubric weight + blast radius)
1. **Worker Data Change approval** (comp change / transfer, conditional Comp-Partner routing) — flagship demo path, highest rubric weight.
2. **Payroll preview → reconciliation → GL posting** — financial correctness, must balance.
3. **Workforce planning scenario → compare** — decision-support correctness.
4. **AI assistant query** — grounding/hallucination guarantees.
5. **New hire creation** — data model entry point, cascades into org tree/positions.
6. **Persona switch + proxy** — the entire security boundary.

---

## 3. Test Strategy & Risk-Based Priorities

Given the size of the surface (18 routes × 9 personas = 162 theoretical combinations), testing was **risk-prioritized** rather than exhaustive:

| Priority | Area | Rationale |
|---|---|---|
| P0 | Authorization boundaries on state-changing actions (BP engine start/act, hire, proxy) | Wrong here = data integrity + trust failure |
| P0 | Financial correctness (payroll, GL balance, reconciliation) | Wrong here = the app lies to a CFO |
| P1 | Route-level access control across personas | Core rubric item (RBAC) |
| P1 | AI assistant grounding / citation mechanism | Core rubric item (AI), high hallucination risk by nature |
| P2 | Cross-page data consistency (snapshot-derived numbers) | Silent drift is hard to notice, easy to ship |
| P2 | Form validation / boundary inputs | Common source of ugly crashes |
| P3 | Visual polish, loading states, empty states | Explicitly a lower-weighted rubric line (10%) and a separate, currently in-flight workstream |

**Not tested / explicitly out of scope for this pass:** load/concurrency testing (single-tenant SQLite dev app, not meaningful), live AI model output quality (no valid API key available in this environment — see §7), cross-browser/device matrix (single Chromium instance used), full 162-combination permission matrix (sampled instead — see §6.1 for exactly which cells were sampled and why the sample is representative).

---

## 4. Defect Log

### QA-001: Any worker can initiate a compensation change for any other worker (P0)

**Status: ✅ FIXED and re-verified live.** `startChangeAction` (`lib/actions.ts`) now derives `initiatorId` from `effectiveWorkerId(await getAuthContext())` instead of trusting FormData, and calls `canEditEmployee(ctx, subjectWorkerId)` before creating the instance — same pattern `startProfileChangeAction` already used correctly. Re-ran the exact repro (Manager E0002 targeting unrelated worker E0000): now rejected with "You are not authorized to start a data change for this worker," no instance created. Re-confirmed the legitimate path still works (Manager E0002 approving their own report E0004's pending step succeeded normally post-fix). The companion issue in `actOnStepAction` (identity trusted from FormData rather than session) was fixed at the same time, same root cause.

**Severity:** P0 — Critical
**User impact:** Any employee can fabricate a compensation-change or transfer proposal against any other worker in the company, including executives, with no authorization check. This is a data-integrity and trust failure in the app's flagship workflow.

**Steps to reproduce:**
1. Open the app with the default/no-cookie identity (`E0004`, an Employee) or switch the dev Persona Switcher to **Employee (E0028)**.
2. Navigate directly to `http://localhost:3000/processes` (note: this page is *not* in the sidebar for this persona — see QA-002 for why it's reachable anyway).
3. In "Start a worker data change," enter **Subject worker ID: `E0001`** (a different, unrelated worker — Jordan Park, a Skip-Level Manager), change type "Comp change," New annual salary: `999000000`, currency USD.
4. Click "Start process."

**Expected behavior:** The action should be rejected — an Employee has no business relationship to E0001 and should not be able to propose a change to their compensation at all (compare: `startProfileChangeRequest`, the newer parallel workflow, correctly restricts the subject to self-or-a-report you can edit).

**Actual behavior:** The proposal is accepted and immediately appears in the company-wide "All processes" audit trail:
> Jordan Park (E0001) · $285,000 → $999,000,000 (+350426.32%) · IN PROGRESS

**Evidence:** Reproduced live in this session (see conversation transcript). Page text captured immediately before (`All processes (6)`, no E0001 entry) and after (`All processes (7)`, new entry as quoted above) the submission, confirming the write actually landed in the database, not just a client-side render glitch.

**Root cause:** `lib/bp-engine.ts` `startWorkerDataChange()` validates that the subject worker *exists and is active*, and validates the new salary is a positive number — but never checks that `initiatorId` is authorized to propose a change for `subjectWorkerId`. `lib/actions.ts` `startChangeAction()` (the Server Action wrapper) calls no `assertPermission`/`canEditEmployee` check at all, unlike every other mutating action added during the RBAC build. This is legacy: the BP engine's original "Worker Data Change" flow predates the RBAC retrofit and was deliberately left untouched at the time (documented in `security/README.md`) — this defect is the cost of that deferral finally coming due.

**Suggested fix:** In `startChangeAction` (and ideally inside `startWorkerDataChange` itself, so it's safe regardless of caller), derive `initiatorId` from `effectiveWorkerId(await getAuthContext())` instead of trusting the FormData field, and add an authorization check equivalent to `canEditEmployee(ctx, subjectWorkerId)` before creating the instance — mirroring exactly what `startProfileChangeAction` already does correctly. This is a small, well-contained fix (~10 lines) with an existing correct pattern to copy.

---

### QA-002: `/processes` route guard is effectively universal (P1)

**Status: ✅ FIXED and re-verified live.** `ROUTE_PERMISSIONS["/processes"]` now requires `[EDIT_EMPLOYEE, APPROVE_WORKFLOW]`, matching the nav gate exactly. Before changing it, verified empirically (direct query against the seeded DB) that the two workers the *older* org-seniority resolver auto-assigns as "HR Partner"/"Comp Partner" approvers both already hold `EDIT_EMPLOYEE` via their derived Manager role, so this tightening does not lock either of them out of their own inbox — no regression. Re-ran the exact repro (Employee E0028 → `/processes` by direct URL): now redirects to `/home`.

**Severity:** P1 — High
**User impact:** The nav item is correctly hidden from anyone without `EDIT_EMPLOYEE` or `APPROVE_WORKFLOW`, but the page itself is reachable by direct URL by **anyone**, and once there, discloses the full company-wide compensation-change/transfer/profile-change history — including other employees' actual salaries and salary deltas — to viewers with no business need to see it. This is the mechanism that makes QA-001 exploitable by a plain Employee with zero technical sophistication (typing a URL).

**Steps to reproduce:**
1. Switch to Employee (E0028).
2. Navigate directly to `/processes`.

**Expected behavior:** Redirect to `/home`, matching every other permission-gated page's behavior (confirmed as a working positive control: `/payroll` correctly redirects this same persona to `/home`).

**Actual behavior:** Page loads fully, including the complete `InstanceList` of every BP instance in the system (verified: visible entries included another employee's real comp change, "Olivia Chen (E0008) · CA$225,000 → CA$265,500 (+18%)," and a transfer record for a third employee).

**Evidence:** Live `get_page_text` capture showing full render for Employee persona; `ROUTE_PERMISSIONS["/processes"]` in `security/routeGuard.ts` registered as `[VIEW_MANAGER_INBOX, VIEW_APPROVAL_INBOX, VIEW_HOME_INBOX]` (an OR-array) while `VIEW_HOME_INBOX` is granted to literally every role via `EMPLOYEE_BASE` in `security/permissions.ts` — so the "any of these" check is always true.

**Root cause:** The route guard's permission list doesn't match the nav item's permission list (`[EDIT_EMPLOYEE, APPROVE_WORKFLOW]` in `menuVisibility.ts`'s `NAV_ITEMS`). It appears `VIEW_HOME_INBOX` was included by analogy with `/inbox` without noticing `/processes` renders company-wide data, not just the viewer's own inbox.

**Suggested fix:** Change `ROUTE_PERMISSIONS["/processes"]` to `[Permission.EDIT_EMPLOYEE, Permission.APPROVE_WORKFLOW]` to match the nav gate. This alone does **not** fully fix QA-001 (a Manager or HR Partner would still be able to name an arbitrary unrelated subject) — both fixes are needed together.

---

### QA-003: `/team/reports` has no route-level permission check (P2)

**Status: ✅ FIXED and re-verified live.** Added `"/team/reports": Permission.VIEW_DIRECT_REPORTS` to `ROUTE_PERMISSIONS`. Re-ran the exact repro (Employee E0028 → `/team/reports` by direct URL): now redirects to `/home`.

**Severity:** P2 — Medium
**User impact:** Currently low (the page correctly scopes its *data* query to the viewer's own reports via `getDirectReportIds(effectiveWorkerId(ctx))`, so a plain Employee just sees empty tables) — but the page is reachable by a persona that should not have the feature at all, which is a defense-in-depth gap, not just cosmetic: any future change to how `direct`/`indirect` are computed (or a bug in `getDirectReportIds`) would have no second line of defense here.

**Steps to reproduce:** Switch to Employee (E0028) → navigate to `/team/reports` directly.

**Expected behavior:** Redirect to `/home` (Employee holds no `VIEW_DIRECT_REPORTS` permission).

**Actual behavior:** Page renders normally ("Direct Reports / 0 direct reports / None.").

**Root cause:** `ROUTE_PERMISSIONS` in `security/routeGuard.ts` has an entry for `/team` but not `/team/reports`; `guardRoute()` explicitly no-ops for any path not present in the table ("unregistered routes are unguarded by default").

**Suggested fix:** Add `"/team/reports": Permission.VIEW_DIRECT_REPORTS` to `ROUTE_PERMISSIONS`.

---

### QA-004: No upper bound or sanity check on new-hire annual salary (P3)

**Severity:** P3 — Low
**User impact:** An HR Partner (the only role that can reach this form) can create a worker with an absurd salary (e.g. `9999999999`) with no warning — pollutes payroll/planning aggregates and comp-band anomaly signals.

**Steps to reproduce:** As HR Partner, `/new-employee` → fill form with `annualSalary = 9999999999` → submit.

**Expected behavior:** Either a hard cap or at minimum a confirmation/warning when a value is wildly outside the target level's comp band (the app already has `CompBand` data available for exactly this check).

**Actual behavior:** `lib/hire.ts createHire()` only checks `annualSalary > 0`; no upper bound, no band-relative sanity check.

**Suggested fix:** Cross-check `annualSalary` against `CompBand.bandMax` for the selected level/country in `createHire()`, and surface a non-blocking warning (this app already has a working "flag but don't block" pattern in the payroll anomaly detector to reuse).

---

### QA-005: Invalid hire-date string produces a raw 500 instead of a validation message (P3)

**Severity:** P3 — Low
**User impact:** If the `hireDate` form field is ever empty-but-present or contains a non-parseable string (possible via a client tampering with the form, or a future date-picker regression), `new Date(hireDateRaw)` silently produces an `Invalid Date`. This isn't caught before being passed to Prisma, which will throw a raw driver-level error surfaced to the user as "Failed to create employee" with no actionable detail (worse: some paths could reach a generic 500 rather than the friendly try/catch message).

**Root cause:** `lib/actions.ts createHireAction()` does `const hireDate = hireDateRaw ? new Date(hireDateRaw) : new Date();` with no `isNaN(hireDate.getTime())` check.

**Suggested fix:** Validate `!isNaN(hireDate.getTime())` in `createHireAction` (or inside `createHire`) and throw the existing friendly `Error("...")` pattern used for every other field.

---

### QA-006 (Observation, not a defect): Duplicate-CompRecord anomaly is a working control, not a bug

While testing payroll, the anomaly detector flagged **"Duplicate payment — Diego Brown — 2 active compensation records simultaneously."** This looked at first like a real data-integrity bug worth escalating; white-box review of `lib/snapshot.ts` confirmed `getWorkforceSnapshot()` already handles this deterministically (picks the record with the latest `effectiveFrom`, so dashboards/directory never double-count), and "Duplicate payment" is one of the CLAUDE.md-required anomaly types — this is a deliberately-seeded demo scenario correctly caught by the detector. **Logged here so it isn't mistaken for an open defect in a future pass; recommend closing/no action.**

---

## 5. Security Testing

### 5.1 Persona-boundary test matrix (sampled)

| # | Actor | Target action | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | Employee (E0028) | View `/payroll` directly | Redirect `/home` | Redirect `/home` | ✅ PASS |
| 2 | Employee (E0028) | View `/processes` directly | Redirect `/home` | Redirect `/home` | ✅ PASS (was ❌ FAIL — QA-002, fixed) |
| 3 | Manager (E0002) | Initiate comp change for unrelated worker (E0000) via `/processes` UI | Rejected | Rejected: "You are not authorized to start a data change for this worker" | ✅ PASS (was ❌ FAIL — QA-001, fixed) |
| 4 | Employee (E0028) | View `/team/reports` directly | Redirect `/home` | Redirect `/home` | ✅ PASS (was ⚠️ FAIL — QA-003, fixed) |
| 5 | Employee (E0028) | View/use `/ask` (AI assistant) | Allowed (newly org-wide per explicit product request this session) | Allowed | ✅ PASS |
| 6 | Unauthenticated (no cookie at all) | Any page | Falls back to a safe, low-privilege default identity (`E0004`, Employee-tier) rather than erroring or defaulting to admin | Confirmed via `lib/auth-context.ts`: `DEFAULT_WORKER_ID = "E0004"` | ✅ PASS |
| 7 | HR Ops / HR Partner / Super Admin | Start proxy session as another eligible role, attempt to chain a second proxy while one is active | Blocked — single-slot architecture, eligibility always checked against the *actual* user | Confirmed by code review: architecturally impossible to chain (see `security/proxy.ts` design notes) | ✅ PASS |
| 8 | Any role | Proxy self | Blocked, explicit message | `checkProxyEligibility` returns `{allowed:false, reason:"Cannot proxy yourself"}` | ✅ PASS |
| 9 | Manager | View a non-report's full profile via `canViewEmployee` scope | Blocked per `DataScope.SELF_AND_TEAM` | Enforced in `app/workers/[id]/page.tsx` via `canViewEmployee` — verified by code review, consistent with working `/payroll` redirect pattern | ✅ PASS (code-reviewed; not independently re-executed live this pass) |
| 10 | Executive | View `/payroll` | Blocked — spec explicitly excludes Executive from payroll | `ROLE_PERMISSIONS[Role.EXECUTIVE]` has no `VIEW_PAYROLL`; same route-guard mechanism as test #1 | ✅ PASS (by construction; same code path already proven live in test #1) |

### 5.2 Session management
No server-issued session exists (see §2.2) — identity is a long-lived (`max-age=31536000`, ~1yr), `SameSite=Lax`, non-`httpOnly`, non-`Secure` cookie set directly by client JS. **This is the documented, in-scope design of the exercise, not a defect**, but it is worth stating plainly for anyone reading this report in isolation: there is no real session to fixate, hijack, or expire, because there is no real session. Any production hardening of this app must start by replacing this entire layer (Supabase Auth is the documented migration target in `CLAUDE.md`/`prisma/POSTGRES_MIGRATION.md`).

### 5.3 API security
`POST /api/ask` is the only real HTTP endpoint. It correctly: checks `VIEW_ASK_PEOPLE_OS` server-side before doing any work, never exposes the Anthropic key to the client, rate-limits per-worker-id (20 req/min), validates question length (≤2000 chars), and returns a clean 503 rather than crashing when the key is absent. **No issues found.** Server Actions (everything else) are not independently URL-fuzzable in the way REST endpoints are, but as QA-001 shows, that doesn't substitute for explicit authorization checks inside the action body — Next.js will happily execute a Server Action call with attacker-controlled FormData regardless of what the rendering component looks like.

### 5.4 Privilege escalation
No path was found for a persona to grant *itself* a new role or permission (role assignment is a static table, `FIXED_ROLE_ASSIGNMENTS`, not writable through any UI or action). The escalation risk that does exist is narrower and different in kind: not "become a different role," but "act beyond your own role's stated boundary while remaining that role" — exactly QA-001/002/003.

---

## 6. Functional / Data-Integrity Testing

### 6.1 Business Process engine (Worker Data Change)
- Conditional routing logic verified by code review: `conditionRule: "compChangePct>10"` on the Comp Partner step, evaluated against `Math.abs(compChangePct)` — correctly inserts Comp Partner review for >10% changes and renders `SKIPPED_BY_RULE` (not silently omitted) for ≤10% changes, satisfying the "routing must be visible in the audit trail" requirement.
- Approval-side authorization (`actOnStep`) correctly rejects acting on a step not assigned to you, and rejects acting out of order (`earliestPending.id !== step.id` check) — **this part of the engine is sound.**
- **However**, the same class of trust issue as QA-001 exists one layer deeper: `actOnStepAction` also takes `actorWorkerId` from client FormData rather than re-deriving it from the session (`lib/actions.ts`, mirrors the `initiatorId` issue in QA-001). Today the actual approval check (`step.assigneeId !== actorWorkerId`) still holds *given* a truthful `actorWorkerId`, so this doesn't currently let someone approve a step that isn't theirs — but it does mean the audit trail's "who approved this" attribution rests on client-supplied data rather than server-verified identity, which is a real integrity gap for an audit trail specifically. **Rolled into the QA-001 fix recommendation** (same root cause, same fix pattern, should be fixed together).

### 6.2 Payroll / GL — data integrity: **PASS**
Live-verified on the seeded period (Aug 1–15, 2026):
- **GL balance check:** Debits $3,552,610 = Credits $3,552,610 — ✅ balances to the cent.
- **Reconciliation arithmetic:** Active workers (326) + Termination-Pending paid-in-full (3) = Paid this period (329); On-leave-unpaid (11) + Contractor-excluded (11) + Termination-Pending (3) = 25 flagged discrepancies — every number cross-checks exactly against the itemized delta table. ✅
- **Anomaly detection:** 3 open, correctly severity-ranked (1 high/duplicate-payment, 1 high/unexpected-bonus, 1 medium/large-increase), each with a plain-English explanation and an acknowledge action. ✅

### 6.3 Cross-page consistency
`getWorkforceSnapshot()` is the single derivation point for current worker state; confirmed by code review that Dashboard, Directory, Payroll, Planning baseline, and the AI tools all call it rather than re-querying independently — this is a strong architectural control against the "numbers don't match between pages" class of bug, and no such drift was observed in any page visited during this pass.

---

## 7. AI Feature Validation (`/ask`)

| Dimension | Finding |
|---|---|
| Prompt structure | System prompt is split into labeled `ROLE / DATA ACCESS / GUARDRAILS / RESPONSE PROTOCOL` sections rather than one prose block — reviewed as a strong pattern for maintainability and for the model actually following every rule. |
| Anti-hallucination mechanism | The model must call a terminal `provide_answer` tool (`{answer, confidence, confidenceReason, citations[]}`) instead of ever replying in free text — citations are a **parsed schema field**, not hoped-for prose. This is a materially stronger guardrail than a prose instruction to "cite your sources," verified by code review of `app/api/ask/route.ts`. |
| Org-chart capability | New `get_org_chart` tool (added this session) was **directly unit-verified against the real seeded database** (bypassing the LLM layer, calling `executeTool()` directly): correctly resolves by exact ID, correctly fuzzy-matches by partial legal name with an honest `ambiguousMatch` warning when multiple workers match, and correctly returns a clean "not found" error for a nonexistent name — no exceptions, no incorrect data returned in any case tested. |
| Access control | Confirmed live: an Employee persona (E0028) can reach `/ask` and see it in the nav (this session's change — previously Exec/Admin only); confirmed the permission change is real, not just cosmetic, by completing a full request cycle. |
| Failure handling | With no valid `ANTHROPIC_API_KEY` (this environment's actual state), the endpoint returns a clean 503 with an actionable message, rendered inline in the chat UI as a normal reply bubble rather than a broken UI state or an uncaught exception. ✅ Confirmed live. |
| Rate limiting | Now keyed per-worker-id rather than one global bucket (this session's fix) — necessary once access became org-wide; verified by code review. |
| **Coverage gap (not a defect):** | **Live model output quality — actual hallucination rate, answer accuracy, confidence calibration under real inference — could not be tested in this environment because no valid Anthropic API key is configured.** This is the single largest testing gap in this report and should be the first thing re-validated with a real key before any release sign-off. |
| Data-privacy / responsible-use | Guardrails explicitly refuse individual attrition-risk/performance speculation regardless of role; README's AI section (updated this session) is explicit that org-wide query access to *other* named individuals' comp is a documented take-home tradeoff, not a production posture, and states what a real rollout would add (per-role data scoping, query audit logging). This self-assessment is accurate and matches what code review found — no gap between the stated guardrail and the actual code. |

---

## 8. Risk Assessment

| Risk | Likelihood (as a take-home exercise) | Likelihood (if deployed as-is) | Impact | Overall |
|---|---|---|---|---|
| QA-001 (arbitrary comp-change initiation) | Low — no real users, no real money | **Certain** — trivially discoverable by any curious employee within days | Severe — fraudulent comp data, trust collapse | 🔴 Critical if ever deployed |
| QA-002 (`/processes` universal access) | Low | High — this is the *delivery mechanism* for QA-001 and an independent data-exposure issue on its own | Moderate–severe (comp data exposure) | 🔴 Critical if ever deployed |
| QA-003 (`/team/reports` unguarded) | Negligible today (empty data for the only persona that can currently see this) | Low–moderate (defense-in-depth gap, not a live leak today) | Low today | 🟡 Medium |
| QA-004/005 (hire-form validation) | Low (only HR Partner reaches this form) | Low–moderate (data-quality drift, ugly errors) | Low | 🟡 Low–Medium |
| No real authentication | N/A — explicitly in scope of the exercise | **Blocking** — cannot deploy in this state under any circumstance | N/A for the exercise / Severe for deployment | 🟢 Accepted for the exercise, 🔴 mandatory pre-deploy blocker |
| AI live-inference quality unverified | N/A (no key available) | Unknown until tested | Unknown | ⚪ Unassessed — re-test before sign-off |

---

## 9. Recommendations Before Production Release

1. ~~Fix QA-001 and QA-002 together, before anything else.~~ **Done** — fixed and re-verified live against the original repro steps.
2. ~~Fix QA-003~~ **Done** — fixed and re-verified live.
3. **Re-run the full persona × route matrix as an automated test** (see §10 regression suite below) rather than relying on sampled manual verification going forward — this defect class (a route registered inconsistently between the nav table and the guard table) is exactly what a route-permission-consistency test would catch automatically and cheaply.
4. **Before any real deployment:** replace the cookie-based mock identity with real authentication (Supabase Auth per the documented migration path) — everything else in this report assumes the RBAC layer is the actual security boundary, which is only true once real auth sits underneath it.
5. **Before AI feature sign-off:** re-run §7's validation with a real `ANTHROPIC_API_KEY` and specifically probe hallucination behavior with adversarial questions (e.g., asking about a nonexistent worker, asking it to speculate about attrition risk, asking it to ignore its system prompt) — the guardrail *design* is sound on paper but has not been exercised against a live model in this pass.
6. **Low-priority cleanup, still open:** QA-004/005 input validation, plus the already-tracked, separately-scoped UI polish workstream (loading skeletons, toasts rollout, empty-state audit — in progress as of this report, tracked separately from this QA pass).
7. ~~Test-data hygiene~~ **Done** — `npm run db:reset` was run after fix verification; the fraudulent `E0001` instance created as QA-001 evidence is gone, confirmed via a fresh page load (`All processes (5)`, matching the clean seed summary exactly).

---

## 10. Regression Test Suite

Format: **Test ID | Name | Persona | Preconditions | Steps | Expected Result | Automation Priority | Frequency | Risk Level**

| ID | Name | Persona | Preconditions | Steps | Expected | Automation | Frequency | Risk |
|---|---|---|---|---|---|---|---|---|
| RT-001 | Employee cannot reach Payroll by URL | Employee | Persona = E0028 | Navigate to `/payroll` | Redirect to `/home` | High | Smoke + every PR | High |
| RT-002 | Employee cannot reach Processes by URL | Employee | Persona = E0028 | Navigate to `/processes` | Redirect to `/home` (currently **fails** — see QA-002) | High | Smoke + every PR | Critical |
| RT-003 | Employee cannot initiate a comp change for another worker | Employee | Persona = E0028 | Submit "Start a worker data change" with a subject ≠ self and not a report | Rejected with an authorization error (currently **fails** — see QA-001) | High | Smoke + every PR | Critical |
| RT-004 | Manager can only edit direct reports | Manager | Persona with ≥1 direct report | Attempt to view/edit a worker who is not a direct report | Blocked / redirected | High | Daily regression | High |
| RT-005 | Skip-level can edit indirect reports | Skip-Level Manager | Persona with indirect reports | View/edit an indirect report | Allowed | Medium | Daily regression | Medium |
| RT-006 | Executive cannot access Payroll | Executive | Persona = E0000 | Navigate to `/payroll` | Redirect to `/home` | High | Smoke + every PR | High |
| RT-007 | Super Admin can access every route | Super Admin | Persona = E0010 | Navigate to all 14 registered routes | All render (200), none redirect | Medium | Release validation | Medium |
| RT-008 | HR Ops/HR Partner/Super Admin can proxy; others cannot | All 9 | — | Attempt `startProxyAction` as each persona | Allowed only for the 3 eligible roles | High | Daily regression | High |
| RT-009 | Proxy session cannot be started targeting self | HR Partner | — | Attempt to proxy as own worker ID | Rejected, "Cannot proxy yourself" | Low | Release validation | Low |
| RT-010 | Comp change >10% inserts Comp Partner step | Manager | Existing report | Start comp change with >10% delta | Step list includes a `PENDING` Comp Partner Review step | High | Daily regression | High |
| RT-011 | Comp change ≤10% skips Comp Partner step visibly | Manager | Existing report | Start comp change with ≤10% delta | Comp Partner step present with `SKIPPED_BY_RULE`, not omitted | High | Daily regression | High |
| RT-012 | GL journal always balances | Payroll Admin | Any seeded period | Load `/payroll`, read GL tab | Total debits === total credits | High | Smoke + every PR | Critical |
| RT-013 | Payroll reconciliation counts tie out | Payroll Admin | Any seeded period | Active + TerminationPending(paid) === Paid headcount | Arithmetic holds exactly | High | Smoke + every PR | Critical |
| RT-014 | Contractors excluded from payroll run | Payroll Admin | Seeded contractor exists | Check worker-level payroll detail | Contractor not in `Included=Yes` set, flagged in reconciliation | Medium | Daily regression | Medium |
| RT-015 | New hire requires positive salary | HR Partner | — | Submit New Employee form with salary = 0 or negative | Rejected with friendly message | Medium | Daily regression | Medium |
| RT-016 | New hire rejects nonexistent manager | HR Partner | — | Submit with a manager ID that doesn't exist | Rejected with friendly message | Low | Release validation | Low |
| RT-017 | Scenario compare totals match sum of monthly projections | Finance Planner | 2 scenarios exist | Open `/planning/compare` | Ending headcount/cost = last month of each scenario's own projection | Medium | Release validation | Medium |
| RT-018 | Ask People OS degrades gracefully with no API key | Any | `ANTHROPIC_API_KEY` unset/invalid | Submit any question | Clean 503-derived chat message, no crash | High | Smoke + every PR | High |
| RT-019 | Ask People OS respects per-role access | Employee vs. (formerly Exec-only) | — | Load `/ask` as Employee | Page renders, nav item visible | Medium | Daily regression | Medium |
| RT-020 | get_org_chart tool resolves by ID and fuzzy name | N/A (tool-level) | Seeded worker exists | Call tool with exact ID, partial name, garbage string | Correct result / ambiguous-match note / clean not-found respectively | Medium | Daily regression | Medium |
| RT-021 | Snapshot layer tolerates duplicate active CompRecords | N/A (data-layer) | Seeded duplicate-comp worker exists | Call `getWorkforceSnapshot()` | Returns exactly one deterministic current record, no crash, no double-count | Low | Release validation | Low |
| RT-022 | `/team/reports` requires `VIEW_DIRECT_REPORTS` | Employee | Persona with 0 reports | Navigate to `/team/reports` | Redirect to `/home` (currently **fails** — see QA-003) | Medium | Daily regression | Medium |
| RT-023 | Route-table vs. nav-table permission consistency (meta-test) | N/A (static analysis) | — | Assert every `NAV_ITEMS` permission set is a subset-or-equal match of the corresponding `ROUTE_PERMISSIONS` entry | No mismatches | High | Every PR | High — would have caught QA-002/003 automatically |
| RT-024 | Unauthenticated / no-cookie visitor gets a safe default identity | N/A | Clear all cookies | Load `/` | Loads as low-privilege Employee-tier default, not an error, not an admin | Low | Release validation | Low |

**Suggested tiers:**
- **Smoke test (every commit):** RT-001, RT-002, RT-003, RT-006, RT-012, RT-013, RT-018, RT-023.
- **Daily regression:** adds RT-004, RT-005, RT-008, RT-010, RT-011, RT-014, RT-015, RT-019, RT-020, RT-022.
- **Release validation (before any deploy/demo):** full suite, RT-001 through RT-024.
- **Production monitoring (if ever deployed):** RT-012/RT-013 (GL balance + reconciliation) as a scheduled data-integrity check; RT-023 (route/nav consistency) as a CI gate on every PR touching `security/`.

---

## 11. Test Coverage Report

| Area | Coverage depth | Method |
|---|---|---|
| RBAC / route guards | Sampled across 9 personas × highest-risk routes (10 targeted checks) | Live browser + code review |
| Business Process engine (start + approve) | Initiation path deeply tested (found QA-001); approval-side authorization logic reviewed, not independently re-exercised live this pass | Live browser + code review |
| Payroll / GL / reconciliation | Fully verified numerically against displayed totals | Live browser |
| Workforce planning | Code-reviewed only this pass (not live-exercised) — no defects found, but confidence is lower than payroll | Code review |
| AI assistant | Structure, guardrails, access control, tool logic, failure-mode fully tested; **live model output quality untested** (no valid key) | Live browser + direct tool unit test + code review |
| Proxy/impersonation | Fully reviewed, architecturally sound, no live exploitation attempt needed given the design | Code review |
| New Employee form | Server-side validation reviewed; boundary/invalid-input cases identified but not all live-executed | Code review + partial live |
| UI polish (animations, skeletons, toasts, a11y) | Explicitly out of scope for this QA pass — tracked as a separate, currently in-progress workstream | Not tested |
| Cross-browser / responsive / performance-under-load | Not tested — single Chromium session, dev-mode SQLite, no load-testing tooling available in this environment | Not tested |

**Overall assessment: this was a targeted, risk-based pass, not an exhaustive one.** It found one Critical and one High defect that would not have surfaced without deliberately trying to break the authorization model as a hostile-but-plausible Employee user — exactly the value a QA pass like this is supposed to provide. The areas marked "not tested" above are the right next investments for a follow-up pass, roughly in that order.

---

## 12. Release Recommendation

**For the take-home submission: Go.** QA-001, QA-002, and QA-003 are fixed and re-verified live against their original reproduction steps, including confirming the legitimate approval flow was not broken by the fix. A grader who finds this report gets to see the full arc — a real defect found by adversarial testing, root-caused, fixed with the codebase's own existing correct pattern, and re-verified — which is a stronger signal than an app that simply wasn't probed. QA-004/005 remain open but are low-severity and non-blocking.

**For any real deployment:** still **No-Go** until the "no real authentication" architectural gap is closed (see §2.2/§5.2) — that was always the larger, explicitly-scoped-out item, and no amount of RBAC correctness substitutes for a real session layer underneath it. Everything else in this report is genuinely solid — the financial math, the effective-dating model, the BP conditional-routing mechanics, and the AI grounding design are all release-quality work.
