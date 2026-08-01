import Link from "next/link";
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { getDirectReportIds, getIndirectReportIds } from "@/lib/org-hierarchy";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId, can } from "@/security/authorization";
import { Permission } from "@/security/permissions";
import { Card, CardTitle, Table, Th, Td, Badge } from "@/components/ui";
import { formatUSD, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATION_PENDING: "destructive",
  CONTRACTOR: "default",
};

function ReportsTable({ rows }: { rows: Awaited<ReturnType<typeof getWorkforceSnapshot>> }) {
  return (
    <Table>
      <thead>
        <tr><Th>Name</Th><Th>Level</Th><Th>Department</Th><Th>Location</Th><Th>Hire date</Th><Th>Comp (USD)</Th><Th>Status</Th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.workerId}>
            <Td><Link href={`/workers/${r.workerId}`} className="font-medium text-accent hover:underline">{r.legalName}</Link></Td>
            <Td>{r.level}</Td>
            <Td>{r.department}</Td>
            <Td>{r.locationName}</Td>
            <Td>{formatDate(r.hireDate)}</Td>
            <Td>{formatUSD(r.annualSalaryUsd)}</Td>
            <Td><Badge variant={STATUS_VARIANT[r.status] ?? "default"}>{r.status.replace(/_/g, " ")}</Badge></Td>
          </tr>
        ))}
        {rows.length === 0 && <tr><Td colSpan={7} className="text-center text-muted-foreground">None.</Td></tr>}
      </tbody>
    </Table>
  );
}

export default async function DirectReportsPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/team/reports", "/home");
  const managerId = effectiveWorkerId(ctx);
  const isSkipLevel = can(ctx, Permission.VIEW_INDIRECT_REPORTS);

  const [snapshot, directIds, indirectIds] = await Promise.all([
    getWorkforceSnapshot(),
    getDirectReportIds(managerId),
    isSkipLevel ? getIndirectReportIds(managerId) : Promise.resolve(new Set<string>()),
  ]);

  const direct = snapshot.filter((r) => directIds.has(r.workerId) && r.status !== "TERMINATED");
  const indirect = snapshot.filter((r) => indirectIds.has(r.workerId) && r.status !== "TERMINATED");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Direct Reports</h1>
        <p className="text-sm text-muted-foreground">{direct.length} direct report{direct.length === 1 ? "" : "s"}{isSkipLevel && `, ${indirect.length} indirect`}</p>
      </div>

      <Card>
        <CardTitle>Direct reports</CardTitle>
        <div className="mt-3"><ReportsTable rows={direct} /></div>
      </Card>

      {isSkipLevel && (
        <Card>
          <CardTitle>Indirect reports</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Reports of your direct reports — visible because you hold Skip Level Manager access.</p>
          <div className="mt-3"><ReportsTable rows={indirect} /></div>
        </Card>
      )}
    </div>
  );
}
