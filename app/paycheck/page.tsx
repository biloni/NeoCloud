import { getPayrollPreview } from "@/lib/payroll";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId } from "@/security/authorization";
import { Card, CardTitle, Badge } from "@/components/ui";
import { formatMoney, formatUSD, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Reuses the exact same getPayrollPreview() the /payroll admin view uses —
// no separate "compute my own pay" logic — and just picks out this
// worker's own line item.
export default async function PaycheckPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/paycheck", "/home");
  const workerId = effectiveWorkerId(ctx);

  const result = await getPayrollPreview(new Date());
  const mine = result.lineItems.find((l) => l.workerId === workerId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Paycheck</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(result.period.start)} – {formatDate(result.period.end)} · semi-monthly period
        </p>
      </div>

      {!mine ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No paycheck this period{mine === undefined ? " — you may be excluded (contractor, unpaid leave) or not currently active." : ""}.
          </p>
        </Card>
      ) : (
        <>
          {!mine.included && (
            <Card className="border-warning/40 bg-warning/5">
              <div className="text-sm font-medium">Not paid this period</div>
              <div className="text-xs text-muted-foreground">{mine.exclusionReason}</div>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardTitle>Gross pay</CardTitle>
              <div className="mt-1 text-lg font-medium">{formatMoney(mine.periodGrossLocal, mine.currency)}</div>
              {mine.currency !== "USD" && <div className="text-xs text-muted-foreground">{formatUSD(mine.periodGrossUsd)}</div>}
            </Card>
            <Card>
              <CardTitle>Employer tax (paid by NeoCloud)</CardTitle>
              <div className="mt-1 text-lg font-medium">{formatUSD(mine.employerTaxUsd)}</div>
            </Card>
            <Card>
              <CardTitle>Benefits (paid by NeoCloud)</CardTitle>
              <div className="mt-1 text-lg font-medium">{formatUSD(mine.benefitsUsd)}</div>
            </Card>
            <Card>
              <CardTitle>Status</CardTitle>
              <div className="mt-1"><Badge variant={mine.included ? "success" : "warning"}>{mine.included ? "Paid" : "Excluded"}</Badge></div>
              {mine.flag && <div className="mt-1 text-xs text-muted-foreground">{mine.flag}</div>}
            </Card>
          </div>
          <Card>
            <CardTitle>Total cost to company</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Gross + employer tax + benefits + bonus accrual + stock compensation — this is what NeoCloud pays for your role this period, not your take-home pay.</p>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatUSD(mine.totalCostUsd)}</div>
          </Card>
        </>
      )}
    </div>
  );
}
