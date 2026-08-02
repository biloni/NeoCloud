// Tool-use pattern for the NL query feature: the model NEVER sees or
// writes SQL. It calls one of these typed, zod-validated tools; the server
// executes it against Prisma/snapshot data and returns structured JSON.
// See CLAUDE.md "AI feature" and the guardrails section in README.md.
import { z } from "zod";
import { prisma } from "./prisma";
import { getWorkforceSnapshot } from "./snapshot";
import { getOrgChartView } from "./orgchart";
import { LEVEL_ORDER } from "./reference-data";
import { Role, primaryRole } from "@/security/roles";

/** Resolve a worker by ID (E0042) or a case-insensitive substring of their legal name — the model is far more likely to be given a name than an ID. */
async function resolveWorkerId(idOrName: string): Promise<{ workerId: string; matches: number } | null> {
  const snapshot = await getWorkforceSnapshot();
  const asId = idOrName.trim().toUpperCase();
  const byId = snapshot.find((r) => r.workerId === asId);
  if (byId) return { workerId: byId.workerId, matches: 1 };
  const needle = idOrName.trim().toLowerCase();
  const nameMatches = snapshot.filter((r) => r.legalName.toLowerCase().includes(needle));
  if (nameMatches.length === 0) return null;
  return { workerId: nameMatches[0].workerId, matches: nameMatches.length };
}

const QueryWorkersInput = z.object({
  department: z.string().optional().describe("Filter by department name, e.g. 'Engineering'"),
  location: z.string().optional().describe("Filter by location name or id, e.g. 'SF' or 'San Francisco'"),
  level: z.string().optional().describe("Filter by level code, e.g. 'IC4'"),
  status: z.string().optional().describe("Filter by status: ACTIVE, ON_LEAVE, TERMINATION_PENDING, CONTRACTOR"),
  hiredAfter: z.string().optional().describe("ISO date (YYYY-MM-DD) — only workers hired on or after this date"),
  hiredBefore: z.string().optional().describe("ISO date (YYYY-MM-DD) — only workers hired on or before this date"),
  compBelowBandMidpoint: z.boolean().optional().describe("If true, only return workers whose current comp is below their job profile's band midpoint for their country"),
  limit: z.number().int().positive().max(100).optional(),
});

async function queryWorkers(input: z.infer<typeof QueryWorkersInput>) {
  const snapshot = (await getWorkforceSnapshot()).filter((r) => r.status !== "TERMINATED");
  const bands = await prisma.compBand.findMany();
  let rows = snapshot;
  if (input.department) rows = rows.filter((r) => r.department.toLowerCase() === input.department!.toLowerCase());
  if (input.location) rows = rows.filter((r) => r.locationName.toLowerCase().includes(input.location!.toLowerCase()) || r.locationId.toLowerCase() === input.location!.toLowerCase());
  if (input.level) rows = rows.filter((r) => r.level.toLowerCase() === input.level!.toLowerCase());
  if (input.status) rows = rows.filter((r) => r.status === input.status!.toUpperCase());
  if (input.hiredAfter) rows = rows.filter((r) => r.hireDate >= new Date(input.hiredAfter!));
  if (input.hiredBefore) rows = rows.filter((r) => r.hireDate <= new Date(input.hiredBefore!));
  if (input.compBelowBandMidpoint) {
    rows = rows.filter((r) => {
      const band = bands.find((b) => b.jobProfileId === `JP-${r.level}` && b.countryCode === r.countryCode);
      return band ? r.annualSalaryLocal < Number(band.bandMid) : false;
    });
  }
  const limit = input.limit ?? 50;
  const limited = rows.slice(0, limit);
  return {
    matchCount: rows.length,
    returnedCount: limited.length,
    workers: limited.map((r) => ({
      workerId: r.workerId, legalName: r.legalName, department: r.department, location: r.locationName,
      level: r.level, status: r.status, managerName: r.managerName,
      hireDate: r.hireDate.toISOString().slice(0, 10),
      annualSalaryLocal: r.annualSalaryLocal, currency: r.currency, annualSalaryUsd: Math.round(r.annualSalaryUsd),
    })),
  };
}

const HeadcountSummaryInput = z.object({
  groupBy: z.enum(["department", "location", "level", "status"]),
});
async function getHeadcountSummary(input: z.infer<typeof HeadcountSummaryInput>) {
  const snapshot = (await getWorkforceSnapshot()).filter((r) => r.status !== "TERMINATED");
  const keyFn: Record<string, (r: (typeof snapshot)[number]) => string> = {
    department: (r) => r.department, location: (r) => r.locationName, level: (r) => r.level, status: (r) => r.status,
  };
  const fn = keyFn[input.groupBy];
  const breakdown: Record<string, number> = {};
  for (const r of snapshot) breakdown[fn(r)] = (breakdown[fn(r)] ?? 0) + 1;
  return { groupBy: input.groupBy, totalHeadcount: snapshot.length, breakdown };
}

const CompVsBandInput = z.object({
  department: z.string().optional(),
  level: z.string().optional(),
});
async function getCompVsBand(input: z.infer<typeof CompVsBandInput>) {
  const snapshot = (await getWorkforceSnapshot()).filter((r) => r.status !== "TERMINATED");
  const bands = await prisma.compBand.findMany();
  let rows = snapshot;
  if (input.department) rows = rows.filter((r) => r.department.toLowerCase() === input.department!.toLowerCase());
  if (input.level) rows = rows.filter((r) => r.level.toLowerCase() === input.level!.toLowerCase());

  const groups: Record<string, { level: string; countryCode: string; count: number; totalLocal: number; belowMid: number; aboveMax: number; bandMin: number; bandMid: number; bandMax: number; currency: string }> = {};
  for (const r of rows) {
    const key = `${r.level}|${r.countryCode}`;
    const band = bands.find((b) => b.jobProfileId === `JP-${r.level}` && b.countryCode === r.countryCode);
    if (!band) continue;
    if (!groups[key]) {
      groups[key] = { level: r.level, countryCode: r.countryCode, count: 0, totalLocal: 0, belowMid: 0, aboveMax: 0, bandMin: Number(band.bandMin), bandMid: Number(band.bandMid), bandMax: Number(band.bandMax), currency: band.currency };
    }
    groups[key].count++;
    groups[key].totalLocal += r.annualSalaryLocal;
    if (r.annualSalaryLocal < Number(band.bandMid)) groups[key].belowMid++;
    if (r.annualSalaryLocal > Number(band.bandMax)) groups[key].aboveMax++;
  }
  return {
    breakdown: Object.values(groups).map((g) => ({
      level: g.level, countryCode: g.countryCode, currency: g.currency, headcount: g.count,
      avgActual: Math.round(g.totalLocal / g.count), bandMin: g.bandMin, bandMid: g.bandMid, bandMax: g.bandMax,
      countBelowMidpoint: g.belowMid, countAboveMax: g.aboveMax,
    })),
  };
}

const AttritionInput = z.object({
  periodMonths: z.number().int().positive().max(36).default(12).describe("Trailing window in months, default 12"),
});
async function getAttrition(input: z.infer<typeof AttritionInput>) {
  const today = new Date();
  const since = new Date(today);
  since.setMonth(since.getMonth() - input.periodMonths);
  const terminations = await prisma.workerEvent.count({
    where: { type: "TERMINATION", effectiveDate: { gte: since, lte: today } },
  });
  const snapshot = (await getWorkforceSnapshot()).filter((r) => r.status !== "TERMINATED");
  const currentHeadcount = snapshot.length;

  return {
    periodMonths: input.periodMonths,
    terminationCount: terminations,
    currentHeadcount,
    annualizedAttritionPct: currentHeadcount ? Number(((terminations / currentHeadcount) * (12 / input.periodMonths) * 100).toFixed(1)) : 0,
    note: "Attrition % is terminations in the window divided by current headcount, annualized — an approximation, not a true cohort survival rate.",
  };
}

const DraftDocumentInput = z.object({
  type: z.enum(["promotion_announcement", "offer_letter", "pip_notice"]),
  workerId: z.string().describe("The worker this document is about, e.g. E0004"),
  context: z.string().optional().describe("Any additional context to incorporate, e.g. new title, new salary, reason"),
});
async function draftDocumentContext(input: z.infer<typeof DraftDocumentInput>) {
  const snapshot = await getWorkforceSnapshot();
  const worker = snapshot.find((r) => r.workerId === input.workerId.toUpperCase());
  if (!worker) return { error: `Worker ${input.workerId} not found or not currently active. Cannot draft a document.` };
  return {
    type: input.type,
    worker: {
      workerId: worker.workerId, legalName: worker.legalName, department: worker.department,
      level: worker.level, location: worker.locationName, managerName: worker.managerName,
      tenureDays: worker.tenureDays, currentAnnualComp: worker.annualSalaryLocal, currency: worker.currency,
    },
    additionalContext: input.context ?? null,
    instruction: "This is factual context only. Compose the requested document as a clearly-labeled DRAFT. This tool has no side effects — nothing is sent or saved.",
  };
}

const OrgChartInput = z.object({
  worker: z.string().describe("A worker's ID (e.g. 'E0004') or legal name (e.g. 'Priya Shah'). If omitted, uses the CEO (E0000) as the top of the org."),
});
async function getOrgChart(input: z.infer<typeof OrgChartInput>) {
  const resolved = await resolveWorkerId(input.worker || "E0000");
  if (!resolved) return { error: `No active worker found matching "${input.worker}".` };
  const view = await getOrgChartView(resolved.workerId);
  if (!view) return { error: `Worker ${resolved.workerId} is not currently active.` };
  return {
    resolvedFrom: input.worker,
    nameMatchCount: resolved.matches,
    ambiguousMatch: resolved.matches > 1 ? "Multiple workers matched this name; showing the first. Ask for a worker ID if this isn't the right person." : null,
    center: view.center,
    reportingLine: view.managerChain.map((m) => `${m.legalName} (${m.workerId}, ${m.level})`),
    directReports: view.directReports.map((r) => ({ workerId: r.workerId, legalName: r.legalName, level: r.level, department: r.department, ownDirectReportCount: r.directReportCount })),
    directReportCount: view.directReports.length,
  };
}

export const TOOL_DEFINITIONS = [
  {
    name: "query_workers",
    description: "Search and filter the current workforce roster by department, location, level, status, hire date range, or whether comp is below the worker's band midpoint. Returns matching workers (capped at `limit`, default 50) plus the true total match count.",
    input_schema: {
      type: "object" as const,
      properties: {
        department: { type: "string" }, location: { type: "string" }, level: { type: "string" }, status: { type: "string" },
        hiredAfter: { type: "string", description: "ISO date YYYY-MM-DD" }, hiredBefore: { type: "string", description: "ISO date YYYY-MM-DD" },
        compBelowBandMidpoint: { type: "boolean" }, limit: { type: "number" },
      },
    },
  },
  {
    name: "get_headcount_summary",
    description: "Get current active headcount broken down by department, location, level, or status.",
    input_schema: { type: "object" as const, properties: { groupBy: { type: "string", enum: ["department", "location", "level", "status"] } }, required: ["groupBy"] },
  },
  {
    name: "get_comp_vs_band",
    description: "Compare actual compensation against comp bands (min/mid/max) by level and country, optionally filtered by department or level. Shows headcount below midpoint and above max.",
    input_schema: { type: "object" as const, properties: { department: { type: "string" }, level: { type: "string" } } },
  },
  {
    name: "get_attrition",
    description: "Get termination count and annualized attrition rate for a trailing window (default 12 months).",
    input_schema: { type: "object" as const, properties: { periodMonths: { type: "number" } } },
  },
  {
    name: "draft_document",
    description: "Fetch the factual context needed to draft an HR document (promotion announcement, offer letter, or PIP notice) about a specific worker. Does not generate the document itself — use the returned facts to compose a DRAFT in your response.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["promotion_announcement", "offer_letter", "pip_notice"] },
        workerId: { type: "string" }, context: { type: "string" },
      },
      required: ["type", "workerId"],
    },
  },
  {
    name: "get_org_chart",
    description: "Get a worker's position in the org: their full reporting line up to the CEO, and their direct reports. Use this for any org-chart question — 'who does X report to', 'who manages team Y', 'who are X's direct reports', 'how many people report to X'. Accepts a worker ID or a legal name.",
    input_schema: {
      type: "object" as const,
      properties: { worker: { type: "string", description: "Worker ID (e.g. E0004) or legal name" } },
      required: ["worker"],
    },
  },
];

/**
 * Per-role tool scoping — the AI copilot for each persona gets the toolbox
 * appropriate to their job, not the full set by default. Additive across a
 * worker's held roles (a Manager who is also HR Partner gets the union),
 * matching how every other permission in this app composes. This is a
 * *purpose* scope, not a data-access scope — it doesn't restrict which rows
 * a tool can return (that's the documented, separate tradeoff in README.md
 * "Responsible use"); it restricts which *capabilities* a role's assistant
 * offers, the same way a real product wouldn't show a Payroll Admin a
 * "draft a promotion announcement" button.
 */
const ROLE_TOOL_ACCESS: Record<Role, string[]> = {
  [Role.EMPLOYEE]: ["query_workers", "get_org_chart", "get_headcount_summary"],
  [Role.MANAGER]: ["query_workers", "get_org_chart", "get_headcount_summary", "get_comp_vs_band", "get_attrition", "draft_document"],
  [Role.SKIP_LEVEL_MANAGER]: ["query_workers", "get_org_chart", "get_headcount_summary", "get_comp_vs_band", "get_attrition", "draft_document"],
  [Role.HR_OPS]: ["query_workers", "get_org_chart", "get_headcount_summary", "draft_document"],
  [Role.HR_PARTNER]: ["query_workers", "get_org_chart", "get_headcount_summary", "get_comp_vs_band", "get_attrition", "draft_document"],
  [Role.FINANCE_PLANNER]: ["query_workers", "get_org_chart", "get_headcount_summary", "get_comp_vs_band", "get_attrition"],
  [Role.PAYROLL_ADMIN]: ["query_workers", "get_org_chart", "get_headcount_summary", "get_comp_vs_band"],
  [Role.EXECUTIVE]: ["query_workers", "get_org_chart", "get_headcount_summary", "get_comp_vs_band", "get_attrition", "draft_document"],
  [Role.SUPER_ADMIN]: TOOL_DEFINITIONS.map((t) => t.name),
};

/** The union of tools every held role grants, resolved to full tool definitions. provide_answer is added separately by the caller — it's not a data tool. */
export function getToolsForRoles(roles: Role[]): typeof TOOL_DEFINITIONS {
  const allowed = new Set<string>();
  for (const role of roles) for (const name of ROLE_TOOL_ACCESS[role] ?? []) allowed.add(name);
  return TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
}

/**
 * Per-role persona configuration for Ask People OS — framing sentence and
 * suggested example prompts, co-located with ROLE_TOOL_ACCESS above so the
 * three always move together. A framing sentence or example prompt that
 * implies a capability the role's toolbox doesn't grant (e.g. suggesting
 * "draft a PIP notice" to a role without draft_document) would be a
 * regression, not a style choice — every entry below is checked against
 * ROLE_TOOL_ACCESS[role].
 */
const ROLE_FRAMING: Record<Role, string> = {
  [Role.EMPLOYEE]: "You're helping an individual contributor understand their own role, career growth, comp, and internal opportunities — not filing an HR ticket.",
  [Role.MANAGER]: "You're helping a people manager triage their own team's health, prepare reviews, and answer workforce questions scoped to their direct reports.",
  [Role.SKIP_LEVEL_MANAGER]: "You're helping a department leader see organizational health across multiple teams. Stay at the team/org level — individual coaching belongs to the direct manager, not this conversation.",
  [Role.HR_OPS]: "You're helping HR Operations track case volume, data quality, and process efficiency across the organization.",
  [Role.HR_PARTNER]: "You're helping an HR Business Partner advise a business unit strategically — talent risk, succession, promotion readiness — not just process the next request.",
  [Role.FINANCE_PLANNER]: "You're helping Finance connect workforce headcount and compensation decisions to budget impact.",
  [Role.PAYROLL_ADMIN]: "You're helping Payroll Administration catch compensation anomalies, verify compliance, and keep the payroll run accurate.",
  [Role.EXECUTIVE]: "You're helping a CEO/CHRO/CFO-level executive with strategic, company-wide workforce questions — growth capacity, talent risk, investment priorities — at the aggregate or department level.",
  [Role.SUPER_ADMIN]: "You're helping a platform administrator, who may ask about workforce data or about the platform's own access control and AI governance.",
};

/** The framing sentence for the single most specific role a worker holds — see security/roles.ts primaryRole(). */
export function getRoleFraming(roles: Role[]): string {
  return ROLE_FRAMING[primaryRole(roles)];
}

const EXAMPLE_PROMPTS_BY_ROLE: Record<Role, string[]> = {
  [Role.EMPLOYEE]: [
    "Who do I report to, and who are my direct teammates?",
    "How many people work in my department?",
    "What's our company's headcount by location?",
    "Who else is at my level in Engineering?",
  ],
  [Role.MANAGER]: [
    "Who are my direct reports?",
    "How does comp in my department compare to band?",
    "What's our company-wide attrition rate this year?",
    "Draft a promotion announcement for E0004",
  ],
  [Role.SKIP_LEVEL_MANAGER]: [
    "Show me the org structure under E0002",
    "How does headcount break down across my department?",
    "How does comp compare to band for senior levels?",
    "What's our trailing 12-month attrition rate?",
  ],
  [Role.HR_OPS]: [
    "What's our headcount by status — active, on leave, contractor?",
    "Who's on leave or termination-pending right now?",
    "Show me everyone hired in the last 3 months",
    "Draft an offer letter context for E0028",
  ],
  [Role.HR_PARTNER]: [
    "Who in Engineering is below their comp band midpoint?",
    "What's our trailing 12-month attrition rate?",
    "Show me the org structure for Engineering leadership",
    "Draft a promotion announcement for E0004",
  ],
  [Role.FINANCE_PLANNER]: [
    "What's our headcount by department?",
    "How does comp compare to band across levels?",
    "What's our trailing 12-month attrition rate?",
    "Show me everyone hired this year in GPU Cloud",
  ],
  [Role.PAYROLL_ADMIN]: [
    "Show me everyone whose comp is below band midpoint",
    "What's our headcount by location?",
    "Who reports to E0002?",
    "List everyone in GPU Cloud at IC4 or above",
  ],
  [Role.EXECUTIVE]: [
    "What's our total headcount by department?",
    "What's our trailing 12-month attrition rate?",
    "How does comp compare to band company-wide?",
    "Draft a promotion announcement for E0004",
  ],
  [Role.SUPER_ADMIN]: [
    "What's our headcount by department?",
    "Who reports to E0000?",
    "Show me comp vs. band for IC4s",
    "What's our attrition rate this year?",
  ],
};

/** Suggested prompts for the single most specific role a worker holds — always answerable with that role's actual tool access. */
export function getExamplePrompts(roles: Role[]): string[] {
  return EXAMPLE_PROMPTS_BY_ROLE[primaryRole(roles)];
}

/**
 * The terminal tool. The model must call this exactly once, as its last
 * action, instead of ever answering in plain assistant text — see the
 * system prompt in app/api/ask/route.ts. This is the actual mechanism
 * behind "structured prompts / prevent hallucinations / display confidence
 * and citations": rather than trust the model to remember to write a
 * citations section in prose (which degrades under longer conversations),
 * the schema makes citing tool results a required field, so the server can
 * always render confidence + sources the same way, and can tell when a
 * reply skipped grounding entirely.
 */
export const PROVIDE_ANSWER_TOOL = {
  name: "provide_answer",
  description:
    "Deliver your final answer to the user. Always call this as your LAST action — never answer in plain assistant text. If you couldn't fully answer from the available tools, still call this with confidence 'low' and explain what's missing in `answer`.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: {
        type: "string",
        description: "The full answer, in markdown, written for an HR/People audience. Use a markdown table for any list of workers.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "high = every fact came directly from tool results with no ambiguity or truncation. medium = mostly grounded but some inference, truncated results, or an ambiguous name match was involved. low = a tool returned no data / an error, or the question can't be answered from application data at all.",
      },
      confidenceReason: { type: "string", description: "One short sentence explaining the confidence level." },
      citations: {
        type: "array",
        description: "One entry per tool call that grounds a fact used in the answer. Empty only if confidence is low and no tool produced usable data.",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", description: "The tool name that was called, e.g. get_headcount_summary" },
            detail: { type: "string", description: "What that specific call contributed to the answer, e.g. '350 active workers, grouped by department'" },
          },
          required: ["tool", "detail"],
        },
      },
    },
    required: ["answer", "confidence", "citations"],
  },
};

const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  query_workers: QueryWorkersInput,
  get_headcount_summary: HeadcountSummaryInput,
  get_comp_vs_band: CompVsBandInput,
  get_attrition: AttritionInput,
  draft_document: DraftDocumentInput,
  get_org_chart: OrgChartInput,
};

const TOOL_IMPLS: Record<string, (input: any) => Promise<unknown>> = {
  query_workers: queryWorkers,
  get_headcount_summary: getHeadcountSummary,
  get_comp_vs_band: getCompVsBand,
  get_attrition: getAttrition,
  draft_document: draftDocumentContext,
  get_org_chart: getOrgChart,
};

export async function executeTool(name: string, rawInput: unknown): Promise<unknown> {
  const schema = TOOL_SCHEMAS[name];
  const impl = TOOL_IMPLS[name];
  if (!schema || !impl) return { error: `Unknown tool: ${name}` };
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) return { error: `Invalid arguments for ${name}: ${parsed.error.message}` };
  return impl(parsed.data);
}
