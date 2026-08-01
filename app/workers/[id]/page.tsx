import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { Card, CardTitle, Badge } from "@/components/ui";
import { formatDate, formatMoney, formatUSD } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WorkerDetailPage({ params }: { params: { id: string } }) {
  const workerId = params.id.toUpperCase();
  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) notFound();

  const [compRecords, assignments, events] = await Promise.all([
    prisma.compRecord.findMany({ where: { workerId }, orderBy: { effectiveFrom: "asc" } }),
    prisma.positionAssignment.findMany({ where: { workerId }, orderBy: { effectiveFrom: "asc" }, include: { position: { include: { jobProfile: true, location: true, supOrg: true } } } }),
    prisma.workerEvent.findMany({ where: { workerId }, orderBy: { effectiveDate: "asc" } }),
  ]);

  const snapshot = await getWorkforceSnapshot();
  const current = snapshot.find((r) => r.workerId === workerId);

  const timeline = [
    ...compRecords.map((c) => ({
      date: c.effectiveFrom,
      kind: "Compensation" as const,
      label: `${c.reason}: ${formatMoney(Number(c.annualSalary), c.currency)}/yr`,
      detail: c.effectiveTo ? `Effective ${formatDate(c.effectiveFrom)} → ${formatDate(c.effectiveTo)}` : `Effective ${formatDate(c.effectiveFrom)} → current`,
    })),
    ...assignments.map((a) => ({
      date: a.effectiveFrom,
      kind: "Position" as const,
      label: `${a.position.jobProfile.title} (${a.position.jobProfile.level}) · ${a.position.location.name}`,
      detail: a.effectiveTo ? `Effective ${formatDate(a.effectiveFrom)} → ${formatDate(a.effectiveTo)}` : `Effective ${formatDate(a.effectiveFrom)} → current`,
    })),
    ...events.map((e) => ({
      date: e.effectiveDate,
      kind: "Event" as const,
      label: e.type.replace(/_/g, " "),
      detail: (() => {
        try {
          const p = JSON.parse(e.payload);
          return Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(" · ");
        } catch {
          return "";
        }
      })(),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="flex flex-col gap-4">
      <Link href="/workers" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to workers
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{worker.legalName}</h1>
          <p className="text-sm text-muted-foreground">{workerId} · {current?.department ?? "—"} · {current?.locationName ?? "—"}</p>
        </div>
        <Badge variant={worker.status === "ACTIVE" ? "success" : worker.status === "TERMINATED" ? "default" : "warning"}>
          {worker.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {current && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardTitle>Level</CardTitle>
            <div className="mt-1 text-lg font-medium">{current.level}</div>
          </Card>
          <Card>
            <CardTitle>Manager</CardTitle>
            <div className="mt-1 text-lg font-medium">{current.managerName ?? "—"}</div>
          </Card>
          <Card>
            <CardTitle>Current comp</CardTitle>
            <div className="mt-1 text-lg font-medium">{formatMoney(current.annualSalaryLocal, current.currency)}</div>
            {current.currency !== "USD" && <div className="text-xs text-muted-foreground">{formatUSD(current.annualSalaryUsd)}</div>}
          </Card>
          <Card>
            <CardTitle>Tenure</CardTitle>
            <div className="mt-1 text-lg font-medium">{Math.floor(current.tenureDays / 365)}y {Math.floor((current.tenureDays % 365) / 30)}m</div>
          </Card>
        </div>
      )}

      <Card>
        <CardTitle>Effective-dated history</CardTitle>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          Every row below is a distinct record with its own effective date range — nothing here was
          overwritten in place. This is the effective-dating demo: compensation, position, and events
          are separate append-only tables (see CLAUDE.md).
        </p>
        <ol className="flex flex-col gap-2 border-l border-border pl-4">
          {timeline.map((t, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-muted-foreground">{formatDate(t.date)}</span>
                <Badge variant={t.kind === "Compensation" ? "accent" : t.kind === "Position" ? "default" : "warning"}>{t.kind}</Badge>
              </div>
              <div className="text-sm font-medium">{t.label}</div>
              {t.detail && <div className="text-xs text-muted-foreground">{t.detail}</div>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
