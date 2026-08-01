import Link from "next/link";
import { listScenarios, projectScenario } from "@/lib/planning";
import { Card, CardTitle, Badge, Table, Th, Td } from "@/components/ui";
import { ProjectionChart } from "@/components/charts/ProjectionChart";
import { CreateScenarioForm } from "@/components/processes/CreateScenarioForm";
import { formatUSD, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlanningPage({ searchParams }: { searchParams: { scenario?: string } }) {
  const scenarios = await listScenarios();
  const selected = scenarios.find((s) => s.id === searchParams.scenario) ?? scenarios[0];
  const projection = selected ? await projectScenario(selected.assumptions) : [];

  const chartData = projection.map((m) => ({ label: m.label, totalHeadcount: m.totalHeadcount, totalCostUsd: m.totalCostUsd }));
  const ending = projection[projection.length - 1];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workforce Planning</h1>
          <p className="text-sm text-muted-foreground">Model hires, attrition, and merit over the next 12 months.</p>
        </div>
        <Link href="/planning/compare" className="text-sm text-accent hover:underline">Compare scenarios →</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <Link
            key={s.id}
            href={`/planning?scenario=${s.id}`}
            className={`rounded-full border px-3 py-1.5 text-sm ${selected?.id === s.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {s.name}
          </Link>
        ))}
      </div>

      {selected && (
        <>
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{selected.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
              </div>
              {ending && (
                <div className="flex gap-4 text-right">
                  <div>
                    <div className="text-lg font-semibold">{ending.totalHeadcount.toFixed(0)}</div>
                    <div className="text-xs text-muted-foreground">Ending headcount</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{formatUSD(ending.totalCostUsd * 12)}</div>
                    <div className="text-xs text-muted-foreground">Run-rate annual cost (mo. 12)</div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4">
              <ProjectionChart data={chartData} />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardTitle>Attrition assumptions (annualized)</CardTitle>
              <Table className="mt-3">
                <thead><tr><Th>Dept</Th><Th>Rate</Th></tr></thead>
                <tbody>
                  {Object.entries(selected.assumptions.attritionByDept).map(([d, v]) => (
                    <tr key={d}><Td>{d}</Td><Td>{formatPct(v)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardTitle>Merit assumptions (annualized)</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Effective {new Date(selected.assumptions.meritEffectiveDate).toLocaleDateString()}</p>
              <Table className="mt-3">
                <thead><tr><Th>Level</Th><Th>Rate</Th></tr></thead>
                <tbody>
                  {Object.entries(selected.assumptions.meritByLevel).map(([l, v]) => (
                    <tr key={l}><Td>{l}</Td><Td>{formatPct(v)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardTitle>Hire plan</CardTitle>
              <Table className="mt-3">
                <thead><tr><Th>Dept</Th><Th>Qtr</Th><Th>Count</Th><Th>Level</Th><Th>Location</Th></tr></thead>
                <tbody>
                  {selected.assumptions.hirePlan.map((h, i) => (
                    <tr key={i}><Td>{h.department}</Td><Td>{h.quarter}</Td><Td>{h.count}</Td><Td>{h.targetLevel}</Td><Td>{h.targetLocation}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
        </>
      )}

      <CreateScenarioForm />
    </div>
  );
}
