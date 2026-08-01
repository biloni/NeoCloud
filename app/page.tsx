import { getDashboardData } from "@/lib/dashboard";
import { KpiCard, Card, CardTitle } from "@/components/ui";
import { HeadcountTrendChart } from "@/components/charts/HeadcountTrendChart";
import { DeptLevelChart } from "@/components/charts/DeptLevelChart";
import { formatUSD, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { kpis, trend, deptLevelBreakdown } = await getDashboardData();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">NeoCloud Inc. — current-state workforce overview</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total headcount" value={kpis.totalHeadcount.toLocaleString()} sub="Active + on leave + term-pending" />
        <KpiCard label="Monthly run-rate cost" value={formatUSD(kpis.monthlyRunRateUsd)} sub="Base salary only, USD" />
        <KpiCard label="Trailing 12mo attrition" value={formatPct(kpis.trailing12moAttritionPct)} sub="Terminations / current headcount" />
        <KpiCard label="Open reqs" value={kpis.openReqs.toString()} sub="Unfilled positions" />
        <KpiCard label="% international" value={formatPct(kpis.pctInternational)} sub="Outside the US" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Headcount trend (13 months)</CardTitle>
          <div className="mt-2">
            <HeadcountTrendChart data={trend} />
          </div>
        </Card>
        <Card>
          <CardTitle>Headcount by department &amp; level</CardTitle>
          <div className="mt-2">
            <DeptLevelChart data={deptLevelBreakdown} />
          </div>
        </Card>
      </div>
    </div>
  );
}
