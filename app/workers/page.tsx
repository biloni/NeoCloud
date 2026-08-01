import Link from "next/link";
import { getWorkforceSnapshot, type WorkerSnapshotRow } from "@/lib/snapshot";
import { Card, Table, Th, Td, Badge, Select } from "@/components/ui";
import { formatUSD, formatDate, cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATION_PENDING: "destructive",
  CONTRACTOR: "default",
  TERMINATED: "default",
};

const COUNTRY_NAMES: Record<string, string> = { US: "United States", CA: "Canada", GB: "United Kingdom", IN: "India" };

const SORT_FIELDS = {
  name: (r: WorkerSnapshotRow) => r.legalName,
  department: (r: WorkerSnapshotRow) => r.department,
  location: (r: WorkerSnapshotRow) => r.locationName,
  level: (r: WorkerSnapshotRow) => r.level,
  manager: (r: WorkerSnapshotRow) => r.managerName ?? "",
  hireDate: (r: WorkerSnapshotRow) => r.hireDate.getTime(),
  comp: (r: WorkerSnapshotRow) => r.annualSalaryUsd,
  status: (r: WorkerSnapshotRow) => r.status,
} as const;
type SortField = keyof typeof SORT_FIELDS;

const PAGE_SIZE = 25;

interface WorkersSearchParams {
  q?: string;
  department?: string;
  location?: string;
  level?: string;
  status?: string;
  manager?: string;
  country?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

function buildQuery(sp: WorkersSearchParams, overrides: Partial<WorkersSearchParams>): string {
  const merged = { ...sp, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/workers?${qs}` : "/workers";
}

function SortHeader({ label, field, sp }: { label: string; field: SortField; sp: WorkersSearchParams }) {
  const currentField = (sp.sort as SortField) ?? "name";
  const currentDir = sp.dir === "desc" ? "desc" : "asc";
  const isActive = currentField === field;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";
  return (
    <Th>
      <Link href={buildQuery(sp, { sort: field, dir: nextDir, page: undefined })} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {isActive ? (
          currentDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="opacity-40" />
        )}
      </Link>
    </Th>
  );
}

export default async function WorkersPage({ searchParams }: { searchParams: WorkersSearchParams }) {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/workers", "/home");

  const snapshot = await getWorkforceSnapshot();
  const current = snapshot.filter((r) => r.status !== "TERMINATED");

  const departments = Array.from(new Set(current.map((r) => r.department))).sort();
  const locations = Array.from(new Set(current.map((r) => r.locationName))).sort();
  const levels = Array.from(new Set(current.map((r) => r.level))).sort();
  const countries = Array.from(new Set(current.map((r) => r.countryCode))).sort();
  const managers = Array.from(new Map(current.filter((r) => r.managerId).map((r) => [r.managerId as string, r.managerName as string])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));

  const filtered = current.filter((r) => {
    if (searchParams.department && r.department !== searchParams.department) return false;
    if (searchParams.location && r.locationName !== searchParams.location) return false;
    if (searchParams.status && r.status !== searchParams.status) return false;
    if (searchParams.level && r.level !== searchParams.level) return false;
    if (searchParams.country && r.countryCode !== searchParams.country) return false;
    if (searchParams.manager && r.managerId !== searchParams.manager) return false;
    if (searchParams.q) {
      const q = searchParams.q.toLowerCase();
      if (!r.legalName.toLowerCase().includes(q) && !r.workerId.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortField = (searchParams.sort as SortField) in SORT_FIELDS ? (searchParams.sort as SortField) : "name";
  const sortDir = searchParams.dir === "desc" ? -1 : 1;
  const sortFn = SORT_FIELDS[sortField];
  const sorted = [...filtered].sort((a, b) => {
    const av = sortFn(a);
    const bv = sortFn(b);
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return a.workerId.localeCompare(b.workerId);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(searchParams.page) || 1), totalPages);
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasFilters = Boolean(
    searchParams.department || searchParams.location || searchParams.level || searchParams.status ||
    searchParams.manager || searchParams.country || searchParams.q
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Employee Directory</h1>
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
          <Select name="manager" defaultValue={searchParams.manager ?? ""}>
            <option value="">All managers</option>
            {managers.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
          </Select>
          <Select name="status" defaultValue={searchParams.status ?? ""}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="TERMINATION_PENDING">Termination pending</option>
            <option value="CONTRACTOR">Contractor</option>
          </Select>
          <Select name="country" defaultValue={searchParams.country ?? ""}>
            <option value="">All countries</option>
            {countries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>)}
          </Select>
          <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href="/workers" className="text-xs text-muted-foreground underline">Clear</Link>
          )}
        </form>
      </Card>

      <Table>
        <thead>
          <tr>
            <Th>ID</Th>
            <SortHeader label="Name" field="name" sp={searchParams} />
            <SortHeader label="Department" field="department" sp={searchParams} />
            <SortHeader label="Location" field="location" sp={searchParams} />
            <SortHeader label="Level" field="level" sp={searchParams} />
            <SortHeader label="Manager" field="manager" sp={searchParams} />
            <SortHeader label="Hire date" field="hireDate" sp={searchParams} />
            <SortHeader label="Comp (USD)" field="comp" sp={searchParams} />
            <SortHeader label="Status" field="status" sp={searchParams} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
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
          {pageRows.length === 0 && (
            <tr>
              <Td colSpan={9} className="text-center text-muted-foreground">No workers match these filters.</Td>
            </tr>
          )}
        </tbody>
      </Table>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Showing {sorted.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
        </span>
        <div className="flex items-center gap-1">
          <Link
            href={buildQuery(searchParams, { page: String(Math.max(1, page - 1)) })}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted",
              page <= 1 && "pointer-events-none opacity-40"
            )}
            aria-disabled={page <= 1}
          >
            <ChevronLeft size={14} />
          </Link>
          <span className="px-2 text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Link
            href={buildQuery(searchParams, { page: String(Math.min(totalPages, page + 1)) })}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted",
              page >= totalPages && "pointer-events-none opacity-40"
            )}
            aria-disabled={page >= totalPages}
          >
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
