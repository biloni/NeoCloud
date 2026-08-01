"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { computeProjection, emptyAssumptions, type PlanningBaseline } from "@/lib/planning-engine";
import type { EditableScenario } from "./ScenarioEditor";
import { Card, CardTitle, Table, Th, Td, Select, Badge } from "@/components/ui";
import { ComparisonChart } from "@/components/charts/ComparisonChart";
import { formatUSD, formatPct } from "@/lib/utils";

const SERIES_COLORS = { Current: "#94a3b8", A: "hsl(var(--accent))", B: "#f59e0b" };

function pctChange(value: number, base: number): number {
  if (!base) return 0;
  return ((value - base) / base) * 100;
}

export function CompareWorkspace({
  scenarios,
  baseline,
  departments,
}: {
  scenarios: EditableScenario[];
  baseline: PlanningBaseline;
  departments: string[];
}) {
  const [idA, setIdA] = useState(scenarios[0]?.id ?? "");
  const [idB, setIdB] = useState(scenarios[1]?.id ?? scenarios[0]?.id ?? "");

  const scenarioA = scenarios.find((s) => s.id === idA) ?? scenarios[0];
  const scenarioB = scenarios.find((s) => s.id === idB) ?? scenarios[0];

  const currentAssumptions = useMemo(() => emptyAssumptions(departments), [departments]);

  const projCurrent = useMemo(() => computeProjection(baseline, currentAssumptions), [baseline, currentAssumptions]);
  const projA = useMemo(() => (scenarioA ? computeProjection(baseline, scenarioA.assumptions) : []), [baseline, scenarioA]);
  const projB = useMemo(() => (scenarioB ? computeProjection(baseline, scenarioB.assumptions) : []), [baseline, scenarioB]);

  const endCurrent = projCurrent[projCurrent.length - 1];
  const endA = projA[projA.length - 1];
  const endB = projB[projB.length - 1];

  const headcountData = useMemo(
    () => projCurrent.map((m, i) => ({ label: m.label, Current: m.totalHeadcount, A: projA[i]?.totalHeadcount ?? null, B: projB[i]?.totalHeadcount ?? null })),
    [projCurrent, projA, projB]
  );
  const burnData = useMemo(
    () => projCurrent.map((m, i) => ({ label: m.label, Current: m.monthlyBurnUsd, A: projA[i]?.monthlyBurnUsd ?? null, B: projB[i]?.monthlyBurnUsd ?? null })),
    [projCurrent, projA, projB]
  );
  const intlData = useMemo(
    () => projCurrent.map((m, i) => ({ label: m.label, Current: m.internationalPct, A: projA[i]?.internationalPct ?? null, B: projB[i]?.internationalPct ?? null })),
    [projCurrent, projA, projB]
  );
  const deptGrowthData = useMemo(
    () => departments.map((d) => ({
      department: d,
      Current: endCurrent?.byDept[d]?.headcount ?? 0,
      A: endA?.byDept[d]?.headcount ?? 0,
      B: endB?.byDept[d]?.headcount ?? 0,
    })),
    [departments, endCurrent, endA, endB]
  );

  const annualCostCurrent = (endCurrent?.totalCostUsd ?? 0) * 12;
  const annualCostA = (endA?.totalCostUsd ?? 0) * 12;
  const annualCostB = (endB?.totalCostUsd ?? 0) * 12;
  const payrollImpactA = annualCostA - annualCostCurrent;
  const payrollImpactB = annualCostB - annualCostCurrent;

  if (scenarios.length === 0) {
    return <Card><p className="text-sm text-muted-foreground">Create at least one scenario on the Planning page to compare.</p></Card>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS.Current }} />
            <span className="text-sm text-muted-foreground">Current — flat baseline, no assumptions applied</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS.A }} />
            <Select value={idA} onChange={(e) => setIdA(e.target.value)}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <span className="text-xs text-muted-foreground">vs.</span>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES_COLORS.B }} />
            <Select value={idB} onChange={(e) => setIdB(e.target.value)}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-accent/30">
          <CardTitle>Payroll impact — {scenarioA?.name} vs. Current</CardTitle>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{payrollImpactA >= 0 ? "+" : ""}{formatUSD(payrollImpactA)}</span>
            <Badge variant={payrollImpactA >= 0 ? "warning" : "success"}>{formatPct(pctChange(annualCostA, annualCostCurrent))}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Annualized run-rate cost vs. an unchanged baseline.</p>
        </Card>
        <Card className="border-warning/30">
          <CardTitle>Payroll impact — {scenarioB?.name} vs. Current</CardTitle>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{payrollImpactB >= 0 ? "+" : ""}{formatUSD(payrollImpactB)}</span>
            <Badge variant={payrollImpactB >= 0 ? "warning" : "success"}>{formatPct(pctChange(annualCostB, annualCostCurrent))}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Annualized run-rate cost vs. an unchanged baseline.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Headcount over time</CardTitle>
          <div className="mt-2">
            <ComparisonChart data={headcountData} seriesKeys={["Current", "A", "B"]} yLabel="Headcount" />
          </div>
        </Card>
        <Card>
          <CardTitle>Monthly burn over time</CardTitle>
          <div className="mt-2">
            <ComparisonChart data={burnData} seriesKeys={["Current", "A", "B"]} yLabel="Burn" format="currencyK" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>International % over time</CardTitle>
          <div className="mt-2">
            <ComparisonChart data={intlData} seriesKeys={["Current", "A", "B"]} yLabel="International %" />
          </div>
        </Card>
        <Card>
          <CardTitle>Department growth (ending headcount)</CardTitle>
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deptGrowthData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={32} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Current" fill={SERIES_COLORS.Current} radius={[4, 4, 0, 0]} />
                <Bar dataKey="A" fill={SERIES_COLORS.A} radius={[4, 4, 0, 0]} />
                <Bar dataKey="B" fill={SERIES_COLORS.B} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Variance — ending state (month 12)</CardTitle>
        <Table className="mt-3">
          <thead>
            <tr>
              <Th>Scenario</Th>
              <Th>Ending headcount</Th>
              <Th>Annual cost run-rate</Th>
              <Th>International %</Th>
              <Th>Δ headcount vs. Current</Th>
              <Th>Δ cost vs. Current</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td className="font-medium">Current</Td>
              <Td>{endCurrent?.totalHeadcount.toFixed(0) ?? "—"}</Td>
              <Td>{formatUSD(annualCostCurrent)}</Td>
              <Td>{formatPct(endCurrent?.internationalPct ?? 0)}</Td>
              <Td>—</Td>
              <Td>—</Td>
            </tr>
            <tr>
              <Td className="font-medium">{scenarioA?.name}</Td>
              <Td>{endA?.totalHeadcount.toFixed(0) ?? "—"}</Td>
              <Td>{formatUSD(annualCostA)}</Td>
              <Td>{formatPct(endA?.internationalPct ?? 0)}</Td>
              <Td>{(endA && endCurrent) ? `${(endA.totalHeadcount - endCurrent.totalHeadcount) >= 0 ? "+" : ""}${(endA.totalHeadcount - endCurrent.totalHeadcount).toFixed(1)}` : "—"}</Td>
              <Td>{formatUSD(payrollImpactA)} ({formatPct(pctChange(annualCostA, annualCostCurrent))})</Td>
            </tr>
            <tr>
              <Td className="font-medium">{scenarioB?.name}</Td>
              <Td>{endB?.totalHeadcount.toFixed(0) ?? "—"}</Td>
              <Td>{formatUSD(annualCostB)}</Td>
              <Td>{formatPct(endB?.internationalPct ?? 0)}</Td>
              <Td>{(endB && endCurrent) ? `${(endB.totalHeadcount - endCurrent.totalHeadcount) >= 0 ? "+" : ""}${(endB.totalHeadcount - endCurrent.totalHeadcount).toFixed(1)}` : "—"}</Td>
              <Td>{formatUSD(payrollImpactB)} ({formatPct(pctChange(annualCostB, annualCostCurrent))})</Td>
            </tr>
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
