// All payroll burden math lives here — the UI never re-implements it (see
// CLAUDE.md "Engineering rules"). Semi-monthly period; approximations per
// the take-home exercise's stated rates, documented inline.
//
// Bonus accrual and stock compensation are NOT part of the core data model
// (no schema field captures them — see CLAUDE.md's Worker/CompRecord
// shape), but the GL posting requirement asks for Bonus and Stock accounts.
// Rather than leave those accounts permanently at $0, this module derives
// a deterministic, level-based synthetic accrual for both, documented here
// as a demo approximation layered on top of the real salary data — not a
// stored fact about any worker.
import Decimal from "decimal.js";
import { prisma } from "./prisma";
import { getWorkforceSnapshot, type WorkerSnapshotRow } from "./snapshot";
import { toUsd } from "./reference-data";

export function currentPeriod(ref: Date = new Date()): { start: Date; end: Date; totalDays: number } {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  if (ref.getDate() <= 15) {
    return { start: new Date(y, m, 1), end: new Date(y, m, 15), totalDays: 15 };
  }
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { start: new Date(y, m, 16), end: new Date(y, m, lastDay), totalDays: lastDay - 15 };
}

export function previousPeriod(period: { start: Date }): { start: Date; end: Date; totalDays: number } {
  const before = new Date(period.start);
  before.setDate(before.getDate() - 1);
  return currentPeriod(before);
}

function nextPeriodStart(d: Date): Date {
  if (d.getDate() <= 15) return new Date(d.getFullYear(), d.getMonth(), 16);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** Rough count of semi-monthly periods already paid this calendar year before `periodStart`, used for the US SUI/FUTA wage-base approximation. */
function priorPeriodsThisYear(hireDate: Date, periodStart: Date): number {
  const yearStart = new Date(periodStart.getFullYear(), 0, 1);
  let cursor = hireDate > yearStart ? hireDate : yearStart;
  let count = 0;
  let guard = 0;
  while (guard++ < 30) {
    const next = nextPeriodStart(cursor);
    if (next >= periodStart) break;
    count++;
    cursor = next;
  }
  return count;
}

export interface BurdenBreakdown {
  employerTaxLocal: number;
  employerTaxLabel: string;
  benefitsLocal: number;
}

/** Per-country employer burden strategy. All figures in the worker's local currency. */
export function computeBurden(row: WorkerSnapshotRow, periodGrossLocal: number, periodStart: Date): BurdenBreakdown {
  const parts: string[] = [];
  let tax = 0;

  if (row.countryCode === "US") {
    const fica = periodGrossLocal * 0.0765;
    tax += fica;
    parts.push(`FICA 7.65% = ${fica.toFixed(2)}`);

    const isCurrentYearHire = row.hireDate.getFullYear() === periodStart.getFullYear();
    if (isCurrentYearHire) {
      const priorPeriods = priorPeriodsThisYear(row.hireDate, periodStart);
      const priorWages = priorPeriods * periodGrossLocal; // approximation: assumes flat pay across periods this year
      const wageBaseRemaining = Math.max(0, 7000 - priorWages);
      const taxableForSuiFutaBase = Math.min(periodGrossLocal, wageBaseRemaining);
      if (taxableForSuiFutaBase > 0) {
        const sui = taxableForSuiFutaBase * 0.062;
        const futa = taxableForSuiFutaBase * 0.006;
        tax += sui + futa;
        parts.push(`SUI 6.2% + FUTA 0.6% on $${taxableForSuiFutaBase.toFixed(0)} (current-year hire, wage base approximation) = ${(sui + futa).toFixed(2)}`);
      } else {
        parts.push("SUI/FUTA: $7,000 wage base already exhausted this year");
      }
    } else {
      parts.push("SUI/FUTA: wage base assumed exhausted (hired in a prior year)");
    }
  } else if (row.countryCode === "GB") {
    const secondaryThresholdPerPeriod = 9100 / 24;
    const taxable = Math.max(0, periodGrossLocal - secondaryThresholdPerPeriod);
    const ni = taxable * 0.138;
    tax += ni;
    parts.push(`Employer NI 13.8% above £${secondaryThresholdPerPeriod.toFixed(2)} threshold = ${ni.toFixed(2)}`);
  } else if (row.countryCode === "CA") {
    const cppEi = periodGrossLocal * 0.075;
    tax += cppEi;
    parts.push(`CPP+EI blended 7.5% = ${cppEi.toFixed(2)}`);
  } else if (row.countryCode === "IN") {
    const basic = periodGrossLocal * 0.5;
    const pf = basic * 0.12;
    tax += pf;
    parts.push(`Employer PF 12% of basic (50% of gross) = ${pf.toFixed(2)}`);
  }

  const benefitsRate = row.countryCode === "US" ? 0.10 : 0.05;
  const benefitsLocal = periodGrossLocal * benefitsRate;

  return { employerTaxLocal: tax, employerTaxLabel: parts.join("; "), benefitsLocal };
}

// ---------- Bonus / stock synthetic accrual (see module doc comment) ----------

const BONUS_TARGET_PCT_BY_LEVEL: Record<string, number> = {
  IC1: 3, IC2: 4, IC3: 5, IC4: 7, IC5: 10, IC6: 13, IC7: 16,
  M3: 8, M4: 10, M5: 14, M6: 18,
};
const STOCK_COMP_TARGET_PCT_BY_LEVEL: Record<string, number> = {
  IC1: 2, IC2: 3, IC3: 5, IC4: 8, IC5: 12, IC6: 18, IC7: 25,
  M3: 6, M4: 10, M5: 16, M6: 22,
};
// A deliberate, documented demo exception: one worker gets an extra one-time
// spot bonus this period, on top of their normal level-based accrual, so the
// "Unexpected Bonus" anomaly check has a real example to catch instead of
// running clean against an entirely formulaic dataset.
const SPOT_BONUS_OVERRIDE_USD: Record<string, number> = { E0003: 25000 };

function annualBonusTargetUsd(level: string, annualSalaryUsd: number): number {
  return annualSalaryUsd * ((BONUS_TARGET_PCT_BY_LEVEL[level] ?? 0) / 100);
}
function annualStockTargetUsd(level: string, annualSalaryUsd: number): number {
  return annualSalaryUsd * ((STOCK_COMP_TARGET_PCT_BY_LEVEL[level] ?? 0) / 100);
}

export interface PayrollLineItem {
  workerId: string;
  legalName: string;
  department: string;
  locationName: string;
  countryCode: string;
  level: string;
  status: string;
  currency: string;
  annualSalaryLocal: number;
  periodGrossLocal: number;
  periodGrossUsd: number;
  employerTaxUsd: number;
  employerTaxLabel: string;
  benefitsUsd: number;
  payrollBurdenUsd: number; // employerTaxUsd + benefitsUsd
  netCostUsd: number; // periodGrossUsd + payrollBurdenUsd — the traditional "fully burdened" cash payroll cost
  bonusAccrualUsd: number; // synthetic, see module doc comment
  stockCompUsd: number; // synthetic, see module doc comment
  totalCostUsd: number; // netCostUsd + bonusAccrualUsd + stockCompUsd
  included: boolean;
  prorated: boolean;
  proratedDays?: number;
  totalPeriodDays: number;
  exclusionReason?: string;
  flag?: string;
}

export interface ReconciliationDelta {
  workerId: string;
  legalName: string;
  reason: string;
}

export interface PayrollRollup {
  key: string;
  headcount: number;
  grossUsd: number;
  taxUsd: number;
  benefitsUsd: number;
  burdenUsd: number;
  bonusUsd: number;
  stockUsd: number;
  netCostUsd: number;
  totalCostUsd: number;
}

function buildRollup(items: PayrollLineItem[], keyFn: (l: PayrollLineItem) => string): PayrollRollup[] {
  const keys = Array.from(new Set(items.map(keyFn))).sort();
  return keys.map((key) => {
    const rows = items.filter((l) => keyFn(l) === key);
    return {
      key,
      headcount: rows.length,
      grossUsd: rows.reduce((s, r) => s + r.periodGrossUsd, 0),
      taxUsd: rows.reduce((s, r) => s + r.employerTaxUsd, 0),
      benefitsUsd: rows.reduce((s, r) => s + r.benefitsUsd, 0),
      burdenUsd: rows.reduce((s, r) => s + r.payrollBurdenUsd, 0),
      bonusUsd: rows.reduce((s, r) => s + r.bonusAccrualUsd, 0),
      stockUsd: rows.reduce((s, r) => s + r.stockCompUsd, 0),
      netCostUsd: rows.reduce((s, r) => s + r.netCostUsd, 0),
      totalCostUsd: rows.reduce((s, r) => s + r.totalCostUsd, 0),
    };
  });
}

const COUNTRY_NAMES: Record<string, string> = { US: "United States", CA: "Canada", GB: "United Kingdom", IN: "India" };

export interface PayrollResult {
  period: { start: Date; end: Date; totalDays: number };
  lineItems: PayrollLineItem[];
  totals: { grossUsd: number; taxUsd: number; benefitsUsd: number; burdenUsd: number; bonusUsd: number; stockUsd: number; netCostUsd: number; totalCostUsd: number };
  byDepartment: PayrollRollup[];
  byLocation: PayrollRollup[];
  byCountry: PayrollRollup[];
  reconciliation: {
    activeWorkerCount: number;
    totalWorkerCount: number;
    payrollHeadcount: number;
    deltas: ReconciliationDelta[];
  };
}

export async function getPayrollPreview(referenceDate: Date = new Date(), payOnLeave = false): Promise<PayrollResult> {
  const period = currentPeriod(referenceDate);
  const snapshot = await getWorkforceSnapshot(period.end);
  // getWorkforceSnapshot only returns workers with a current (non-closed) assignment,
  // so it excludes fully TERMINATED historical workers by construction — count those
  // separately so "total worker records" genuinely includes terminated history.
  const totalWorkerCount = await prisma.worker.count();
  const activeWorkerCount = snapshot.filter((r) => r.status === "ACTIVE").length;

  const lineItems: PayrollLineItem[] = [];
  const deltas: ReconciliationDelta[] = [];

  for (const row of snapshot) {
    const fullPeriodGrossLocal = row.annualSalaryLocal / 24;
    let included = true;
    let exclusionReason: string | undefined;
    let prorated = false;
    let proratedDays: number | undefined;
    let flag: string | undefined;

    if (row.status === "CONTRACTOR") {
      included = false;
      exclusionReason = "Contractor — paid via AP, not payroll";
      deltas.push({ workerId: row.workerId, legalName: row.legalName, reason: exclusionReason });
    } else if (row.status === "ON_LEAVE" && !payOnLeave) {
      included = false;
      exclusionReason = "On leave — unpaid (toggle available)";
      deltas.push({ workerId: row.workerId, legalName: row.legalName, reason: exclusionReason });
    } else if (row.status === "TERMINATION_PENDING") {
      flag = "Termination pending — paid full period, verify final pay elections";
      deltas.push({ workerId: row.workerId, legalName: row.legalName, reason: flag });
    }

    // Mid-period hire proration.
    if (included && row.hireDate > period.start && row.hireDate <= period.end) {
      const daysWorked = Math.floor((period.end.getTime() - row.hireDate.getTime()) / 86400000) + 1;
      prorated = true;
      proratedDays = daysWorked;
      flag = flag ?? `New hire mid-period — prorated ${daysWorked}/${period.totalDays} days`;
      deltas.push({ workerId: row.workerId, legalName: row.legalName, reason: flag });
    }

    const periodGrossLocal = included ? (prorated ? fullPeriodGrossLocal * ((proratedDays ?? period.totalDays) / period.totalDays) : fullPeriodGrossLocal) : 0;
    const burden = included ? computeBurden(row, periodGrossLocal, period.start) : { employerTaxLocal: 0, employerTaxLabel: "", benefitsLocal: 0 };

    const periodGrossUsd = new Decimal(toUsd(periodGrossLocal, row.currency)).toDecimalPlaces(2).toNumber();
    const employerTaxUsd = new Decimal(toUsd(burden.employerTaxLocal, row.currency)).toDecimalPlaces(2).toNumber();
    const benefitsUsd = new Decimal(toUsd(burden.benefitsLocal, row.currency)).toDecimalPlaces(2).toNumber();
    const payrollBurdenUsd = employerTaxUsd + benefitsUsd;
    const netCostUsd = periodGrossUsd + payrollBurdenUsd;

    let bonusAccrualUsd = 0;
    let stockCompUsd = 0;
    if (included) {
      bonusAccrualUsd = round2(annualBonusTargetUsd(row.level, row.annualSalaryUsd) / 24 + (SPOT_BONUS_OVERRIDE_USD[row.workerId] ?? 0));
      stockCompUsd = round2(annualStockTargetUsd(row.level, row.annualSalaryUsd) / 24);
    }

    lineItems.push({
      workerId: row.workerId, legalName: row.legalName, department: row.department, locationName: row.locationName,
      countryCode: row.countryCode, level: row.level, status: row.status, currency: row.currency, annualSalaryLocal: row.annualSalaryLocal,
      periodGrossLocal, periodGrossUsd, employerTaxUsd, employerTaxLabel: burden.employerTaxLabel, benefitsUsd,
      payrollBurdenUsd, netCostUsd, bonusAccrualUsd, stockCompUsd, totalCostUsd: netCostUsd + bonusAccrualUsd + stockCompUsd,
      included, prorated, proratedDays, totalPeriodDays: period.totalDays, exclusionReason, flag,
    });
  }

  const includedItems = lineItems.filter((l) => l.included);
  const totals = includedItems.reduce(
    (acc, l) => ({
      grossUsd: acc.grossUsd + l.periodGrossUsd,
      taxUsd: acc.taxUsd + l.employerTaxUsd,
      benefitsUsd: acc.benefitsUsd + l.benefitsUsd,
      burdenUsd: acc.burdenUsd + l.payrollBurdenUsd,
      bonusUsd: acc.bonusUsd + l.bonusAccrualUsd,
      stockUsd: acc.stockUsd + l.stockCompUsd,
      netCostUsd: acc.netCostUsd + l.netCostUsd,
      totalCostUsd: acc.totalCostUsd + l.totalCostUsd,
    }),
    { grossUsd: 0, taxUsd: 0, benefitsUsd: 0, burdenUsd: 0, bonusUsd: 0, stockUsd: 0, netCostUsd: 0, totalCostUsd: 0 }
  );

  const byDepartment = buildRollup(includedItems, (l) => l.department);
  const byLocation = buildRollup(includedItems, (l) => l.locationName);
  const byCountry = buildRollup(includedItems, (l) => COUNTRY_NAMES[l.countryCode] ?? l.countryCode);

  return {
    period,
    lineItems,
    totals,
    byDepartment,
    byLocation,
    byCountry,
    reconciliation: {
      activeWorkerCount,
      totalWorkerCount,
      payrollHeadcount: includedItems.length,
      deltas,
    },
  };
}

// ---------- Anomaly detection ----------

export type AnomalySeverity = "high" | "medium" | "low";
export type AnomalyType =
  | "LARGE_SALARY_INCREASE"
  | "DUPLICATE_PAYMENT"
  | "UNEXPECTED_BONUS"
  | "PAYROLL_SPIKE"
  | "DEPARTMENT_OVERSPEND"
  | "NEW_HIRE_NO_MANAGER"
  | "MISSING_DEPARTMENT"
  | "MISSING_LOCATION";

export interface AnomalyFlag {
  key: string; // stable per (type, subject, period) — used for acknowledgment persistence
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  subjectLabel: string;
  workerId?: string;
  department?: string;
  explanation: string;
}

const ANOMALY_TITLES: Record<AnomalyType, string> = {
  LARGE_SALARY_INCREASE: "Large salary increase",
  DUPLICATE_PAYMENT: "Duplicate payment",
  UNEXPECTED_BONUS: "Unexpected bonus",
  PAYROLL_SPIKE: "Payroll spike",
  DEPARTMENT_OVERSPEND: "Department overspend",
  NEW_HIRE_NO_MANAGER: "New hire without manager",
  MISSING_DEPARTMENT: "Missing department",
  MISSING_LOCATION: "Missing location",
};

function periodLabel(period: { start: Date }): string {
  return period.start.toISOString().slice(0, 10);
}

export async function detectAnomalies(result: PayrollResult): Promise<AnomalyFlag[]> {
  const flags: AnomalyFlag[] = [];
  const pLabel = periodLabel(result.period);

  // ---- Large salary increase (worker gross vs. trailing 3-period average) ----
  const includedWorkerIds = result.lineItems.filter((l) => l.included).map((l) => l.workerId);
  const allCompHistory = await prisma.compRecord.findMany({
    where: { workerId: { in: includedWorkerIds } },
    orderBy: { effectiveFrom: "desc" },
  });
  const compHistoryByWorker = new Map<string, typeof allCompHistory>();
  for (const c of allCompHistory) {
    if (!compHistoryByWorker.has(c.workerId)) compHistoryByWorker.set(c.workerId, []);
    compHistoryByWorker.get(c.workerId)!.push(c);
  }
  const trailingPeriodStarts: Date[] = [];
  {
    let cursor = result.period.start;
    for (let i = 0; i < 3; i++) {
      const prior = previousPeriod({ start: cursor });
      trailingPeriodStarts.push(prior.start);
      cursor = prior.start;
    }
  }
  for (const item of result.lineItems) {
    if (!item.included) continue;
    const compHistory = compHistoryByWorker.get(item.workerId) ?? [];
    const trailingGrossesUsd: number[] = [];
    for (const ps of trailingPeriodStarts) {
      const record = compHistory.find((c) => c.effectiveFrom <= ps && (!c.effectiveTo || c.effectiveTo > ps));
      if (!record) continue;
      trailingGrossesUsd.push(toUsd(Number(record.annualSalary) / 24, record.currency));
    }
    if (trailingGrossesUsd.length < 3) continue; // not enough history (e.g. hired too recently)
    const trailingAvgUsd = trailingGrossesUsd.reduce((a, b) => a + b, 0) / trailingGrossesUsd.length;
    if (trailingAvgUsd === 0) continue;
    const deviationPct = ((item.periodGrossUsd - trailingAvgUsd) / trailingAvgUsd) * 100;
    if (deviationPct > 10) {
      flags.push({
        key: `LARGE_SALARY_INCREASE:${item.workerId}:${pLabel}`,
        type: "LARGE_SALARY_INCREASE",
        severity: deviationPct > 25 ? "high" : "medium",
        title: ANOMALY_TITLES.LARGE_SALARY_INCREASE,
        subjectLabel: item.legalName,
        workerId: item.workerId,
        department: item.department,
        explanation: `${item.legalName}'s current-period gross (${formatUsd(item.periodGrossUsd)}) is up ${deviationPct.toFixed(1)}% vs. their trailing 3-period average (${formatUsd(trailingAvgUsd)}) — likely a recent merit increase, promotion, or comp adjustment. Verify against their effective-dated comp history.`,
      });
    }
  }

  // ---- Duplicate payment: a worker with more than one "current" comp record ----
  const currentCompCounts = await prisma.compRecord.groupBy({
    by: ["workerId"],
    where: { effectiveTo: null, workerId: { in: result.lineItems.filter((l) => l.included).map((l) => l.workerId) } },
    _count: { _all: true },
  });
  for (const row of currentCompCounts) {
    if (row._count._all <= 1) continue;
    const item = result.lineItems.find((l) => l.workerId === row.workerId);
    if (!item) continue;
    flags.push({
      key: `DUPLICATE_PAYMENT:${row.workerId}:${pLabel}`,
      type: "DUPLICATE_PAYMENT",
      severity: "high",
      title: ANOMALY_TITLES.DUPLICATE_PAYMENT,
      subjectLabel: item.legalName,
      workerId: row.workerId,
      department: item.department,
      explanation: `${item.legalName} has ${row._count._all} active (effective-to-date null) compensation records simultaneously — this worker risks being paid twice this period. Close out the stale CompRecord before running payroll.`,
    });
  }

  // ---- Unexpected bonus: actual bonus accrual well above the level-standard formula ----
  for (const item of result.lineItems) {
    if (!item.included || item.bonusAccrualUsd <= 0) continue;
    const annualSalaryUsd = toUsd(item.annualSalaryLocal, item.currency);
    const expectedUsd = round2(annualBonusTargetUsd(item.level, annualSalaryUsd) / 24);
    if (expectedUsd <= 0) continue;
    const deviationPct = ((item.bonusAccrualUsd - expectedUsd) / expectedUsd) * 100;
    if (deviationPct > 20) {
      flags.push({
        key: `UNEXPECTED_BONUS:${item.workerId}:${pLabel}`,
        type: "UNEXPECTED_BONUS",
        severity: deviationPct > 100 ? "high" : "medium",
        title: ANOMALY_TITLES.UNEXPECTED_BONUS,
        subjectLabel: item.legalName,
        workerId: item.workerId,
        department: item.department,
        explanation: `${item.legalName}'s bonus accrual this period (${formatUsd(item.bonusAccrualUsd)}) is ${deviationPct.toFixed(0)}% above the standard level-based accrual (${formatUsd(expectedUsd)}) — confirm there's an approved spot bonus or award behind this before posting.`,
      });
    }
  }

  // Trailing 3 periods, computed once and reused by both the company-wide
  // spike check and the per-department overspend check below.
  const trailingPeriods: PayrollResult[] = [];
  {
    let cursor = result.period.start;
    for (let i = 0; i < 3; i++) {
      const prior = previousPeriod({ start: cursor });
      trailingPeriods.push(await getPayrollPreview(new Date(prior.start.getTime() + 5 * 86400000)));
      cursor = prior.start;
    }
  }
  const priorResult = trailingPeriods[0];

  // ---- Payroll spike: company-wide total cost vs. prior period ----
  if (priorResult.totals.totalCostUsd > 0) {
    const deviationPct = ((result.totals.totalCostUsd - priorResult.totals.totalCostUsd) / priorResult.totals.totalCostUsd) * 100;
    if (Math.abs(deviationPct) > 5) {
      flags.push({
        key: `PAYROLL_SPIKE:company:${pLabel}`,
        type: "PAYROLL_SPIKE",
        severity: Math.abs(deviationPct) > 15 ? "high" : "medium",
        title: ANOMALY_TITLES.PAYROLL_SPIKE,
        subjectLabel: "Company-wide",
        explanation: `Total company payroll cost is ${deviationPct > 0 ? "up" : "down"} ${Math.abs(deviationPct).toFixed(1)}% vs. the prior period (${formatUsd(priorResult.totals.totalCostUsd)} → ${formatUsd(result.totals.totalCostUsd)}) — check for a batch of hires/terminations, a comp cycle, or a bonus run landing this period.`,
      });
    }
  }

  // ---- Department overspend: dept total cost vs. trailing 3-period average ----
  for (const dept of result.byDepartment) {
    const trailingCosts = trailingPeriods
      .map((p) => p.byDepartment.find((d) => d.key === dept.key)?.totalCostUsd)
      .filter((v): v is number => v !== undefined);
    if (trailingCosts.length < 3) continue;
    const trailingAvg = trailingCosts.reduce((a, b) => a + b, 0) / trailingCosts.length;
    if (trailingAvg <= 0) continue;
    const overspendPct = ((dept.totalCostUsd - trailingAvg) / trailingAvg) * 100;
    if (overspendPct > 7) {
      flags.push({
        key: `DEPARTMENT_OVERSPEND:${dept.key}:${pLabel}`,
        type: "DEPARTMENT_OVERSPEND",
        severity: overspendPct > 20 ? "high" : "medium",
        title: ANOMALY_TITLES.DEPARTMENT_OVERSPEND,
        subjectLabel: dept.key,
        department: dept.key,
        explanation: `${dept.key}'s total cost this period (${formatUsd(dept.totalCostUsd)}) is ${overspendPct.toFixed(1)}% above its trailing 3-period average (${formatUsd(trailingAvg)}) — review headcount changes, comp changes, and bonus/stock accruals in this department.`,
      });
    }
  }

  // ---- New hire without an active manager ----
  const snapshotNow = await getWorkforceSnapshot();
  const ninetyDaysAgo = new Date(result.period.end);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  for (const row of snapshotNow) {
    if (row.hireDate < ninetyDaysAgo) continue;
    const manager = row.managerId ? snapshotNow.find((m) => m.workerId === row.managerId) : null;
    const managerMissingOrInactive = !row.managerId || !manager || manager.status !== "ACTIVE";
    if (managerMissingOrInactive) {
      flags.push({
        key: `NEW_HIRE_NO_MANAGER:${row.workerId}:${pLabel}`,
        type: "NEW_HIRE_NO_MANAGER",
        severity: "medium",
        title: ANOMALY_TITLES.NEW_HIRE_NO_MANAGER,
        subjectLabel: row.legalName,
        workerId: row.workerId,
        department: row.department,
        explanation: row.managerId
          ? `${row.legalName} (hired ${row.hireDate.toISOString().slice(0, 10)}) reports to ${row.managerName ?? row.managerId}, who is not currently Active — this hire is effectively without active management coverage.`
          : `${row.legalName} (hired ${row.hireDate.toISOString().slice(0, 10)}) has no manager on record — approvals routed to "manager of worker" will fail for this person until one is assigned.`,
      });
    }
  }

  // ---- Missing department / location (data-quality checks) ----
  for (const row of snapshotNow) {
    if (row.department === "Unknown") {
      flags.push({
        key: `MISSING_DEPARTMENT:${row.workerId}:${pLabel}`,
        type: "MISSING_DEPARTMENT",
        severity: "low",
        title: ANOMALY_TITLES.MISSING_DEPARTMENT,
        subjectLabel: row.legalName,
        workerId: row.workerId,
        explanation: `${row.legalName}'s supervisory org chain doesn't resolve to a known department — payroll and headcount rollups will misclassify this worker until the org tree is fixed.`,
      });
    }
    if (row.locationName === row.locationId) {
      flags.push({
        key: `MISSING_LOCATION:${row.workerId}:${pLabel}`,
        type: "MISSING_LOCATION",
        severity: "low",
        title: ANOMALY_TITLES.MISSING_LOCATION,
        subjectLabel: row.legalName,
        workerId: row.workerId,
        explanation: `${row.legalName}'s position references a location id ("${row.locationId}") with no matching Location record — country-level tax/benefit rates may be wrong until this is corrected.`,
      });
    }
  }

  const severityRank: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

// ---------- GL posting ----------

export interface GlLine {
  costCenter: string;
  account: string;
  accountCode: string;
  debit: number;
  credit: number;
}

export function buildGlPosting(result: PayrollResult): { lines: GlLine[]; balanced: boolean; totalDebit: number; totalCredit: number } {
  const lines: GlLine[] = [];
  let accruedPayroll = 0;
  let accruedBonus = 0;
  let apic = 0;

  for (const dept of result.byDepartment) {
    lines.push({ costCenter: dept.key, account: "Salaries & Wages", accountCode: "6000", debit: round2(dept.grossUsd), credit: 0 });
    lines.push({ costCenter: dept.key, account: "Employer Taxes", accountCode: "6100", debit: round2(dept.taxUsd), credit: 0 });
    lines.push({ costCenter: dept.key, account: "Benefits", accountCode: "6200", debit: round2(dept.benefitsUsd), credit: 0 });
    lines.push({ costCenter: dept.key, account: "Bonus Expense", accountCode: "6300", debit: round2(dept.bonusUsd), credit: 0 });
    lines.push({ costCenter: dept.key, account: "Stock Compensation Expense", accountCode: "6400", debit: round2(dept.stockUsd), credit: 0 });
    accruedPayroll += dept.grossUsd + dept.taxUsd + dept.benefitsUsd;
    accruedBonus += dept.bonusUsd;
    apic += dept.stockUsd;
  }

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  lines.push({ costCenter: "Corporate", account: "Accrued Payroll", accountCode: "2100", debit: 0, credit: round2(accruedPayroll) });
  lines.push({ costCenter: "Corporate", account: "Accrued Bonus Payable", accountCode: "2200", debit: 0, credit: round2(accruedBonus) });
  lines.push({ costCenter: "Corporate", account: "Additional Paid-in Capital (stock comp, non-cash)", accountCode: "3200", debit: 0, credit: round2(apic) });
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));

  return { lines, balanced: Math.abs(totalDebit - totalCredit) < 0.01, totalDebit, totalCredit };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
