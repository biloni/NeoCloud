# NeoCloud People OS

A lightweight People operations & workforce planning app built for a People Systems Lead take-home exercise. It simulates HRIS workflows for NeoCloud Inc., a fictional ~350-person GPU cloud company preparing for IPO, and is designed throughout to mirror Workday's data and process concepts.

**Live URL:** _add after deployment_
**Repo:** _add after pushing to GitHub_

## Setup

Prerequisites: Node.js 18+.

```bash
npm install
cp .env.example .env          # already present locally with SQLite defaults
npm run db:push                # create prisma/dev.db from schema.prisma
npm run db:seed                # generate the deterministic ~350-worker dataset
npm run dev                    # http://localhost:3000
```

To reset the database and reseed from scratch: `npm run db:reset`.

To enable the AI feature (`/ask`), set `ANTHROPIC_API_KEY` in `.env`. Without it, the page loads normally and the API returns a clear "not configured" message instead of crashing — everything else in the app works with zero external accounts.

### Deploying (Vercel + Supabase)

Local dev intentionally uses SQLite so the app runs with zero external accounts during development. Before deploying, follow [`prisma/POSTGRES_MIGRATION.md`](prisma/POSTGRES_MIGRATION.md) to swap the datasource to Supabase Postgres, then deploy the Next.js app to Vercel with `DATABASE_URL`, `DIRECT_URL`, and `ANTHROPIC_API_KEY` set as environment variables.

## Architecture

### Data model

Dimensions (master data — never carry history) vs. transactions (events — always effective-dated) are strictly separated, per the exercise's requirement:

- **Dimensions:** `Worker`, `SupervisoryOrg`, `JobProfile`, `Location`, `Position`, `CompBand`, `FxRate`
- **Effective-dated state:** `PositionAssignment` (worker↔position over time), `CompRecord` (salary over time) — both use `effectiveFrom`/`effectiveTo` (`null` = current). Nothing is ever mutated in place; a change closes the current record and opens a new one.
- **Transactions:** `WorkerEvent` (HIRE, TERMINATION, TRANSFER, COMP_CHANGE, STATUS_CHANGE, PROMOTION) — an append-only audit log, optionally linked to the `BpInstance` that produced it.
- **Business process engine:** `BpDefinition` → `BpStep` (+ `conditionRule`) → `BpInstance` → `BpStepInstance` (the audit trail). Generic — "Worker Data Change" is just one definition; the engine has no special-cased logic for it.
- **Planning:** `Scenario` holds a JSON assumption set (hire plan, attrition, merit) — no separate projection table; projections are computed on read from the current snapshot + assumptions.

**A worker has no `managerId` column.** Management is derived structurally: a worker's manager is the `managerId` of the `SupervisoryOrg` that their current `Position.supOrgId` points to. This mirrors Workday's position-based staffing model rather than a flat "manager field" — see `lib/snapshot.ts`.

**Single source of truth for current state:** every view (dashboard, planning baseline, payroll) calls `getWorkforceSnapshot(asOfDate)` in `lib/snapshot.ts`, which derives department/location/level/comp from the latest `PositionAssignment` + `CompRecord` as of a given date. This is also what makes the worker detail page's historical timeline and the dashboard's 13-month trend chart possible — same function, different `asOf` date.

### Why SQLite locally, not Postgres

No Supabase/Vercel account existed at the start of this build, so local dev runs entirely on a file-based SQLite database — zero setup, zero external dependency, fully reproducible. The tradeoff: SQLite's Prisma connector has no native `enum` or `Json` column type, so those columns are `String` in `schema.prisma`, with `lib/enums.ts` as the single TypeScript source of truth for allowed values (validated via zod at every write boundary — the BP engine and payroll/planning code never accept an unvalidated string). `prisma/POSTGRES_MIGRATION.md` documents the exact, mechanical swap to Supabase Postgres for deployment — no application logic changes, only the schema's column types and two `JSON.parse`/`JSON.stringify` call sites.

### Tech stack

- **Next.js 14 (App Router, TypeScript, strict mode)** — server components fetch data directly (no separate API layer for reads); mutations use Server Actions (`lib/actions.ts`) for the BP engine and scenario creation, plus one real API route (`/api/ask`) for the streaming-tool-loop AI feature.
- **Prisma ORM** over SQLite locally / Postgres in production.
- **decimal.js** for all money math server-side — salaries and payroll figures are never floated.
- **Recharts** for the headcount trend, department×level breakdown, projection, and scenario-comparison charts.
- **Tailwind CSS** with hand-rolled shadcn-style primitives (`components/ui.tsx`) — no CLI scaffolding tool was available in the build environment, so these are written directly rather than generated.
- **Anthropic API (`@anthropic-ai/sdk`)** for the NL query feature.
- No auth, no RLS, no multi-tenancy (explicitly out of scope). RBAC is mocked with a persona switcher in the top bar (cookie-persisted `persona` + `workerId`) that gates which BP inbox a user sees.

### Business process engine

`lib/bp-engine.ts` is generic: given a `BpDefinition`'s ordered `BpStep`s, `startWorkerDataChange()` resolves each step's assignee (`INITIATOR`, `MANAGER_OF_WORKER`, `SKIP_LEVEL_MANAGER`, `HR_PARTNER`, `COMP_PARTNER` — the latter two deterministically resolved to the most senior active G&A workers, standing in for Workday security groups) and evaluates any `conditionRule` (a tiny `field>value` expression evaluator — intentionally not a full JSON-logic engine, since the exercise needs exactly one condition: comp change >10% inserts a Comp Partner Review step; ≤10% renders it `SKIPPED_BY_RULE` in the audit trail so the routing itself is visible, not just its outcome).

`actOnStep()` enforces strict sequential gating — only the earliest unresolved step in an instance is actionable, and only by its resolved assignee — then advances the instance. When the final "Complete" step is reached it auto-executes: it closes the current `CompRecord`/`PositionAssignment` (sets `effectiveTo`) and opens a new one, writes a `WorkerEvent`, and marks the instance `COMPLETED`. Deny or send-back requires a comment and halts the instance (`DENIED` / `CANCELED` respectively).

### Payroll

`lib/payroll.ts` computes one semi-monthly period at a time: gross = current annual salary / 24 (local currency), converted to USD via the fixed `FxRate` table for rollups. Employer burden is a per-country strategy function implementing the exercise's stated approximations (US FICA + a wage-base-aware SUI/FUTA approximation for current-year hires; UK NI above the semi-monthly secondary threshold; Canada blended CPP+EI; India employer PF on assumed 50%-basic) plus a flat benefits load (10% US / 5% international). The same `computeBurden()` function is reused by the workforce planning projection, so payroll and planning numbers are built on the same math.

**Reconciliation** compares active worker count, total worker records (including historical terminations), and actual payroll headcount, with every excluded or flagged worker named and reasoned (contractor, unpaid leave, termination-pending, mid-period-hire proration).

**Anomaly detection** flags (a) any worker whose current-period gross deviates >10% from a reconstructed trailing-3-period average (using actual `CompRecord` history — most workers show 0% since nothing changed, which is correct, not a bug), and (b) any department whose total burdened cost deviates >5% from the prior period (driven by real headcount/comp changes in the seed data).

**GL posting** produces one journal entry per department × account (6000 Wages, 6100 Employer Taxes, 6200 Benefits as debits) with a single 2100 Accrued Payroll credit, and a balance check.

### Workforce planning

`lib/planning.ts` projects 12 months forward from the real current-state snapshot. Baseline cost-per-worker per department is computed from the *actual* payroll burden functions (not a flat estimate), so the starting point ties to payroll. Forward-looking hires use a flat 1.18× burden multiplier on the target level's band midpoint — projecting the exact future country mix of not-yet-hired workers isn't meaningful, so this is a documented simplification distinct from the precise, per-country payroll engine. Attrition is applied monthly as `annualRate/12` against the department's current (shrinking) headcount — deterministic expected-value math, no random draws, as specified. Merit is applied once, in the month matching each scenario's `meritEffectiveDate`, as a headcount-weighted blend of the scenario's per-level merit rates against the department's actual level mix.

### AI feature: NL query (`/ask`)

Tool-use, not text-to-SQL — the model never sees or generates SQL. `lib/ai-tools.ts` defines five zod-validated tools (`query_workers`, `get_headcount_summary`, `get_comp_vs_band`, `get_attrition`, `draft_document`); the server executes them against Prisma/the snapshot helper and returns structured JSON. `app/api/ask/route.ts` runs the standard Anthropic tool-use loop (call → tool_use → execute → tool_result → call again), capped at 4 rounds.

**Guardrails:**
- Server-side only — the API key is never sent to the client.
- Tool allow-list with zod parameter validation; the model cannot call anything outside the five defined tools.
- System prompt instructs the model to answer only from tool results, to prefer aggregate/department-level answers, and to explicitly refuse to speculate about an individual's attrition risk, performance, or personal circumstances (no ungoverned individual-level inference).
- `draft_document` returns facts only — the model composes the draft, which must be prefixed "DRAFT — for review, not final"; the tool itself has no write/send side effects.
- Basic in-memory rate limiting (documented as a demo-grade guardrail, not production-grade — a real deployment would use per-user limits backed by Redis or similar, plus real authN/Z).
- Graceful degradation: absent `ANTHROPIC_API_KEY` returns a clear 503 message rather than a crash, so the rest of the app is fully demoable without the key.

## Data assumptions

The provided sample (E0001–E0010, E0148, E0149) is included verbatim, wired into the generated org tree exactly as given (E0001/E0005/E0007/E0010 anchor the four department trees; E0002, E0006, E0008/E0009, E0149 report as specified; E0148 and E0149 carry their given non-Active statuses). Everything else is generated deterministically (`prisma/seed.ts`, RNG seed `neocloud-42`):

- **Department mix:** GPU Cloud 30% (105), On-Prem 15% (53), Engineering 40% (139), G&A 15% (53) of 350.
- **Locations:** SF/SJ/Remote-US ≈75% (US), Toronto ≈8% (CA), London ≈8% (GB), Bangalore ≈9% (IN).
- **Org tree:** random-attachment tree growth within each department, rooted at that department's head, who reports to the CEO (`E0000`, a synthetic placeholder not counted toward the ~350). Every worker's manager chain resolves to `E0000`. Management level is assigned independently of tree depth for the generated population (an IC can have direct reports, as the sample data itself does for E0002 and E0007) — this is a synthetic-data simplification, documented here rather than hidden.
- **Levels:** weighted pyramid across IC1–IC7/M3–M6, heaviest at IC2–IC4.
- **Comp:** drawn per level/country band; ~10% of workers deliberately land below band midpoint and ~3% above band max (feeds the anomaly/NL-query demos). ~10% of eligible current workers (tenure >240 days, non-sample) also get a second, more recent `CompRecord` (a past MERIT increase) to populate the effective-dated history timeline and, for a few landing inside the trailing-3-period window, the payroll anomaly detector.
- **Non-Active population (current roster):** ~92% Active, ~4% On Leave, ~1% Termination Pending, ~3% Contractor.
- **Historical terminations:** ~30 *additional* worker records (beyond the current ~350) with a `TERMINATION` event in the trailing 12 months — these drive the headcount trend chart's upward movement and the trailing-12-month attrition KPI. Their positions are closed, not backfilled, in seed data.
- **Trailing-12-month hires:** ~25 of the current population hired within the last 365 days (probabilistic target, not exact).
- **Open positions:** 15 unfilled `Position` rows (feeds the "open reqs" KPI).
- **FX rates (fixed, demo-only):** GBP→USD 1.27, CAD→USD 0.73, INR→USD 0.012.

Run `npm run db:seed` and read the printed summary table for the exact realized distribution (target vs. actual will differ slightly due to randomness — that's expected).

## Workday concept mapping

| This app | Workday equivalent |
|---|---|
| `SupervisoryOrg` tree | Supervisory Organizations |
| `Position` + `PositionAssignment` | Position Management staffing model |
| `JobProfile` + `CompBand` | Job Profiles + Compensation Grades/Grade Profiles |
| `WorkerEvent` (effective-dated) | Effective-dated transactions / Worker History |
| `BpDefinition` / `BpStep` / `conditionRule` | Business Process Definitions + Condition Rules |
| `BpStepInstance` | Process History / audit trail |
| `assigneeRule` roles (`MANAGER_OF_WORKER`, `HR_PARTNER`, ...) | Routing to Security Groups |
| `Scenario` | Adaptive Planning / Workforce Planning scenario |
| `getWorkforceSnapshot(asOf)` | Point-in-time ("as of") reporting |
| Persona switcher | Mocked Workday security-group-based access |

## AI/ML approach & rationale

NL query (tool-use) was chosen over the other options in the exercise (payroll anomaly detection is also implemented, as a second, lighter-weight capability) because it's the highest-leverage demo of "AI that respects a data boundary" — the model composes answers and drafts, but every fact comes from a typed, server-validated tool call against real data, never from the model's own guess or a raw SQL string it wrote. That tool-use-not-text-to-SQL pattern is also the one most directly transferable to a real Workday environment, where you'd never want an LLM writing queries against a live HCM database.

## Known limitations

- Attrition % is an approximation (terminations in a window ÷ current headcount, annualized) — not a true cohort/rolling survival calculation.
- The BP engine's `conditionRule` evaluator handles simple `field>value` comparisons only, sufficient for this exercise's one branching rule — not a general JSON-logic engine.
- Workforce planning's forward-hire cost uses a flat burden multiplier rather than projecting exact future country mix (see "Workforce planning" above).
- No auth/RBAC — the persona switcher is a UI-level convenience, not a security boundary.
- The in-memory AI rate limiter resets on server restart and is per-process, not per-user.
- Payroll tax math is intentionally approximate per the exercise's own instructions ("not testing payroll tax minutiae").
- SQLite locally means no native DB-level enum/JSON enforcement — correctness relies on the zod validation layer instead (see "Why SQLite locally").

## What I'd do differently with more time

- Real Postgres from day one (once accounts existed) to avoid the SQLite enum/Json workaround entirely.
- A structured (non-JSON-textarea) scenario assumption editor for workforce planning, with inline validation and a hire-plan row builder instead of raw JSON.
- Promotion-specific BP handling (level + position change, not just comp) as a distinct proposed-change shape.
- A real queueing/notification layer for BP approvals instead of a polling inbox.
- Cohort-based attrition and a proper wage-base ledger (cumulative YTD wages per worker) instead of the current-period approximation.
- Automated tests around the payroll burden functions and BP conditional routing (the highest-risk business logic) — not included here given the exercise's 5-day scope, but `lib/payroll.ts` and `lib/bp-engine.ts` are written as pure/testable functions specifically so this would be straightforward to add.

## Translating this to a real Workday implementation

**Tenant design.** A real deployment would start from Workday's standard tenant structure: one production tenant plus sandbox/preview tenants for testing configuration and BP changes before promotion. NeoCloud's four departments map directly to top-level Supervisory Organizations, with sub-orgs mirroring the manager tree this app generates. Position Management (not headcount-only) would be enabled from day one, matching this app's position-first design.

**Security model.** The persona switcher here stands in for Workday Security Groups. A real rollout would define role-based security groups (Manager, HR Partner, Comp Partner, HR Business Partner, Payroll Admin) with domain security policies scoped by Supervisory Org — e.g., a Manager's access is constrained to their own org's workers via "Manager" unconstrained/constrained security group inheritance, and Comp Partner access to compensation data would sit behind Workday's Compensation domain security policies specifically, not just general HR data access.

**Business process configuration.** The `BpDefinition`/`BpStep`/`conditionRule` engine here is a deliberate miniature of Workday's BP framework. In Workday, "Worker Data Change" would actually be several distinct BPs (Request Compensation Change, Request Transfer/Move, Change Job) each with their own step chain, condition rules (built with Workday's calculated fields / condition rule editor rather than a hand-rolled expression parser), and notification templates. Conditional routing (Comp Partner review >10%) becomes a Workday condition rule referencing a calculated field comparing proposed vs. current compensation.

**Integration layer.** Real integrations would use Workday Studio for complex transformation logic, Core Connectors for standard outbound feeds (benefits carriers, payroll if using a third-party payroll provider), and Workday RaaS (Report-as-a-Service) or the Workday REST/SOAP APIs for the kind of read-heavy "current state" queries this app's `getWorkforceSnapshot()` performs — in production that becomes a scheduled RaaS report or a direct API integration rather than a live join across normalized tables.

**Payroll go-live.** Workday Payroll (or a third-party payroll integration) would go live via parallel testing: run the legacy system (Rippling, per the exercise's premise) and Workday side-by-side for at least 2-3 pay cycles, reconciling gross-to-net and GL postings line by line before cutover. This app's reconciliation panel (active vs. payroll headcount, named deltas) is exactly the kind of check that parallel testing formalizes and audits.

**SOX controls.** Once payroll and compensation changes flow through Workday, SOX ITGC controls apply: segregation of duties (the initiator of a comp change BP cannot also be its final approver — this app's engine already enforces "not yet your turn" sequential gating, which is the same principle), change management controls on BP configuration changes (tracked, approved, tested in sandbox before tenant promotion), and access reviews on security group membership (particularly Payroll Admin and Comp Partner groups). The full audit trail this app's `BpStepInstance` table provides (who, what, when, on every step including skips) is the same evidence a SOX auditor would expect from Workday's Process History.
