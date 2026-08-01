import Link from "next/link";
import { listScenarios, projectScenario } from "@/lib/planning";
import { Card, CardTitle, Table, Th, Td, Select } from "@/components/ui";
import { ComparisonChart } from "@/components/charts/ComparisonChart";
import { formatUSD, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: { a?: string; b?: string } }) {
  const scenarios = await listScenarios();
  const selectedIds = searchParams.a || searchParams.b
    ? [searchParams.a, searchParams.b].filter((id): id is string => Boolean(id))
    : scenarios.slice(0, 2).map((s) => s.id);
  const selected = scenarios.filter((s) => selectedIds.includes(s.id));

  const projections = await Promise.all(selected.map(async (s) => ({ scenario: s, projection: await projectScenario(s.assumptions) })));

  const chartHeadcountData = projections[0]?.projection.map((m, i) => {
    const row: Record<string, any> = { label: m.label };
    projections.forEach((p) => { row[p.scenario.name] = p.projection[i].totalHeadcount; });
    return row;
  }) ?? [];
  const chartCostData = projections[0]?.projection.map((m, i) => {
    const row: Record<string, any> = { label: m.label };
    projections.forEach((p) => { row[p.scenario.name] = p.projection[i].totalCostUsd; });
    return row;
  }) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Scenario Comparison</h1>
          <p className="text-sm text-muted-foreground">Side-by-side headcount and cost deltas.</p>
        </div>
        <Link href="/planning" className="text-sm text-accent hover:underline">← Back to planning</Link>
      </div>

      <Card className="p-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <Select name="a" defaultValue={selectedIds[0] ?? ""}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">vs.</span>
          <Select name="b" defaultValue={selectedIds[1] ?? ""}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Compare</button>
        </form>
      </Card>

      {projections.length >= 1 && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Headcount over time</CardTitle>
              <div className="mt-2">
                <ComparisonChart data={chartHeadcountData} seriesKeys={projections.map((p) => p.scenario.name)} yLabel="Headcount" />
              </div>
            </Card>
            <Card>
              <CardTitle>Monthly cost over time</CardTitle>
              <div className="mt-2">
                <ComparisonChart data={chartCostData} seriesKeys={projections.map((p) => p.scenario.name)} yLabel="Cost" formatY={(v) => `$${Math.round(v / 1000)}k`} />
              </div>
            </Card>
          </div>

          <Card>
            <CardTitle>Ending state (month 12) &amp; delta</CardTitle>
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th>Ending headcount</Th>
                  <Th>Annual cost run-rate</Th>
                  {projections.length > 1 && <Th>Δ headcount vs. first</Th>}
                  {projections.length > 1 && <Th>Δ cost vs. first</Th>}
                </tr>
              </thead>
              <tbody>
                {projections.map((p, i) => {
                  const ending = p.projection[p.projection.length - 1];
                  const base = projections[0].projection[projections[0].projection.length - 1];
                  const hcDelta = ending.totalHeadcount - base.totalHeadcount;
                  const costDelta = ending.totalCostUsd * 12 - base.totalCostUsd * 12;
                  const costDeltaPct = base.totalCostUsd ? (costDelta / (base.totalCostUsd * 12)) * 100 : 0;
                  return (
                    <tr key={p.scenario.id}>
                      <Td className="font-medium">{p.scenario.name}</Td>
                      <Td>{ending.totalHeadcount.toFixed(0)}</Td>
                      <Td>{formatUSD(ending.totalCostUsd * 12)}</Td>
                      {projections.length > 1 && <Td>{i === 0 ? "—" : `${hcDelta > 0 ? "+" : ""}${hcDelta.toFixed(1)}`}</Td>}
                      {projections.length > 1 && <Td>{i === 0 ? "—" : `${costDelta > 0 ? "+" : ""}${formatUSD(costDelta)} (${formatPct(costDeltaPct)})`}</Td>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
