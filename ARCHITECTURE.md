# Architecture Deep-Dive

Extended reference material that didn't fit the 2-page `README.md`. See also [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md), [`security/README.md`](security/README.md) (RBAC), and [`prisma/POSTGRES_MIGRATION.md`](prisma/POSTGRES_MIGRATION.md).

## Business process engine

`lib/bp-engine.ts` is generic: given a `BpDefinition`'s ordered `BpStep`s, `startWorkerDataChange()` resolves each step's assignee (`INITIATOR`, `MANAGER_OF_WORKER`, `SKIP_LEVEL_MANAGER`, `HR_PARTNER`, `COMP_PARTNER`) and evaluates any `conditionRule` — a tiny `field>value` expression evaluator, sufficient for this exercise's one branching rule (comp change >10% inserts a Comp Partner Review step; ≤10% renders it `SKIPPED_BY_RULE` in the audit trail so the routing itself is visible). `HR_PARTNER` and `COMP_PARTNER` resolve to the RBAC system's fixed role assignees (`security/roles.ts`), not an org-seniority guess — every routable step lands on a worker reachable through the persona switcher.

`actOnStep()` enforces strict sequential gating — only the earliest unresolved step is actionable, only by its resolved assignee. The final "Complete" step auto-executes: closes the current `CompRecord`/`PositionAssignment`, opens a new one, writes a `WorkerEvent`, marks the instance `COMPLETED`. The same engine also runs the Profile Change Request flow (legal/preferred name corrections), applying the change to the `Worker` record on approval, not just logging that it happened.

## Payroll

`lib/payroll.ts` computes one semi-monthly period: gross = annual salary / 24, converted to USD via `FxRate`. Employer burden is a per-country strategy function (US FICA + wage-base-aware SUI/FUTA; UK NI; Canada CPP+EI; India employer PF) plus a flat benefits load. The same `computeBurden()` is reused by workforce planning, so payroll and planning numbers tie out. Reconciliation names every excluded/flagged worker and why. Anomaly detection flags >10% gross deviation from a trailing-3-period average and >5% department cost deviation. GL posting produces one journal entry per department × account, balance-checked.

## Workforce planning

`lib/planning.ts` projects 12 months forward from the real current snapshot, using the actual payroll burden functions for the starting point. Forward hires use a flat 1.18× burden multiplier (projecting exact future country mix isn't meaningful). Attrition applies monthly as `annualRate/12` against current headcount — deterministic, no random draws. Merit applies once, at the scenario's `meritEffectiveDate`, headcount-weighted by actual level mix.

## AI feature — full guardrail detail

Tool-use, not text-to-SQL: `lib/ai-tools.ts` defines six zod-validated tools; the model never sees or writes SQL.

**Structured output is the real anti-hallucination mechanism.** The system prompt is split into labeled sections (`ROLE`/`DATA ACCESS`/`GUARDRAILS`/`RESPONSE PROTOCOL`) instead of one paragraph. The model must call a terminal `provide_answer({ answer, confidence, confidenceReason, citations[] })` tool as its last action — never plain text. Citing tool results is a required schema field, not something hoped for in prose. `confidence` is self-reported (`high`/`medium`/`low`) and shown as a color-coded badge; `citations` renders as an expandable sources list. If the model ignores the protocol, the route still surfaces the text but forces `confidence: "low"` with no citations.

**Per-role scoping:** `ROLE_TOOL_ACCESS` maps each of the 9 roles to its relevant tool subset (an Employee's assistant never offers `draft_document`; Payroll Admin gets `get_comp_vs_band` but not `draft_document`), unioned across a worker's held roles. The `ROLE` section of the prompt also gets a one-sentence per-role framing; `GUARDRAILS`/`RESPONSE PROTOCOL` stay identical across every role — framing changes tone, never what the model is allowed to claim.

**Other guardrails:** server-side only (key never sent to client); tool allow-list with zod validation; explicit instruction to answer only from tool results, prefer aggregate answers, and refuse to speculate about individual attrition risk/performance; `draft_document` returns facts only, model composes a DRAFT with no send/save side effects; per-worker rate limiting (20/min); graceful 503 if `ANTHROPIC_API_KEY` is absent.

**Responsible-use tradeoff:** opening this org-wide (not just Exec/Admin) means any employee can ask about named individuals via the same tools HR uses. A real rollout would scope `query_workers`/`get_comp_vs_band` to self-and-reports for non-HR roles (the same `DataScope` layer already used elsewhere) and log every query for audit. The individual-risk-inference refusal applies regardless of role.

## Workday concept mapping

| This app | Workday equivalent |
|---|---|
| `SupervisoryOrg` tree | Supervisory Organizations |
| `Position` + `PositionAssignment` | Position Management staffing model |
| `JobProfile` + `CompBand` | Job Profiles + Compensation Grades/Grade Profiles |
| `WorkerEvent` (effective-dated) | Effective-dated transactions / Worker History |
| `BpDefinition` / `BpStep` / `conditionRule` | Business Process Definitions + Condition Rules |
| `BpStepInstance` | Process History / audit trail |
| `assigneeRule` roles | Routing to Security Groups |
| `Scenario` | Adaptive Planning / Workforce Planning scenario |
| `getWorkforceSnapshot(asOf)` | Point-in-time ("as of") reporting |
| RBAC persona switcher | Workday Security Groups |

## What I'd do differently with more time

- Real Postgres from day one, avoiding the SQLite enum/Json workaround entirely.
- A structured scenario assumption editor (hire-plan row builder) instead of raw JSON.
- Promotion-specific BP handling (level + position change, not just comp).
- A real queueing/notification layer for BP approvals instead of a polling inbox.
- Cohort-based attrition and a proper cumulative wage-base ledger.
- Automated tests around payroll burden math and BP conditional routing — the highest-risk business logic, written as pure/testable functions specifically so this would be straightforward to add.

## Translating this to a real Workday implementation

**Tenant design.** Production tenant + sandbox/preview tenants for testing BP changes before promotion. NeoCloud's four departments map to top-level Supervisory Organizations. Position Management (not headcount-only) enabled from day one.

**Security model.** The persona switcher stands in for Workday Security Groups. A real rollout defines role-based security groups with domain security policies scoped by Supervisory Org — a Manager's access constrained via constrained/unconstrained security group inheritance; Comp Partner access sits behind Workday's Compensation domain security policies specifically.

**Business process configuration.** "Worker Data Change" here is a deliberate miniature of several real Workday BPs (Request Compensation Change, Request Transfer, Change Job), each with its own step chain and Workday condition rules (calculated fields, not a hand-rolled parser).

**Integration layer.** Workday Studio for complex transformations, Core Connectors for standard outbound feeds, Workday RaaS or REST/SOAP APIs for the read-heavy "current state" queries `getWorkforceSnapshot()` performs today via live joins.

**Payroll go-live.** Parallel testing — legacy system and Workday side-by-side for 2-3 pay cycles, reconciling gross-to-net and GL postings line by line. This app's reconciliation panel is exactly that kind of check, formalized.

**SOX controls.** Segregation of duties (this app's engine already enforces "not yet your turn" sequential gating — the initiator can't also be the final approver); change management on BP configuration; access reviews on security group membership. `BpStepInstance`'s full audit trail (who, what, when, including skips) is the evidence a SOX auditor expects from Process History.
