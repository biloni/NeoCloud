import { prisma } from "./prisma";
import { getWorkforceSnapshot, snapshotKpis } from "./snapshot";
import { LEVEL_ORDER } from "./reference-data";

export async function getDashboardData() {
  const today = new Date();
  const snapshot = await getWorkforceSnapshot(today);
  const kpis = snapshotKpis(snapshot);

  const openReqs = await prisma.position.count({ where: { status: "OPEN" } });

  const yearAgo = new Date(today);
  yearAgo.setDate(yearAgo.getDate() - 365);
  const terminationsTrailing12 = await prisma.workerEvent.count({
    where: { type: "TERMINATION", effectiveDate: { gte: yearAgo, lte: today } },
  });
  const avgHeadcountForAttrition = kpis.totalHeadcount; // approximation, documented in README
  const trailing12moAttritionPct = avgHeadcountForAttrition ? (terminationsTrailing12 / avgHeadcountForAttrition) * 100 : 0;

  // Headcount trend: snapshot at each of the last 13 month-ends.
  const trend: { month: string; headcount: number }[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); // last day of that month
    const snap = await getWorkforceSnapshot(d);
    const active = snap.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");
    trend.push({ month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), headcount: active.length });
  }

  // Department x level breakdown (current, active-ish only).
  const active = snapshot.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");
  const depts = Array.from(new Set(active.map((r) => r.department))).sort();
  const deptLevelBreakdown = depts.map((dept) => {
    const row: Record<string, number | string> = { department: dept };
    for (const lvl of LEVEL_ORDER) {
      row[lvl] = active.filter((r) => r.department === dept && r.level === lvl).length;
    }
    return row;
  });

  return {
    kpis: { ...kpis, openReqs, trailing12moAttritionPct },
    trend,
    deptLevelBreakdown,
    depts,
  };
}
