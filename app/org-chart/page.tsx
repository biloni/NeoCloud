import Link from "next/link";
import { getOrgChartView, type OrgChartNode } from "@/lib/orgchart";
import { Card, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATION_PENDING: "destructive",
  CONTRACTOR: "default",
};

function NodeCard({
  node,
  href,
  size = "md",
}: {
  node: OrgChartNode;
  href: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "card flex flex-col gap-0.5 px-3 py-2 transition-colors hover:border-accent hover:bg-accent/5",
        size === "lg" && "border-accent bg-accent/5 px-4 py-3",
        size === "sm" && "px-2.5 py-1.5"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("font-medium", size === "lg" ? "text-sm" : "text-xs")}>{node.legalName}</span>
        <Badge variant={STATUS_VARIANT[node.status] ?? "default"} className="shrink-0">{node.level}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{node.workerId} · {node.department}</span>
        {node.directReportCount > 0 && <span>{node.directReportCount} report{node.directReportCount === 1 ? "" : "s"}</span>}
      </div>
    </Link>
  );
}

export default async function OrgChartPage({ searchParams }: { searchParams: { center?: string } }) {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/org-chart", "/home");

  const centerId = (searchParams.center ?? "E0000").toUpperCase();
  const view = await getOrgChartView(centerId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Org Chart</h1>
          <p className="text-sm text-muted-foreground">Click any card to re-center the chart on that person.</p>
        </div>
        <form method="get" className="flex gap-2">
          <input
            name="center"
            defaultValue={centerId}
            placeholder="Jump to worker ID (e.g. E0007)"
            className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Go</button>
        </form>
      </div>

      {!view ? (
        <Card>
          <p className="text-sm text-destructive">No current worker found for "{centerId}". Try an ID like E0000 (CEO) or E0007.</p>
        </Card>
      ) : (
        <div className="flex flex-col items-center gap-0">
          {/* Manager chain, root (CEO) first */}
          {view.managerChain.length > 0 && (
            <div className="flex flex-col items-center">
              {view.managerChain.map((m, i) => (
                <div key={m.workerId} className="flex flex-col items-center">
                  <NodeCard node={m} href={`/org-chart?center=${m.workerId}`} size="sm" />
                  <div className="h-5 w-px bg-border" />
                </div>
              ))}
            </div>
          )}

          {/* Center */}
          <div className="w-72">
            <NodeCard node={view.center} href={`/org-chart?center=${view.center.workerId}`} size="lg" />
          </div>

          {/* Direct reports */}
          {view.directReports.length > 0 ? (
            <>
              <div className="h-5 w-px bg-border" />
              <div className="relative w-full">
                {view.directReports.length > 1 && (
                  <div
                    className="absolute top-0 h-px bg-border"
                    style={{ left: `${100 / view.directReports.length / 2}%`, right: `${100 / view.directReports.length / 2}%` }}
                  />
                )}
                <div className="grid gap-4 pt-5" style={{ gridTemplateColumns: `repeat(${Math.min(view.directReports.length, 5)}, minmax(0, 1fr))` }}>
                  {view.directReports.map((r) => (
                    <div key={r.workerId} className="flex flex-col items-center gap-0">
                      <div className="-mt-5 mb-0 h-5 w-px bg-border" />
                      <NodeCard node={r} href={`/org-chart?center=${r.workerId}`} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="mt-4 text-sm text-muted-foreground">No direct reports — individual contributor.</div>
          )}
        </div>
      )}
    </div>
  );
}
