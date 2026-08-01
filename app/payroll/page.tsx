import { getPayrollPreview, detectAnomalies, buildGlPosting, type PayrollRollup } from "@/lib/payroll";
import { getAcknowledgments } from "@/lib/anomaly-ack";
import { Card, CardTitle, KpiCard, Table, Th, Td, Badge, Select } from "@/components/ui";
import { AnomalyPanel, type AnomalyItem } from "@/components/payroll/AnomalyPanel";
import { formatUSD, formatMoney, formatDate } from "@/lib/utils";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId } from "@/security/authorization";

export const dynamic = "force-dynamic";

function RollupTable({ title, rows, firstColLabel }: { title: string; rows: PayrollRollup[]; firstColLabel: string }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <Table className="mt-3">
        <thead>
          <tr>
            <Th>{firstColLabel}</Th><Th>Headcount</Th><Th>Gross</Th><Th>Burden</Th><Th>Bonus</Th><Th>Stock</Th><Th>Net cost</Th><Th>Total cost</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <Td>{r.key}</Td>
              <Td>{r.headcount}</Td>
              <Td>{formatUSD(r.grossUsd)}</Td>
              <Td>{formatUSD(r.burdenUsd)}</Td>
              <Td>{formatUSD(r.bonusUsd)}</Td>
              <Td>{formatUSD(r.stockUsd)}</Td>
              <Td>{formatUSD(r.netCostUsd)}</Td>
              <Td className="font-medium">{formatUSD(r.totalCostUsd)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export default async function PayrollPage({ searchParams }: { searchParams: { payOnLeave?: string } }) {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/payroll", "/home");

  const payOnLeave = searchParams.payOnLeave === "true";
  const result = await getPayrollPreview(new Date(), payOnLeave);
  const anomalies = await detectAnomalies(result);
  const gl = buildGlPosting(result);

  const acks = await getAcknowledgments(anomalies.map((a) => a.key));
  const anomalyItems: AnomalyItem[] = anomalies.map((a) => {
    const ack = acks.get(a.key);
    return {
      ...a,
      acknowledged: Boolean(ack),
      acknowledgedBy: ack?.acknowledgedBy,
      acknowledgedAt: ack?.createdAt.toISOString(),
    };
  });
  const actorId = effectiveWorkerId(ctx);

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
        <KpiCard label="Gross" value={formatUSD(result.totals.grossUsd)} sub="This period, USD" />
        <KpiCard label="Employer tax" value={formatUSD(result.totals.taxUsd)} />
        <KpiCard label="Benefits" value={formatUSD(result.totals.benefitsUsd)} />
        <KpiCard label="Payroll burden" value={formatUSD(result.totals.burdenUsd)} sub="Tax + benefits" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Net cost" value={formatUSD(result.totals.netCostUsd)} sub="Gross + burden" />
        <KpiCard label="Bonus accrual" value={formatUSD(result.totals.bonusUsd)} sub="Synthetic, level-based" />
        <KpiCard label="Stock comp" value={formatUSD(result.totals.stockUsd)} sub="Synthetic, level-based" />
        <KpiCard label="Total cost" value={formatUSD(result.totals.totalCostUsd)} sub="Net cost + bonus + stock" />
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
            {result.reconciliation.deltas.length} flagged discrepanc{result.reconciliation.deltas.length === 1 ? "y" : "ies"} between active headcount and payroll headcount:
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
              {result.reconciliation.deltas.length === 0 && (
                <tr><Td colSpan={2} className="text-center text-muted-foreground">No discrepancies — payroll headcount matches active headcount.</Td></tr>
              )}
            </tbody>
          </Table>
        </div>
      </Card>

      <RollupTable title="Department totals" rows={result.byDepartment} firstColLabel="Department" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RollupTable title="Location totals" rows={result.byLocation} firstColLabel="Location" />
        <RollupTable title="Country totals" rows={result.byCountry} firstColLabel="Country" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Anomaly detection</h2>
        <AnomalyPanel items={anomalyItems} actorId={actorId} />
      </div>

      <Card>
        <CardTitle>GL posting — journal entry</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Salary/Tax/Benefits credit Accrued Payroll (cash liability). Bonus credits Accrued Bonus Payable.
          Stock compensation credits Additional Paid-in Capital — non-cash, per ASC 718.
        </p>
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
          <thead><tr><Th>Worker</Th><Th>Dept</Th><Th>Status</Th><Th>Gross</Th><Th>Burden</Th><Th>Net cost</Th><Th>Included</Th><Th>Note</Th></tr></thead>
          <tbody>
            {result.lineItems.map((l) => (
              <tr key={l.workerId} className={l.included ? "" : "opacity-60"}>
                <Td>{l.legalName} ({l.workerId})</Td>
                <Td>{l.department}</Td>
                <Td><Badge variant={l.status === "ACTIVE" ? "success" : "warning"}>{l.status.replace(/_/g, " ")}</Badge></Td>
                <Td>{l.included ? formatMoney(l.periodGrossLocal, l.currency) : "—"}</Td>
                <Td>{l.included ? formatUSD(l.payrollBurdenUsd) : "—"}</Td>
                <Td>{l.included ? formatUSD(l.netCostUsd) : "—"}</Td>
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
