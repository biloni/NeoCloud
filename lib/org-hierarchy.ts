// Reusable org-hierarchy queries built once from getWorkforceSnapshot() and
// cached briefly. This is the SINGLE place that walks the manager graph —
// security/roles.ts (role derivation) and security/authorization.ts
// (data-access helpers) both import from here rather than each re-deriving
// direct/indirect report sets, per the "no duplicated logic" requirement.
import { getWorkforceSnapshot } from "./snapshot";

interface OrgIndex {
  directReportsByManager: Map<string, Set<string>>;
}

let cached: { at: number; index: OrgIndex } | null = null;

async function getOrgIndex(): Promise<OrgIndex> {
  const now = Date.now();
  if (cached && now - cached.at < 30_000) return cached.index;

  const snapshot = await getWorkforceSnapshot();
  const directReportsByManager = new Map<string, Set<string>>();
  for (const row of snapshot) {
    if (!row.managerId) continue;
    if (!directReportsByManager.has(row.managerId)) directReportsByManager.set(row.managerId, new Set());
    directReportsByManager.get(row.managerId)!.add(row.workerId);
  }
  const index: OrgIndex = { directReportsByManager };
  cached = { at: now, index };
  return index;
}

export async function getDirectReportIds(workerId: string): Promise<Set<string>> {
  const index = await getOrgIndex();
  return index.directReportsByManager.get(workerId) ?? new Set();
}

/** Everyone in the reporting subtree, EXCLUDING direct reports themselves. */
export async function getIndirectReportIds(workerId: string): Promise<Set<string>> {
  const index = await getOrgIndex();
  const direct = index.directReportsByManager.get(workerId) ?? new Set<string>();
  const indirect = new Set<string>();
  const queue = Array.from(direct);
  while (queue.length) {
    const cur = queue.shift()!;
    const kids = index.directReportsByManager.get(cur);
    if (!kids) continue;
    for (const k of kids) {
      if (!indirect.has(k)) {
        indirect.add(k);
        queue.push(k);
      }
    }
  }
  return indirect;
}

export async function isDirectReport(managerId: string, targetWorkerId: string): Promise<boolean> {
  return (await getDirectReportIds(managerId)).has(targetWorkerId);
}

export async function isIndirectReport(managerId: string, targetWorkerId: string): Promise<boolean> {
  return (await getIndirectReportIds(managerId)).has(targetWorkerId);
}

/** Direct report, indirect report, or self. */
export async function isInReportingChain(managerId: string, targetWorkerId: string): Promise<boolean> {
  if (managerId === targetWorkerId) return true;
  if (await isDirectReport(managerId, targetWorkerId)) return true;
  return isIndirectReport(managerId, targetWorkerId);
}

export async function hasDirectReports(workerId: string): Promise<boolean> {
  return (await getDirectReportIds(workerId)).size > 0;
}

/** True if any of this worker's direct reports themselves manage people. */
export async function hasIndirectReports(workerId: string): Promise<boolean> {
  const index = await getOrgIndex();
  const direct = index.directReportsByManager.get(workerId);
  if (!direct) return false;
  for (const d of direct) {
    if ((index.directReportsByManager.get(d)?.size ?? 0) > 0) return true;
  }
  return false;
}
