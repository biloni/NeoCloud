// Pure workforce projection math — zero server-only imports (no prisma,
// no fs) so this module can be bundled into the client and drive live
// chart updates as a user edits scenario assumptions, with no network
// round-trip. lib/planning.ts wraps this with the DB-backed baseline
// fetch and Scenario CRUD; this file only knows how to project forward
// from a baseline someone else computed.
import { LEVEL_ORDER, LEVEL_INFO, LOCATIONS, type LevelCode } from "./reference-data";

export interface HirePlanEntry {
  department: string;
  targetLevel: string;
  count: number;
  startMonth: number; // 1-12, months from today
  targetLocation?: string; // LOCATIONS id; "" or unset = apportion via the scenario's overall locationMix
}

export interface TransferEntry {
  fromDepartment: string;
  toDepartment: string;
  count: number;
  month: number; // 1-12
}

export interface PromotionEntry {
  department: string;
  fromLevel: string;
  toLevel: string;
  count: number;
  month: number; // 1-12
}

export interface ScenarioAssumptions {
  hirePlan: HirePlanEntry[];
  transfers: TransferEntry[];
  promotions: PromotionEntry[];
  attritionByDept: Record<string, number>; // annualized %
  meritByLevel: Record<string, number>; // annualized %
  meritEffectiveDate: string; // ISO date
  hiringCostPerHireUsd: number; // flat blended recruiting/onboarding cost, charged once in the hire's month
  locationMix: Record<string, number>; // location id -> % share of new hires (should sum to ~100)
}

export interface DeptBaseline {
  department: string;
  headcount: number;
  avgAnnualBurdenedUsd: number;
  levelWeights: Record<string, number>;
}

export interface PlanningBaseline {
  depts: DeptBaseline[];
  countryHeadcount: Record<string, number>; // countryCode -> current headcount
  totalHeadcount: number;
}

export interface ProjectionMonth {
  month: number;
  label: string;
  byDept: Record<string, { headcount: number; costUsd: number }>;
  totalHeadcount: number;
  totalCostUsd: number; // ongoing burdened payroll for the month
  oneTimeHiringCostUsd: number; // recruiting/onboarding cost incurred this month
  monthlyBurnUsd: number; // totalCostUsd + oneTimeHiringCostUsd
  internationalPct: number;
}

// Flat approximation for projected future hires/promotions (US-weighted average of tax+benefits load) —
// projecting the exact country mix of *future* hires' burden isn't meaningful this far out.
const HIRE_BURDEN_MULTIPLIER = 1.18;

export function emptyAssumptions(departments: string[]): ScenarioAssumptions {
  const attritionByDept: Record<string, number> = {};
  for (const d of departments) attritionByDept[d] = 0;
  const meritByLevel: Record<string, number> = {};
  for (const l of LEVEL_ORDER) meritByLevel[l] = 0;
  const locationMix: Record<string, number> = {};
  for (const l of LOCATIONS) locationMix[l.id] = Math.round(l.weight * 100);
  return {
    hirePlan: [],
    transfers: [],
    promotions: [],
    attritionByDept,
    meritByLevel,
    meritEffectiveDate: new Date(new Date().getFullYear(), new Date().getMonth() + 6, 1).toISOString(),
    hiringCostPerHireUsd: 15000,
    locationMix,
  };
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

function normalizeWeights(mix: Record<string, number>): Record<string, number> {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (!total) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mix)) out[k] = v / total;
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeProjection(baseline: PlanningBaseline, assumptions: ScenarioAssumptions): ProjectionMonth[] {
  const deptState: Record<string, { headcount: number; avgAnnualBurdenedUsd: number; levelWeights: Record<string, number> }> = {};
  for (const d of baseline.depts) {
    deptState[d.department] = { headcount: d.headcount, avgAnnualBurdenedUsd: d.avgAnnualBurdenedUsd, levelWeights: { ...d.levelWeights } };
  }

  const usHeadcountBaseline = baseline.countryHeadcount["US"] ?? 0;
  let domesticHeadcount = usHeadcountBaseline;
  let internationalHeadcount = baseline.totalHeadcount - usHeadcountBaseline;

  const today = new Date();
  const meritDate = new Date(assumptions.meritEffectiveDate);
  const locWeights = normalizeWeights(assumptions.locationMix);
  const months: ProjectionMonth[] = [];

  for (let m = 1; m <= 12; m++) {
    const date = new Date(today.getFullYear(), today.getMonth() + m, 1);
    let oneTimeHiringCostUsd = 0;
    let unassignedHiresThisMonth = 0; // hires with no explicit targetLocation — apportioned via locationMix below

    // Attrition — deterministic expected-value math, no random draws.
    for (const [deptName, dept] of Object.entries(deptState)) {
      if (dept.headcount <= 0) continue;
      const attritionPct = assumptions.attritionByDept[deptName] ?? 0;
      const monthlyAttrition = dept.headcount * (attritionPct / 100 / 12);
      const shareIntl = domesticHeadcount + internationalHeadcount > 0 ? internationalHeadcount / (domesticHeadcount + internationalHeadcount) : 0;
      dept.headcount = Math.max(0, dept.headcount - monthlyAttrition);
      internationalHeadcount = Math.max(0, internationalHeadcount - monthlyAttrition * shareIntl);
      domesticHeadcount = Math.max(0, domesticHeadcount - monthlyAttrition * (1 - shareIntl));
    }

    // Hires
    for (const hire of assumptions.hirePlan) {
      if (hire.startMonth !== m || hire.count <= 0) continue;
      const dept = hire.department;
      if (!deptState[dept]) deptState[dept] = { headcount: 0, avgAnnualBurdenedUsd: 0, levelWeights: {} };
      const hireLevelMidUsd = LEVEL_INFO[hire.targetLevel as LevelCode]?.bandUsd[1] ?? 180000;
      const hireCostUsd = hireLevelMidUsd * HIRE_BURDEN_MULTIPLIER;
      const existingTotal = deptState[dept].headcount * deptState[dept].avgAnnualBurdenedUsd;
      const newTotal = existingTotal + hire.count * hireCostUsd;
      deptState[dept].headcount += hire.count;
      deptState[dept].avgAnnualBurdenedUsd = deptState[dept].headcount ? newTotal / deptState[dept].headcount : hireCostUsd;
      deptState[dept].levelWeights[hire.targetLevel] = (deptState[dept].levelWeights[hire.targetLevel] ?? 0) + hire.count;

      oneTimeHiringCostUsd += hire.count * assumptions.hiringCostPerHireUsd;

      if (hire.targetLocation) {
        const loc = LOCATIONS.find((l) => l.id === hire.targetLocation);
        if (loc?.countryCode === "US") domesticHeadcount += hire.count;
        else internationalHeadcount += hire.count;
      } else {
        unassignedHiresThisMonth += hire.count;
      }
    }
    // Hires without an explicit target location are apportioned across countries per the scenario's location mix.
    for (const [locId, weight] of Object.entries(locWeights)) {
      const loc = LOCATIONS.find((l) => l.id === locId);
      const hiresHere = unassignedHiresThisMonth * weight;
      if (loc?.countryCode === "US") domesticHeadcount += hiresHere;
      else internationalHeadcount += hiresHere;
    }

    // Transfers — move headcount (and its cost) between departments; total headcount unchanged.
    for (const t of assumptions.transfers) {
      if (t.month !== m || t.count <= 0) continue;
      const from = deptState[t.fromDepartment];
      const to = deptState[t.toDepartment];
      if (!from || !to) continue;
      const moveCount = Math.min(t.count, from.headcount);
      if (moveCount <= 0) continue;
      const movedCostTotal = moveCount * from.avgAnnualBurdenedUsd;
      from.headcount -= moveCount;
      const existingToTotal = to.headcount * to.avgAnnualBurdenedUsd;
      to.headcount += moveCount;
      to.avgAnnualBurdenedUsd = to.headcount ? (existingToTotal + movedCostTotal) / to.headcount : to.avgAnnualBurdenedUsd;
    }

    // Promotions — bump the department's average cost proportionally to the level step-up.
    for (const p of assumptions.promotions) {
      if (p.month !== m || p.count <= 0) continue;
      const dept = deptState[p.department];
      if (!dept || dept.headcount <= 0) continue;
      const fromMid = LEVEL_INFO[p.fromLevel as LevelCode]?.bandUsd[1] ?? 0;
      const toMid = LEVEL_INFO[p.toLevel as LevelCode]?.bandUsd[1] ?? 0;
      const stepIncreaseUsd = Math.max(0, toMid - fromMid) * HIRE_BURDEN_MULTIPLIER;
      dept.avgAnnualBurdenedUsd += (p.count * stepIncreaseUsd) / dept.headcount;
    }

    // Merit — applied once, on its effective month, blended per department by level mix.
    if (date.getFullYear() === meritDate.getFullYear() && date.getMonth() === meritDate.getMonth()) {
      for (const dept of Object.values(deptState)) {
        const meritPct = blendedMeritPct(dept.levelWeights, assumptions.meritByLevel);
        dept.avgAnnualBurdenedUsd *= 1 + meritPct / 100;
      }
    }

    const byDept: ProjectionMonth["byDept"] = {};
    let totalHeadcount = 0;
    let totalCostUsd = 0;
    for (const [dept, state] of Object.entries(deptState)) {
      const costUsd = (state.headcount * state.avgAnnualBurdenedUsd) / 12;
      byDept[dept] = { headcount: round1(state.headcount), costUsd };
      totalHeadcount += state.headcount;
      totalCostUsd += costUsd;
    }
    const totalCountryHeadcount = domesticHeadcount + internationalHeadcount;
    const internationalPct = totalCountryHeadcount ? (internationalHeadcount / totalCountryHeadcount) * 100 : 0;

    months.push({
      month: m,
      label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      byDept,
      totalHeadcount: round1(totalHeadcount),
      totalCostUsd,
      oneTimeHiringCostUsd,
      monthlyBurnUsd: totalCostUsd + oneTimeHiringCostUsd,
      internationalPct,
    });
  }

  return months;
}
