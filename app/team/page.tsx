import { getWorkforceSnapshot } from "@/lib/snapshot";
import { getDirectReportIds, getIndirectReportIds } from "@/lib/org-hierarchy";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId, can } from "@/security/authorization";
import { Permission } from "@/security/permissions";
import { Card, CardTitle, KpiCard, Badge } from "@/components/ui";
import { formatUSD } from "@/lib/utils";
import { Users, Wallet, Clock, Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeamDashboardPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/team", "/home");
  const managerId = effectiveWorkerId(ctx);
  const isSkipLevel = can(ctx, Permission.VIEW_INDIRECT_REPORTS);

  const [snapshot, directIds, indirectIds] = await Promise.all([
    getWorkforceSnapshot(),
    getDirectReportIds(managerId),
    isSkipLevel ? getIndirectReportIds(managerId) : Promise.resolve(new Set<string>()),
  ]);

  const teamIds = isSkipLevel ? new Set([...directIds, ...indirectIds]) : directIds;
  const team = snapshot.filter((r) => teamIds.has(r.workerId) && r.status !== "TERMINATED");
  const activeIsh = team.filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE" || r.status === "TERMINATION_PENDING");

  const totalCostUsd = activeIsh.reduce((s, r) => s + r.annualSalaryUsd, 0);
  const avgTenureYears = activeIsh.length ? activeIsh.reduce((s, r) => s + r.tenureDays, 0) / activeIsh.length / 365 : 0;
  const byDept = new Map<string, number>();
  for (const r of activeIsh) byDept.set(r.department, (byDept.get(r.department) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Manager Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {isSkipLevel ? "Direct + indirect reports" : "Direct reports"} — {activeIsh.length} people
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Team size" value={activeIsh.length.toString()} sub={isSkipLevel ? "Direct + indirect" : "Direct reports"} />
        <KpiCard label="Direct reports" value={directIds.size.toString()} />
        {isSkipLevel && <KpiCard label="Indirect reports" value={indirectIds.size.toString()} />}
        <KpiCard label="Annual comp cost" value={formatUSD(totalCostUsd)} sub="Base salary only, USD" />
        <KpiCard label="Average tenure" value={`${avgTenureYears.toFixed(1)} yrs`} />
      </div>

      <Card>
        <CardTitle>Team by department</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from(byDept.entries()).map(([dept, count]) => (
            <Badge key={dept} variant="default">{dept}: {count}</Badge>
          ))}
          {byDept.size === 0 && <p className="text-sm text-muted-foreground">No team members yet.</p>}
        </div>
      </Card>
    </div>
  );
}
