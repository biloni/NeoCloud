import { getPayrollPreview, detectAnomalies, buildGlPosting } from "@/lib/payroll";
import { Card, CardTitle, KpiCard, Table, Th, Td, Badge, Select } from "@/components/ui";
import { formatUSD, formatMoney, formatDate, formatPct } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: { payOnLeave?: string } }) {
  const payOnLeave = searchParams.payOnLeave === "true";
  const result = await getPayrollPreview(new Date(), payOnLeave);
  const { workerAnomalies, deptAnomalies } = await detectAnomalies(result);
  const gl = buildGlPosting(result);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Payroll Preview</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(result.period.start)} – {formatDate(result.period.end)} · semi-monthly period
          </p>
        </div>
        <form method="get" className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">On-leave pay</label>
          <Select name="payOnLeave" defaultValue={payOnLeave ? "true" : "false"}>
            <option value="false">Unpaid (default)</option>
            <option value="true">Paid</option>
          </Select>
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Apply</button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total gross" value={formatUSD(result.totals.grossUsd)} sub="This period, USD" />
        <KpiCard label="Employer taxes" value={formatUSD(result.totals.taxUsd)} />
        <KpiCard label="Benefits load" value={formatUSD(result.totals.benefitsUsd)} />
        <KpiCard label="Total burdened cost" value={formatUSD(result.totals.burdenedUsd)} />
      </div>

      <Card className="border-accent/40">
        <CardTitle>Reconciliation — worker count vs. payroll headcount</CardTitle>
        <div className="mt-3 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-semibold">{result.reconciliation.totalWorkerCount}</div>
            <div className="text-xs text-muted-foreground">Total worker records (incl. terminated history)</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{result.reconciliation.activeWorkerCount}</div>
            <div className="text-xs text-muted-foreground">Active workers</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-accent">{result.reconciliation.payrollHeadcount}</div>
            <div className="text-xs text-muted-foreground">Paid this period</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {result.reconciliation.deltas.length} named delta{result.reconciliation.deltas.length === 1 ? "" : "s"} between active headcount and payroll headcount:
          </div>
          <Table>
            <thead><tr><Th>Worker</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {result.reconciliation.deltas.map((d) => (
                <tr key={d.workerId}>
                  <Td>{d.legalName} ({d.workerId})</Td>
                  <Td className="text-muted-foreground">{d.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Rollup by department</CardTitle>
          <Table className="mt-3">
            <thead><tr><Th>Dept</Th><Th>Headcount</Th><Th>Gross</Th><Th>Taxes</Th><Th>Benefits</Th><Th>Burdened</Th></tr></thead>
            <tbody>
              {result.byDepartment.map((d) => (
                <tr key={d.department}>
                  <Td>{d.department}</Td><Td>{d.headcount}</Td>
                  <Td>{formatUSD(d.grossUsd)}</Td><Td>{formatUSD(d.taxUsd)}</Td><Td>{formatUSD(d.benefitsUsd)}</Td>
                  <Td className="font-medium">{formatUSD(d.burdenedUsd)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardTitle>Rollup by location</CardTitle>
          <Table className="mt-3">
            <thead><tr><Th>Location</Th><Th>Headcount</Th><Th>Gross</Th><Th>Burdened</Th></tr></thead>
            <tbody>
              {result.byLocation.map((l) => (
                <tr key={l.location}>
                  <Td>{l.location}</Td><Td>{l.headcount}</Td><Td>{formatUSD(l.grossUsd)}</Td><Td className="font-medium">{formatUSD(l.burdenedUsd)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardTitle>Anomaly flags</CardTitle>
        <div className="mt-3 flex flex-col gap-2">
          {deptAnomalies.map((a) => (
            <div key={a.department} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
              <Badge variant="warning">Dept</Badge>
              <div>
                <div className="font-medium">{a.department}: {formatUSD(a.currentBurdenedUsd)} vs {formatUSD(a.priorBurdenedUsd)} prior ({formatPct(a.deviationPct)})</div>
                <div className="text-xs text-muted-foreground">{a.explanation}</div>
              </div>
            </div>
          ))}
          {workerAnomalies.map((a) => (
            <div key={a.workerId} className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <Badge variant="destructive">Worker</Badge>
              <div>
                <div className="font-medium">{a.legalName} ({a.workerId}): {formatUSD(a.currentGrossUsd)} vs {formatUSD(a.trailingAvgUsd)} trailing avg ({formatPct(a.deviationPct)})</div>
                <div className="text-xs text-muted-foreground">{a.explanation}</div>
              </div>
            </div>
          ))}
          {deptAnomalies.length === 0 && workerAnomalies.length === 0 && (
            <div className="text-sm text-muted-foreground">No anomalies detected this period.</div>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>GL posting — journal entry</CardTitle>
        <Table className="mt-3">
          <thead><tr><Th>Cost center</Th><Th>Account</Th><Th>Code</Th><Th>Debit</Th><Th>Credit</Th></tr></thead>
          <tbody>
            {gl.lines.map((l, i) => (
              <tr key={i}>
                <Td>{l.costCenter}</Td><Td>{l.account}</Td><Td>{l.accountCode}</Td>
                <Td>{l.debit ? formatUSD(l.debit) : "—"}</Td><Td>{l.credit ? formatUSD(l.credit) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Badge variant={gl.balanced ? "success" : "destructive"}>{gl.balanced ? "Balanced" : "Out of balance"}</Badge>
          <span className="text-muted-foreground">Debits {formatUSD(gl.totalDebit)} = Credits {formatUSD(gl.totalCredit)}</span>
        </div>
      </Card>

      <Card>
        <CardTitle>Worker-level detail</CardTitle>
        <Table className="mt-3">
          <thead><tr><Th>Worker</Th><Th>Dept</Th><Th>Status</Th><Th>Gross</Th><Th>Included</Th><Th>Note</Th></tr></thead>
          <tbody>
            {result.lineItems.map((l) => (
              <tr key={l.workerId} className={l.included ? "" : "opacity-60"}>
                <Td>{l.legalName} ({l.workerId})</Td>
                <Td>{l.department}</Td>
                <Td><Badge variant={l.status === "ACTIVE" ? "success" : "warning"}>{l.status.replace(/_/g, " ")}</Badge></Td>
                <Td>{l.included ? formatMoney(l.periodGrossLocal, l.currency) : "—"}</Td>
                <Td>{l.included ? "Yes" : "No"}</Td>
                <Td className="text-xs text-muted-foreground">{l.exclusionReason ?? l.flag ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
