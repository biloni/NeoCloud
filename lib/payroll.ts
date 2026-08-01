// All payroll burden math lives here — the UI never re-implements it (see
// CLAUDE.md "Engineering rules"). Semi-monthly period; approximations per
// the take-home exercise's stated rates, documented inline.
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

export interface PayrollLineItem {
  workerId: string;
  legalName: string;
  department: string;
  locationName: string;
  countryCode: string;
  status: string;
  currency: string;
  annualSalaryLocal: number;
  periodGrossLocal: number;
  periodGrossUsd: number;
  employerTaxUsd: number;
  employerTaxLabel: string;
  benefitsUsd: number;
  burdenedCostUsd: number;
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

export interface PayrollResult {
  period: { start: Date; end: Date; totalDays: number };
  lineItems: PayrollLineItem[];
  totals: { grossUsd: number; taxUsd: number; benefitsUsd: number; burdenedUsd: number };
  byDepartment: { department: string; grossUsd: number; taxUsd: number; benefitsUsd: number; burdenedUsd: number; headcount: number }[];
  byLocation: { location: string; grossUsd: number; burdenedUsd: number; headcount: number }[];
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
  const totalWorkerCount = snapshot.length;
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

    lineItems.push({
      workerId: row.workerId, legalName: row.legalName, department: row.department, locationName: row.locationName,
      countryCode: row.countryCode, status: row.status, currency: row.currency, annualSalaryLocal: row.annualSalaryLocal,
      periodGrossLocal, periodGrossUsd, employerTaxUsd, employerTaxLabel: burden.employerTaxLabel, benefitsUsd,
      burdenedCostUsd: periodGrossUsd + employerTaxUsd + benefitsUsd,
      included, prorated, proratedDays, totalPeriodDays: period.totalDays, exclusionReason, flag,
    });
  }

  const includedItems = lineItems.filter((l) => l.included);
  const totals = includedItems.reduce(
    (acc, l) => ({
      grossUsd: acc.grossUsd + l.periodGrossUsd,
      taxUsd: acc.taxUsd + l.employerTaxUsd,
      benefitsUsd: acc.benefitsUsd + l.benefitsUsd,
      burdenedUsd: acc.burdenedUsd + l.burdenedCostUsd,
    }),
    { grossUsd: 0, taxUsd: 0, benefitsUsd: 0, burdenedUsd: 0 }
  );

  const depts = Array.from(new Set(includedItems.map((l) => l.department))).sort();
  const byDepartment = depts.map((department) => {
    const rows = includedItems.filter((l) => l.department === department);
    return {
      department,
      grossUsd: rows.reduce((s, r) => s + r.periodGrossUsd, 0),
      taxUsd: rows.reduce((s, r) => s + r.employerTaxUsd, 0),
      benefitsUsd: rows.reduce((s, r) => s + r.benefitsUsd, 0),
      burdenedUsd: rows.reduce((s, r) => s + r.burdenedCostUsd, 0),
      headcount: rows.length,
    };
  });

  const locs = Array.from(new Set(includedItems.map((l) => l.locationName))).sort();
  const byLocation = locs.map((location) => {
    const rows = includedItems.filter((l) => l.locationName === location);
    return {
      location,
      grossUsd: rows.reduce((s, r) => s + r.periodGrossUsd, 0),
      burdenedUsd: rows.reduce((s, r) => s + r.burdenedCostUsd, 0),
      headcount: rows.length,
    };
  });

  return {
    period,
    lineItems,
    totals,
    byDepartment,
    byLocation,
    reconciliation: {
      activeWorkerCount,
      totalWorkerCount,
      payrollHeadcount: includedItems.length,
      deltas,
    },
  };
}

// ---------- Anomaly detection ----------

export interface WorkerAnomaly {
  workerId: string;
  legalName: string;
  department: string;
  currentGrossUsd: number;
  trailingAvgUsd: number;
  deviationPct: number;
  explanation: string;
}

export interface DeptAnomaly {
  department: string;
  currentBurdenedUsd: number;
  priorBurdenedUsd: number;
  deviationPct: number;
  explanation: string;
}

export async function detectAnomalies(result: PayrollResult): Promise<{ workerAnomalies: WorkerAnomaly[]; deptAnomalies: DeptAnomaly[] }> {
  const workerAnomalies: WorkerAnomaly[] = [];

  for (const item of result.lineItems) {
    if (!item.included) continue;
    const compHistory = await prisma.compRecord.findMany({ where: { workerId: item.workerId }, orderBy: { effectiveFrom: "desc" } });
    // Reconstruct the gross this worker would have earned in each of the trailing 3 periods.
    const periodStarts: Date[] = [];
    let cursor = result.period.start;
    for (let i = 0; i < 3; i++) {
      const prior = previousPeriod({ start: cursor });
      periodStarts.push(prior.start);
      cursor = prior.start;
    }
    const trailingGrossesUsd: number[] = [];
    for (const ps of periodStarts) {
      const record = compHistory.find((c) => c.effectiveFrom <= ps && (!c.effectiveTo || c.effectiveTo > ps));
      if (!record) continue;
      const grossLocal = Number(record.annualSalary) / 24;
      trailingGrossesUsd.push(toUsd(grossLocal, record.currency));
    }
    if (trailingGrossesUsd.length < 3) continue; // not enough history (e.g. hired too recently)
    const trailingAvgUsd = trailingGrossesUsd.reduce((a, b) => a + b, 0) / trailingGrossesUsd.length;
    if (trailingAvgUsd === 0) continue;
    const deviationPct = ((item.periodGrossUsd - trailingAvgUsd) / trailingAvgUsd) * 100;
    if (Math.abs(deviationPct) > 10) {
      workerAnomalies.push({
        workerId: item.workerId, legalName: item.legalName, department: item.department,
        currentGrossUsd: item.periodGrossUsd, trailingAvgUsd, deviationPct,
        explanation: `Current-period gross is ${deviationPct > 0 ? "up" : "down"} ${Math.abs(deviationPct).toFixed(1)}% vs. the trailing 3-period average — likely a recent comp change (merit, promotion, or adjustment). Verify against the worker's effective-dated comp history.`,
      });
    }
  }

  const deptAnomalies: DeptAnomaly[] = [];
  const priorResult = await getPayrollPreview(new Date(previousPeriod(result.period).start.getTime() + 5 * 86400000));
  for (const dept of result.byDepartment) {
    const prior = priorResult.byDepartment.find((d) => d.department === dept.department);
    if (!prior || prior.burdenedUsd === 0) continue;
    const deviationPct = ((dept.burdenedUsd - prior.burdenedUsd) / prior.burdenedUsd) * 100;
    if (Math.abs(deviationPct) > 5) {
      deptAnomalies.push({
        department: dept.department, currentBurdenedUsd: dept.burdenedUsd, priorBurdenedUsd: prior.burdenedUsd, deviationPct,
        explanation: `${dept.department}'s burdened cost is ${deviationPct > 0 ? "up" : "down"} ${Math.abs(deviationPct).toFixed(1)}% vs. the prior period — check for headcount changes (hires/terminations) or comp changes in this department.`,
      });
    }
  }

  return { workerAnomalies, deptAnomalies };
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
  for (const dept of result.byDepartment) {
    lines.push({ costCenter: dept.department, account: "Salaries & Wages", accountCode: "6000", debit: round2(dept.grossUsd), credit: 0 });
    lines.push({ costCenter: dept.department, account: "Employer Taxes", accountCode: "6100", debit: round2(dept.taxUsd), credit: 0 });
    lines.push({ costCenter: dept.department, account: "Benefits", accountCode: "6200", debit: round2(dept.benefitsUsd), credit: 0 });
  }
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  lines.push({ costCenter: "Corporate", account: "Accrued Payroll", accountCode: "2100", debit: 0, credit: totalDebit });
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return { lines, balanced: Math.abs(totalDebit - totalCredit) < 0.01, totalDebit, totalCredit };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
