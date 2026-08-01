// 12-month workforce projection. Baseline cost-per-worker is derived from
// the real payroll burden functions (lib/payroll.ts) so planning and
// payroll math agree on the current state; forward-looking hire/merit
// costs use a flat burden-multiplier approximation (documented below)
// since projecting the exact country mix of *future* hires isn't
// meaningful — see CLAUDE.md "Workforce planning rules".
import { prisma } from "./prisma";
import { getWorkforceSnapshot, type WorkerSnapshotRow } from "./snapshot";
import { computeBurden, currentPeriod } from "./payroll";
import { toUsd, LEVEL_INFO, LEVEL_ORDER, type LevelCode } from "./reference-data";

export interface HirePlanEntry {
  department: string;
  quarter: string;
  count: number;
  targetLevel: string;
  targetLocation: string;
  startMonth: number; // 1-12, months from today
}

export interface ScenarioAssumptions {
  hirePlan: HirePlanEntry[];
  attritionByDept: Record<string, number>; // annualized %
  meritByLevel: Record<string, number>; // annualized %
  meritEffectiveDate: string; // ISO date
}

export interface ProjectionMonth {
  month: number;
  label: string;
  byDept: Record<string, { headcount: number; costUsd: number }>;
  totalHeadcount: number;
  totalCostUsd: number;
}

const HIRE_BURDEN_MULTIPLIER = 1.18; // flat approximation for projected future hires (US-weighted average of tax+benefits load)

async function departmentBaselines(snapshot: WorkerSnapshotRow[]) {
  const depts = Array.from(new Set(snapshot.map((r) => r.department)));
  const result: Record<string, { headcount: number; avgAnnualBurdenedUsd: number; levelWeights: Record<string, number> }> = {};
  const period = currentPeriod();

  for (const dept of depts) {
    const rows = snapshot.filter((r) => r.department === dept && (r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING"));
    let totalAnnualBurdenedUsd = 0;
    const levelWeights: Record<string, number> = {};
    for (const row of rows) {
      const grossPerPeriod = row.annualSalaryLocal / 24;
      const burden = computeBurden(row, grossPerPeriod, period.start);
      const annualGrossUsd = toUsd(grossPerPeriod, row.currency) * 24;
      const annualTaxUsd = toUsd(burden.employerTaxLocal, row.currency) * 24;
      const annualBenefitsUsd = toUsd(burden.benefitsLocal, row.currency) * 24;
      totalAnnualBurdenedUsd += annualGrossUsd + annualTaxUsd + annualBenefitsUsd;
      levelWeights[row.level] = (levelWeights[row.level] ?? 0) + 1;
    }
    result[dept] = {
      headcount: rows.length,
      avgAnnualBurdenedUsd: rows.length ? totalAnnualBurdenedUsd / rows.length : 0,
      levelWeights,
    };
  }
  return result;
}

function blendedMeritPct(levelWeights: Record<string, number>, meritByLevel: Record<string, number>): number {
  const total = Object.values(levelWeights).reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let weighted = 0;
  for (const [level, count] of Object.entries(levelWeights)) {
    weighted += (meritByLevel[level] ?? 0) * count;
  }
  return weighted / total;
}

export async function projectScenario(assumptions: ScenarioAssumptions): Promise<ProjectionMonth[]> {
  const snapshot = await getWorkforceSnapshot();
  const baselines = await departmentBaselines(snapshot);
  const depts = Object.keys(baselines);

  const state: Record<string, { headcount: number; avgAnnualBurdenedUsd: number }> = {};
  for (const d of depts) state[d] = { headcount: baselines[d].headcount, avgAnnualBurdenedUsd: baselines[d].avgAnnualBurdenedUsd };

  const today = new Date();
  const meritDate = new Date(assumptions.meritEffectiveDate);
  const months: ProjectionMonth[] = [];

  for (let m = 1; m <= 12; m++) {
    const date = new Date(today.getFullYear(), today.getMonth() + m, 1);

    for (const d of depts) {
      const attritionPct = assumptions.attritionByDept[d] ?? 0;
      const monthlyAttrition = state[d].headcount * (attritionPct / 100 / 12);
      state[d].headcount = Math.max(0, state[d].headcount - monthlyAttrition);
    }

    for (const hire of assumptions.hirePlan) {
      if (hire.startMonth !== m) continue;
      const dept = hire.department;
      if (!state[dept]) state[dept] = { headcount: 0, avgAnnualBurdenedUsd: 0 };
      const hireLevelCost = (LEVEL_INFO[hire.targetLevel as LevelCode]?.bandUsd[1] ?? 180000) * HIRE_BURDEN_MULTIPLIER;
      const existingTotal = state[dept].headcount * state[dept].avgAnnualBurdenedUsd;
      const newTotal = existingTotal + hire.count * hireLevelCost;
      state[dept].headcount += hire.count;
      state[dept].avgAnnualBurdenedUsd = state[dept].headcount ? newTotal / state[dept].headcount : hireLevelCost;
    }

    if (date.getFullYear() === meritDate.getFullYear() && date.getMonth() === meritDate.getMonth()) {
      for (const d of depts) {
        const meritPct = blendedMeritPct(baselines[d].levelWeights, assumptions.meritByLevel);
        state[d].avgAnnualBurdenedUsd *= 1 + meritPct / 100;
      }
    }

    const byDept: ProjectionMonth["byDept"] = {};
    let totalHeadcount = 0;
    let totalCostUsd = 0;
    for (const d of depts) {
      const costUsd = (state[d].headcount * state[d].avgAnnualBurdenedUsd) / 12;
      byDept[d] = { headcount: Math.round(state[d].headcount * 10) / 10, costUsd };
      totalHeadcount += state[d].headcount;
      totalCostUsd += costUsd;
    }

    months.push({
      month: m,
      label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      byDept,
      totalHeadcount: Math.round(totalHeadcount * 10) / 10,
      totalCostUsd,
    });
  }

  return months;
}

export async function listScenarios() {
  const rows = await prisma.scenario.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ ...r, assumptions: JSON.parse(r.assumptions) as ScenarioAssumptions }));
}

export async function getScenario(id: string) {
  const row = await prisma.scenario.findUniqueOrThrow({ where: { id } });
  return { ...row, assumptions: JSON.parse(row.assumptions) as ScenarioAssumptions };
}

export async function createScenario(name: string, description: string, assumptions: ScenarioAssumptions) {
  return prisma.scenario.create({ data: { name, description, assumptions: JSON.stringify(assumptions) } });
}
