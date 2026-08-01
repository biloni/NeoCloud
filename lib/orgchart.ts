// Centered org-chart view: given a worker, show their manager chain up to
// the CEO and their direct reports — the same pattern Workday's own org
// chart navigation uses (center on a worker, drill up/down), rather than
// trying to render all ~350 workers in one tree at once.
import { getWorkforceSnapshot } from "./snapshot";

export interface OrgChartNode {
  workerId: string;
  legalName: string;
  level: string;
  department: string;
  status: string;
  directReportCount: number;
}

export interface OrgChartView {
  center: OrgChartNode;
  managerChain: OrgChartNode[]; // root (CEO) first, immediate manager last
  directReports: OrgChartNode[];
}

export async function getOrgChartView(centerWorkerId: string): Promise<OrgChartView | null> {
  const snapshot = await getWorkforceSnapshot();
  const byId = new Map(snapshot.map((r) => [r.workerId, r]));
  const center = byId.get(centerWorkerId.toUpperCase());
  if (!center) return null;

  const reportCounts = new Map<string, number>();
  for (const r of snapshot) {
    if (r.managerId) reportCounts.set(r.managerId, (reportCounts.get(r.managerId) ?? 0) + 1);
  }

  function toNode(r: (typeof snapshot)[number]): OrgChartNode {
    return {
      workerId: r.workerId,
      legalName: r.legalName,
      level: r.level,
      department: r.department,
      status: r.status,
      directReportCount: reportCounts.get(r.workerId) ?? 0,
    };
  }

  const managerChain: OrgChartNode[] = [];
  let cursor = center.managerId;
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const managerRow = byId.get(cursor)!;
    managerChain.unshift(toNode(managerRow));
    cursor = managerRow.managerId;
  }

  const directReports = snapshot
    .filter((r) => r.managerId === center.workerId)
    .sort((a, b) => a.legalName.localeCompare(b.legalName))
    .map(toNode);

  return { center: toNode(center), managerChain, directReports };
}
