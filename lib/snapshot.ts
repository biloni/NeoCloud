// Point-in-time workforce derivation. Every view (dashboard, planning
// baseline, payroll) calls getWorkforceSnapshot so headcount/comp numbers
// always tie out — see CLAUDE.md "Current-state derivation rule".
import { prisma } from "./prisma";
import Decimal from "decimal.js";
import { toUsd } from "./reference-data";

export interface WorkerSnapshotRow {
  workerId: string;
  legalName: string;
  countryCode: string;
  status: string;
  hireDate: Date;
  department: string;
  locationId: string;
  locationName: string;
  level: string;
  track: string;
  positionId: string;
  supOrgId: string;
  managerId: string | null;
  managerName: string | null;
  annualSalaryLocal: number;
  currency: string;
  annualSalaryUsd: number;
  tenureDays: number;
}

let orgCache: { rows: { id: string; name: string; managerId: string | null; parentId: string | null }[]; at: number } | null = null;

async function loadOrgs() {
  const now = Date.now();
  if (orgCache && now - orgCache.at < 60_000) return orgCache.rows;
  const rows = await prisma.supervisoryOrg.findMany({
    select: { id: true, name: true, managerId: true, parentId: true },
  });
  orgCache = { rows, at: now };
  return rows;
}

const ROOT_ORG_ID = "SO-E0000";

/**
 * A worker's department is the name of whichever org is a direct child of
 * the root org, found by: (a) if this worker heads a department-level org
 * themselves (the four dept heads sit *in* the root org, same as any other
 * of the CEO's other direct reports — their department is the org THEY
 * head, not where their own position sits), use that; otherwise (b) walk
 * up from where their position sits until hitting a direct child of root.
 * Org ids follow the deterministic "SO-<workerId>" convention (see seed.ts).
 */
function departmentForWorker(
  workerId: string,
  positionSupOrgId: string,
  orgById: Map<string, { id: string; name: string; parentId: string | null }>
): string {
  if (workerId === "E0000") return "G&A"; // CEO / corporate bucket — see CLAUDE.md assumptions
  const ownOrg = orgById.get(`SO-${workerId}`);
  if (ownOrg && ownOrg.parentId === ROOT_ORG_ID) return ownOrg.name;
  let cur = orgById.get(positionSupOrgId);
  if (!cur) return "Unknown";
  const seen = new Set<string>();
  while (cur.parentId && cur.parentId !== ROOT_ORG_ID && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = orgById.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur.name;
}

/**
 * Derive the full current-state workforce as of a given date. A worker's
 * department/location/level/salary is computed from the latest
 * PositionAssignment + CompRecord where effectiveTo is null (or, for
 * historical `asOf` dates, the record effective at that date).
 */
export async function getWorkforceSnapshot(asOf: Date = new Date()): Promise<WorkerSnapshotRow[]> {
  const [workers, orgs, positions, locations, jobProfiles, assignments, compRecords] = await Promise.all([
    prisma.worker.findMany(),
    loadOrgs(),
    prisma.position.findMany(),
    prisma.location.findMany(),
    prisma.jobProfile.findMany(),
    prisma.positionAssignment.findMany({ where: { effectiveFrom: { lte: asOf } } }),
    prisma.compRecord.findMany({ where: { effectiveFrom: { lte: asOf } } }),
  ]);

  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const posById = new Map(positions.map((p) => [p.id, p]));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const jpById = new Map(jobProfiles.map((j) => [j.id, j]));
  const orgManagerById = new Map(orgs.map((o) => [o.id, o.managerId]));

  const deptNameCache = new Map<string, string>();
  function departmentFor(workerId: string, orgId: string): string {
    const key = `${workerId}|${orgId}`;
    if (deptNameCache.has(key)) return deptNameCache.get(key)!;
    const name = departmentForWorker(workerId, orgId, orgById);
    deptNameCache.set(key, name);
    return name;
  }

  // Latest assignment/comp per worker as of `asOf`.
  const latestAssignment = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) {
    if (a.effectiveTo && a.effectiveTo <= asOf) continue;
    const cur = latestAssignment.get(a.workerId);
    if (!cur || a.effectiveFrom > cur.effectiveFrom) latestAssignment.set(a.workerId, a);
  }
  const latestComp = new Map<string, (typeof compRecords)[number]>();
  for (const c of compRecords) {
    if (c.effectiveTo && c.effectiveTo <= asOf) continue;
    const cur = latestComp.get(c.workerId);
    if (!cur || c.effectiveFrom > cur.effectiveFrom) latestComp.set(c.workerId, c);
  }

  const rows: WorkerSnapshotRow[] = [];
  for (const w of workers) {
    if (w.hireDate > asOf) continue; // not yet hired as of this date
    const assignment = latestAssignment.get(w.id);
    const comp = latestComp.get(w.id);
    if (!assignment || !comp) continue; // terminated before asOf, or no active assignment

    const position = posById.get(assignment.positionId);
    if (!position) continue;
    const location = locById.get(position.locationId);
    const jobProfile = jpById.get(position.jobProfileId);
    const managerId = orgManagerById.get(position.supOrgId) ?? null;
    const managerWorker = managerId ? workers.find((x) => x.id === managerId) : null;

    const salary = Number(comp.annualSalary);
    const tenureDays = Math.floor((asOf.getTime() - w.hireDate.getTime()) / 86400000);

    rows.push({
      workerId: w.id,
      legalName: w.legalName,
      countryCode: w.countryCode,
      status: w.status,
      hireDate: w.hireDate,
      department: departmentFor(w.id, position.supOrgId),
      locationId: position.locationId,
      locationName: location?.name ?? position.locationId,
      level: jobProfile?.level ?? "?",
      track: jobProfile?.track ?? "?",
      positionId: position.id,
      supOrgId: position.supOrgId,
      managerId: managerId,
      managerName: managerWorker?.legalName ?? null,
      annualSalaryLocal: salary,
      currency: comp.currency,
      annualSalaryUsd: new Decimal(toUsd(salary, comp.currency)).toDecimalPlaces(2).toNumber(),
      tenureDays,
    });
  }
  return rows;
}

export function snapshotKpis(rows: WorkerSnapshotRow[]) {
  const active = rows.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");
  const totalHeadcount = active.length;
  const monthlyRunRateUsd = active.reduce((s, r) => s + r.annualSalaryUsd / 12, 0);
  const international = active.filter((r) => r.countryCode !== "US").length;
  const pctInternational = totalHeadcount ? (international / totalHeadcount) * 100 : 0;
  return { totalHeadcount, monthlyRunRateUsd, pctInternational };
}
