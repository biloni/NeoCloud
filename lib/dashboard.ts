import { prisma } from "./prisma";
import { getWorkforceSnapshot, snapshotKpis } from "./snapshot";
import { getPayrollPreview } from "./payroll";
import { LEVEL_ORDER } from "./reference-data";

const COUNTRY_NAMES: Record<string, string> = { US: "United States", CA: "Canada", GB: "United Kingdom", IN: "India" };

const SALARY_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "<$100k", min: 0, max: 100_000 },
  { label: "$100–150k", min: 100_000, max: 150_000 },
  { label: "$150–200k", min: 150_000, max: 200_000 },
  { label: "$200–250k", min: 200_000, max: 250_000 },
  { label: "$250–300k", min: 250_000, max: 300_000 },
  { label: "$300–400k", min: 300_000, max: 400_000 },
  { label: "$400k+", min: 400_000, max: Infinity },
];

export async function getDashboardData() {
  const today = new Date();
  const snapshot = await getWorkforceSnapshot(today);
  const kpis = snapshotKpis(snapshot);
  const active = snapshot.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");
  const activeOnly = snapshot.filter((r) => r.status === "ACTIVE");

  const openReqs = await prisma.position.count({ where: { status: "OPEN" } });

  const yearAgo = new Date(today);
  yearAgo.setDate(yearAgo.getDate() - 365);
  const terminationsTrailing12 = await prisma.workerEvent.count({
    where: { type: "TERMINATION", effectiveDate: { gte: yearAgo, lte: today } },
  });
  const trailing12moAttritionPct = kpis.totalHeadcount ? (terminationsTrailing12 / kpis.totalHeadcount) * 100 : 0;

  const avgTenureYears = active.length ? active.reduce((s, r) => s + r.tenureDays, 0) / active.length / 365 : 0;

  const payroll = await getPayrollPreview(today);
  const monthlyPayrollUsd = payroll.totals.totalCostUsd * 2; // semi-monthly period -> monthly, incl. bonus/stock accrual
  const annualPayrollUsd = monthlyPayrollUsd * 12;

  // Headcount trend + monthly cost trend: snapshot at each of the last 13 month-ends.
  const trend: { month: string; headcount: number; costUsd: number }[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); // last day of that month
    const snap = await getWorkforceSnapshot(d);
    const activeAt = snap.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");
    const costUsd = activeAt.reduce((s, r) => s + r.annualSalaryUsd / 12, 0);
    trend.push({ month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), headcount: activeAt.length, costUsd });
  }
  const headcountDelta = trend.length >= 2 ? trend[trend.length - 1].headcount - trend[trend.length - 2].headcount : 0;
  const costDelta = trend.length >= 2 ? trend[trend.length - 1].costUsd - trend[trend.length - 2].costUsd : 0;

  const depts = Array.from(new Set(active.map((r) => r.department))).sort();
  const headcountByDept = depts.map((department) => ({
    department,
    count: active.filter((r) => r.department === department).length,
  }));

  const countries = Array.from(new Set(active.map((r) => r.countryCode))).sort();
  const headcountByCountry = countries.map((countryCode) => ({
    country: COUNTRY_NAMES[countryCode] ?? countryCode,
    countryCode,
    count: active.filter((r) => r.countryCode === countryCode).length,
  }));

  const levelDistribution = LEVEL_ORDER.map((level) => ({
    level,
    count: active.filter((r) => r.level === level).length,
  })).filter((row) => row.count > 0);

  const salaryDistribution = SALARY_BUCKETS.map((b) => ({
    bucket: b.label,
    count: active.filter((r) => r.annualSalaryUsd >= b.min && r.annualSalaryUsd < b.max).length,
  }));

  return {
    kpis: {
      ...kpis,
      activeWorkers: activeOnly.length,
      openReqs,
      trailing12moAttritionPct,
      avgTenureYears,
      monthlyPayrollUsd,
      annualPayrollUsd,
      headcountDelta,
      costDelta,
    },
    trend,
    headcountByDept,
    headcountByCountry,
    levelDistribution,
    salaryDistribution,
  };
}
