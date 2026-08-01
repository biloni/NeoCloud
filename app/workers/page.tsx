import Link from "next/link";
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { Card, Table, Th, Td, Badge, Select } from "@/components/ui";
import { formatUSD, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATION_PENDING: "destructive",
  CONTRACTOR: "default",
  TERMINATED: "default",
};

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: { department?: string; location?: string; status?: string; level?: string; q?: string };
}) {
  const snapshot = await getWorkforceSnapshot();
  const current = snapshot.filter((r) => r.status !== "TERMINATED");

  const departments = Array.from(new Set(current.map((r) => r.department))).sort();
  const locations = Array.from(new Set(current.map((r) => r.locationName))).sort();
  const levels = Array.from(new Set(current.map((r) => r.level))).sort();

  const filtered = current.filter((r) => {
    if (searchParams.department && r.department !== searchParams.department) return false;
    if (searchParams.location && r.locationName !== searchParams.location) return false;
    if (searchParams.status && r.status !== searchParams.status) return false;
    if (searchParams.level && r.level !== searchParams.level) return false;
    if (searchParams.q) {
      const q = searchParams.q.toLowerCase();
      if (!r.legalName.toLowerCase().includes(q) && !r.workerId.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Workers</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} of {current.length} current workers</p>
      </div>

      <Card className="p-3">
        <form className="flex flex-wrap items-center gap-2" method="get">
          <input
            name="q"
            defaultValue={searchParams.q}
            placeholder="Search name or ID..."
            className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <Select name="department" defaultValue={searchParams.department ?? ""}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select name="location" defaultValue={searchParams.location ?? ""}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Select name="level" defaultValue={searchParams.level ?? ""}>
            <option value="">All levels</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Select name="status" defaultValue={searchParams.status ?? ""}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="TERMINATION_PENDING">Termination pending</option>
            <option value="CONTRACTOR">Contractor</option>
          </Select>
          <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" type="submit">
            Filter
          </button>
          {(searchParams.department || searchParams.location || searchParams.level || searchParams.status || searchParams.q) && (
            <Link href="/workers" className="text-xs text-muted-foreground underline">Clear</Link>
          )}
        </form>
      </Card>

      <Table>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Name</Th>
            <Th>Department</Th>
            <Th>Location</Th>
            <Th>Level</Th>
            <Th>Manager</Th>
            <Th>Hire date</Th>
            <Th>Comp (USD)</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 500).map((r) => (
            <tr key={r.workerId} className="hover:bg-muted/50">
              <Td>
                <Link href={`/workers/${r.workerId}`} className="font-medium text-accent hover:underline">
                  {r.workerId}
                </Link>
              </Td>
              <Td>{r.legalName}</Td>
              <Td>{r.department}</Td>
              <Td>{r.locationName}</Td>
              <Td>{r.level}</Td>
              <Td>{r.managerName ?? "—"}</Td>
              <Td>{formatDate(r.hireDate)}</Td>
              <Td>{formatUSD(r.annualSalaryUsd)}</Td>
              <Td>
                <Badge variant={STATUS_VARIANT[r.status] ?? "default"}>{r.status.replace(/_/g, " ")}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
