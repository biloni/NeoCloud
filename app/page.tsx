import { getDashboardData } from "@/lib/dashboard";
import { Card, CardTitle } from "@/components/ui";
import { ExecKpiCard } from "@/components/dashboard/ExecKpiCard";
import { HeadcountTrendChart } from "@/components/charts/HeadcountTrendChart";
import { HeadcountByDeptChart } from "@/components/charts/HeadcountByDeptChart";
import { HeadcountByCountryChart } from "@/components/charts/HeadcountByCountryChart";
import { LevelDistributionChart } from "@/components/charts/LevelDistributionChart";
import { SalaryDistributionChart } from "@/components/charts/SalaryDistributionChart";
import { formatUSD, formatPct } from "@/lib/utils";
import { Users, UserCheck, Wallet, Landmark, TrendingDown, Globe2, Clock, Briefcase } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

function pctDelta(delta: number, base: number): string {
  if (!base) return "0%";
  return `${Math.abs((delta / base) * 100).toFixed(1)}%`;
}

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/", "/home");

  const { kpis, trend, headcountByDept, headcountByCountry, levelDistribution, salaryDistribution } = await getDashboardData();
  const prevHeadcount = kpis.totalHeadcount - kpis.headcountDelta;
  const prevCost = kpis.monthlyPayrollUsd / 2 - kpis.costDelta; // rough base for the small monthly-cost delta badge

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Executive Dashboard</h1>
        <p className="text-sm text-muted-foreground">NeoCloud Inc. — company-wide workforce &amp; cost overview, as of today</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <ExecKpiCard
          label="Total Headcount"
          value={kpis.totalHeadcount.toLocaleString()}
          sub="Active + on leave + term-pending"
          icon={Users}
          accent="blue"
          delta={{
            value: pctDelta(kpis.headcountDelta, prevHeadcount),
            direction: kpis.headcountDelta > 0 ? "up" : kpis.headcountDelta < 0 ? "down" : "flat",
            positiveIsGood: true,
          }}
        />
        <ExecKpiCard
          label="Active Workers"
          value={kpis.activeWorkers.toLocaleString()}
          sub="Status = Active only"
          icon={UserCheck}
          accent="cyan"
        />
        <ExecKpiCard
          label="Monthly Payroll"
          value={formatUSD(kpis.monthlyPayrollUsd)}
          sub="Fully burdened, USD"
          icon={Wallet}
          accent="emerald"
          delta={{
            value: pctDelta(kpis.costDelta, prevCost),
            direction: kpis.costDelta > 0 ? "up" : kpis.costDelta < 0 ? "down" : "flat",
            positiveIsGood: true,
          }}
        />
        <ExecKpiCard
          label="Annual Payroll"
          value={formatUSD(kpis.annualPayrollUsd)}
          sub="Run-rate, fully burdened"
          icon={Landmark}
          accent="teal"
        />
        <ExecKpiCard
          label="Attrition"
          value={formatPct(kpis.trailing12moAttritionPct)}
          sub="Trailing 12 months"
          icon={TrendingDown}
          accent="rose"
        />
        <ExecKpiCard
          label="International %"
          value={formatPct(kpis.pctInternational)}
          sub="Workforce outside the US"
          icon={Globe2}
          accent="violet"
        />
        <ExecKpiCard
          label="Average Tenure"
          value={`${kpis.avgTenureYears.toFixed(1)} yrs`}
          sub="Active workforce"
          icon={Clock}
          accent="amber"
        />
        <ExecKpiCard
          label="Open Positions"
          value={kpis.openReqs.toString()}
          sub="Unfilled requisitions"
          icon={Briefcase}
          accent="indigo"
        />
      </div>

      <Card>
        <CardTitle>Headcount &amp; cost trend (13 months)</CardTitle>
        <div className="mt-2">
          <HeadcountTrendChart data={trend} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Headcount by department</CardTitle>
          <div className="mt-2">
            <HeadcountByDeptChart data={headcountByDept} />
          </div>
        </Card>
        <Card>
          <CardTitle>Headcount by country</CardTitle>
          <div className="mt-2">
            <HeadcountByCountryChart data={headcountByCountry} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Level distribution</CardTitle>
          <div className="mt-2">
            <LevelDistributionChart data={levelDistribution} />
          </div>
        </Card>
        <Card>
          <CardTitle>Salary distribution (USD)</CardTitle>
          <div className="mt-2">
            <SalaryDistributionChart data={salaryDistribution} />
          </div>
        </Card>
      </div>
    </div>
  );
}
