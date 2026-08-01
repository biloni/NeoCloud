// Server-only half of workforce planning: derives the DB-backed baseline
// (reusing the real payroll burden functions so planning and payroll math
// agree — see CLAUDE.md "Workforce planning rules") and owns Scenario CRUD.
// The actual month-by-month math lives in lib/planning-engine.ts, which has
// no server-only imports and is safe to bundle into the client for live
// chart updates while a user edits assumptions.
import { prisma } from "./prisma";
import { getWorkforceSnapshot } from "./snapshot";
import { computeBurden, currentPeriod } from "./payroll";
import { toUsd } from "./reference-data";
import {
  computeProjection,
  type PlanningBaseline,
  type ProjectionMonth,
  type ScenarioAssumptions,
} from "./planning-engine";

export type { ScenarioAssumptions, HirePlanEntry, TransferEntry, PromotionEntry, ProjectionMonth, PlanningBaseline } from "./planning-engine";
export { computeProjection, emptyAssumptions } from "./planning-engine";

export async function getPlanningBaseline(): Promise<PlanningBaseline> {
  const snapshot = await getWorkforceSnapshot();
  const rows = snapshot.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");
  const deptNames = Array.from(new Set(rows.map((r) => r.department)));
  const period = currentPeriod();

  const depts = deptNames.map((department) => {
    const deptRows = rows.filter((r) => r.department === department);
    let totalAnnualBurdenedUsd = 0;
    const levelWeights: Record<string, number> = {};
    for (const row of deptRows) {
      const grossPerPeriod = row.annualSalaryLocal / 24;
      const burden = computeBurden(row, grossPerPeriod, period.start);
      const annualGrossUsd = toUsd(grossPerPeriod, row.currency) * 24;
      const annualTaxUsd = toUsd(burden.employerTaxLocal, row.currency) * 24;
      const annualBenefitsUsd = toUsd(burden.benefitsLocal, row.currency) * 24;
      totalAnnualBurdenedUsd += annualGrossUsd + annualTaxUsd + annualBenefitsUsd;
      levelWeights[row.level] = (levelWeights[row.level] ?? 0) + 1;
    }
    return {
      department,
      headcount: deptRows.length,
      avgAnnualBurdenedUsd: deptRows.length ? totalAnnualBurdenedUsd / deptRows.length : 0,
      levelWeights,
    };
  });

  const countryHeadcount: Record<string, number> = {};
  for (const r of rows) countryHeadcount[r.countryCode] = (countryHeadcount[r.countryCode] ?? 0) + 1;

  return { depts, countryHeadcount, totalHeadcount: rows.length };
}

export async function projectScenario(assumptions: ScenarioAssumptions): Promise<ProjectionMonth[]> {
  const baseline = await getPlanningBaseline();
  return computeProjection(baseline, assumptions);
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

export async function updateScenario(id: string, fields: { name?: string; description?: string; assumptions?: ScenarioAssumptions }) {
  return prisma.scenario.update({
    where: { id },
    data: {
      ...(fields.name !== undefined && { name: fields.name }),
      ...(fields.description !== undefined && { description: fields.description }),
      ...(fields.assumptions !== undefined && { assumptions: JSON.stringify(fields.assumptions) }),
    },
  });
}

export async function duplicateScenario(id: string, newName: string) {
  const source = await getScenario(id);
  return createScenario(newName, source.description ?? "", source.assumptions);
}

export async function deleteScenario(id: string) {
  return prisma.scenario.delete({ where: { id } });
}
