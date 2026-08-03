# NeoCloud People OS

A lightweight People operations & workforce planning app built for a People Systems Lead take-home exercise. It simulates HRIS workflows for NeoCloud Inc., a fictional ~350-person GPU cloud company preparing for IPO, and mirrors Workday's data and process concepts throughout.

**Live URL:** https://neo-cloud.vercel.app · **Repo:** https://github.com/biloni/NeoCloud

For deeper detail than fits here — the full Workday concept-mapping table, complete AI guardrail rationale, and "what I'd do differently"/production-translation notes — see [`ARCHITECTURE.md`](ARCHITECTURE.md). The RBAC design lives in [`security/README.md`](security/README.md); adversarial QA findings and fixes in [`QA_REPORT.md`](QA_REPORT.md).

## Setup

Prerequisites: Node.js 18+.

```bash
npm install
cp .env.example .env      # already present locally with SQLite defaults
npm run db:push           # create prisma/dev.db from schema.prisma
npm run db:seed           # generate the deterministic ~350-worker dataset
npm run dev                # http://localhost:3000
```

Reset + reseed from scratch: `npm run db:reset`. To enable the AI assistant (`/ask`), set `ANTHROPIC_API_KEY` in `.env` — without it the app loads normally and returns a clear "not configured" message instead of crashing.

**Deploying:** local dev uses SQLite so the app runs with zero external accounts. Before deploying, follow `prisma/POSTGRES_MIGRATION.md` to swap the datasource to Supabase Postgres, then deploy to Vercel with `DATABASE_URL`, `DIRECT_URL`, and `ANTHROPIC_API_KEY` set.

## Architecture decisions

**Effective-dating, everywhere.** Dimensions (`Worker`, `SupervisoryOrg`, `JobProfile`, `Position`, ...) never carry history; state changes live in `PositionAssignment`/`CompRecord` (`effectiveFrom`/`effectiveTo`, `null` = current) and the append-only `WorkerEvent` log. Nothing is mutated in place — a change closes the current record and opens a new one. A worker has **no `managerId` column**: management is derived from `Position.supOrgId` → `SupervisoryOrg.managerId`, mirroring Workday's position-based staffing model rather than a flat manager field. Every view (dashboard, planning, payroll) reads through one function, `getWorkforceSnapshot(asOfDate)`, so numbers can't disagree with each other.

**Generic business process engine.** `BpDefinition → BpStep (+conditionRule) → BpInstance → BpStepInstance` is not special-cased to comp changes — "Worker Data Change" and "Profile Change Request" are just two definitions running on the same engine, with the same sequential-gating and audit trail. Conditional routing (Comp Partner review only above a 10% comp change) renders as `SKIPPED_BY_RULE` when it doesn't apply, so the routing logic itself is visible, not just its outcome.

**RBAC, not just a persona label.** Nine roles (Employee → Super Admin), additive permissions, and a separate `DataScope` layer (self / team / org-subtree / everyone) so "can you see this feature" and "which specific worker rows can you touch" are independent questions — the same separation that makes a Manager's dashboard, inbox, and worker-directory reach all agree with each other automatically.

**AI assistant is tool-use, not text-to-SQL.** Seven zod-validated tools; the model never sees or writes SQL. The actual anti-hallucination mechanism is structural: the model must call a terminal `provide_answer({answer, confidence, citations[]})` tool as its last action instead of ever replying in free text, so every answer carries a machine-checked confidence level and source list — not something hoped for in prose. Tool access is scoped per role (an Employee's assistant never offers `draft_document`), and it's available to every persona, not just Exec/Admin.

**SQLite locally, Postgres in production.** No Supabase/Vercel account existed at the start of this build, so local dev runs on file-based SQLite — zero setup, fully reproducible. Tradeoff: no native `enum`/`Json` columns, so those are `String` in `schema.prisma` with `lib/enums.ts` as the single TypeScript source of truth, validated via zod at every write. `prisma/POSTGRES_MIGRATION.md` documents the mechanical swap — no application logic changes.

**Stack:** Next.js 14 (App Router, strict TypeScript, Server Components + Server Actions), Prisma, `decimal.js` for all money math (never floats), Recharts, hand-rolled Tailwind primitives (no CLI scaffolding available in-build), Anthropic API for the AI feature.

## Assumptions made

The provided sample workers (E0001–E0010, E0148, E0149) are included verbatim, wired into the generated org tree exactly as given. Everything else is generated deterministically (`prisma/seed.ts`, fixed RNG seed):

- **Departments:** GPU Cloud 30%, On-Prem 15%, Engineering 40%, G&A 15% of ~350.
- **Locations:** SF/SJ/Remote-US ≈75%, Toronto ≈8%, London ≈8%, Bangalore ≈9%.
- **Org tree:** random-attachment growth within each department, rooted at a department head who reports to a synthetic CEO placeholder (`E0000`, not counted toward the ~350). Level is assigned independently of tree depth (an IC can have direct reports, matching the sample data itself) — a documented synthetic-data simplification.
- **Levels:** weighted pyramid, IC1–IC7/M3–M6, heaviest at IC2–IC4.
- **Comp:** drawn per level/country band; ~10% deliberately land below band midpoint, ~3% above band max, to feed the anomaly detector and NL-query demos.
- **Status mix:** ~92% Active, ~4% On Leave, ~1% Termination Pending, ~3% Contractor, plus ~30 historical terminations in the trailing 12 months (positions closed, not backfilled) to drive the attrition KPI and trend chart.
- **Hiring/reqs:** ~25 of the current population hired in the trailing 12 months; 15 open, unfilled positions.
- **FX rates are fixed, demo-only:** GBP→USD 1.27, CAD→USD 0.73, INR→USD 0.012.
- **No real authentication.** RBAC is fully modeled (permissions, data scope, proxy/impersonation) but identity is a cookie-based persona switcher, not a login system — explicitly out of scope for this exercise.

Run `npm run db:seed` and read the printed summary for the exact realized distribution (randomness means target vs. actual differs slightly — expected).

## Known limitations

- Attrition % is an approximation (terminations in a window ÷ current headcount, annualized), not a true cohort/survival calculation.
- The BP engine's `conditionRule` evaluator handles simple `field>value` comparisons only — sufficient for this exercise's one branching rule, not a general JSON-logic engine.
- Workforce planning's forward-hire cost uses a flat burden multiplier rather than projecting exact future country mix.
- No real authentication/session security — the persona switcher is a UI-level convenience, not a production security boundary.
- The in-memory AI rate limiter resets on server restart and is per-process, not backed by a shared store.
- Payroll tax math is intentionally approximate, per the exercise's own scope.
- SQLite locally means no native DB-level enum/JSON enforcement — correctness relies on the zod validation layer instead.
