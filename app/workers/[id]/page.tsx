import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { getOrgChartView } from "@/lib/orgchart";
import { getInstancesForWorker } from "@/lib/bp-engine";
import { Card, CardTitle, Badge, Table, Th, Td, EmptyState } from "@/components/ui";
import { ProfileTabs, type ProfileTab } from "@/components/workers/ProfileTabs";
import { ProfileChangeRequestForm } from "@/components/workers/ProfileChangeRequestForm";
import { formatDate, formatMoney, formatUSD } from "@/lib/utils";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getAuthContext } from "@/lib/auth-context";
import { canViewEmployee, canEditEmployee, effectiveWorkerId } from "@/security/authorization";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATION_PENDING: "destructive",
  CONTRACTOR: "default",
  TERMINATED: "default",
};
const STEP_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  PENDING: "warning",
  APPROVED: "success",
  DENIED: "destructive",
  SKIPPED_BY_RULE: "default",
  SENT_BACK: "destructive",
};

export default async function WorkerDetailPage({ params }: { params: { id: string } }) {
  const workerId = params.id.toUpperCase();

  const ctx = await getAuthContext();
  // Data-access guard: Employee (self only) / Manager (self + direct
  // reports) / Skip Level (+ indirect reports) / everyone-scope roles.
  // This is the one page every one of those roles can reach (via "Profile"
  // or "Direct Reports" links) even without VIEW_WORKER_DIRECTORY, so the
  // check lives here rather than only on the /workers list.
  if (!(await canViewEmployee(ctx, workerId))) redirect("/home");
  const canEdit = await canEditEmployee(ctx, workerId);

  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) notFound();

  const [compRecords, assignments, events, snapshot, orgView, bpInstances] = await Promise.all([
    prisma.compRecord.findMany({ where: { workerId }, orderBy: { effectiveFrom: "asc" } }),
    prisma.positionAssignment.findMany({ where: { workerId }, orderBy: { effectiveFrom: "asc" }, include: { position: { include: { jobProfile: true, location: true, supOrg: true } } } }),
    prisma.workerEvent.findMany({ where: { workerId }, orderBy: { effectiveDate: "asc" } }),
    getWorkforceSnapshot(),
    getOrgChartView(workerId),
    getInstancesForWorker(workerId),
  ]);
  const current = snapshot.find((r) => r.workerId === workerId);

  // ---------- Overview timeline ----------
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
      detail: formatPayload(e.payload),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const isSelf = workerId === effectiveWorkerId(ctx);
  const overviewContent = (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="mb-3 text-xs text-muted-foreground">
          Every row below is a distinct record with its own effective date range — nothing here was
          overwritten in place. Compensation, position, and events are separate append-only tables.
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
          {timeline.length === 0 && <li className="text-sm text-muted-foreground">No history recorded.</li>}
        </ol>
      </Card>
      {(isSelf || canEdit) && <ProfileChangeRequestForm subjectWorkerId={workerId} isSelf={isSelf} />}
    </div>
  );

  // ---------- Manager / reporting line ----------
  const managerContent = !orgView ? (
    <EmptyState>Reporting line unavailable — this worker is not currently active.</EmptyState>
  ) : (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>Reporting line</CardTitle>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {orgView.managerChain.length === 0 && <span className="text-muted-foreground">No manager (top of the org)</span>}
          {orgView.managerChain.map((m) => (
            <span key={m.workerId} className="flex items-center gap-2">
              <Link href={`/workers/${m.workerId}`} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
                {m.legalName} <span className="text-xs text-muted-foreground">({m.level})</span>
              </Link>
              <ArrowRight size={12} className="text-muted-foreground" />
            </span>
          ))}
          <span className="rounded-md border border-accent bg-accent/10 px-2 py-1 font-medium text-accent">
            {orgView.center.legalName}
          </span>
        </div>
      </Card>
      <Card>
        <CardTitle>Direct reports ({orgView.directReports.length})</CardTitle>
        {orgView.directReports.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Individual contributor — no direct reports.</p>
        ) : (
          <Table className="mt-3">
            <thead><tr><Th>Name</Th><Th>Level</Th><Th>Department</Th><Th>Reports</Th></tr></thead>
            <tbody>
              {orgView.directReports.map((r) => (
                <tr key={r.workerId}>
                  <Td><Link href={`/workers/${r.workerId}`} className="text-accent hover:underline">{r.legalName}</Link></Td>
                  <Td>{r.level}</Td>
                  <Td>{r.department}</Td>
                  <Td>{r.directReportCount || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );

  // ---------- Compensation history ----------
  const compensationContent = (
    <Card>
      <Table>
        <thead><tr><Th>Reason</Th><Th>Amount</Th><Th>USD</Th><Th>Effective from</Th><Th>Effective to</Th></tr></thead>
        <tbody>
          {compRecords.slice().reverse().map((c) => (
            <tr key={c.id}>
              <Td><Badge variant={c.reason === "PROMOTION" ? "accent" : "default"}>{c.reason}</Badge></Td>
              <Td className="font-medium">{formatMoney(Number(c.annualSalary), c.currency)}</Td>
              <Td className="text-muted-foreground">{c.currency !== "USD" ? "≈ converted at demo FX rate" : "—"}</Td>
              <Td>{formatDate(c.effectiveFrom)}</Td>
              <Td>{c.effectiveTo ? formatDate(c.effectiveTo) : <span className="text-success">Current</span>}</Td>
            </tr>
          ))}
          {compRecords.length === 0 && <tr><Td colSpan={5} className="text-center text-muted-foreground">No compensation records.</Td></tr>}
        </tbody>
      </Table>
    </Card>
  );

  // ---------- Promotion history ----------
  const promotions = compRecords.filter((c) => c.reason === "PROMOTION");
  const promotionContent = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        A "promotion" here is any compensation change flagged &gt;10% at approval time (see the Worker
        Data Change business process) — this demo tracks it as a comp event, not a separate title/level
        change, since the seed data doesn't model level progression independently.
      </p>
      {promotions.length === 0 ? (
        <EmptyState>No promotions on record.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>New comp</Th><Th>Currency</Th></tr></thead>
            <tbody>
              {promotions.map((c) => (
                <tr key={c.id}>
                  <Td>{formatDate(c.effectiveFrom)}</Td>
                  <Td className="font-medium">{formatMoney(Number(c.annualSalary), c.currency)}</Td>
                  <Td>{c.currency}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );

  // ---------- Leave history ----------
  const leaveEvents = events.filter((e) => e.type === "STATUS_CHANGE" && /leave/i.test(e.payload));
  const leaveContent = (
    <div className="flex flex-col gap-3">
      {(worker.status === "ON_LEAVE" || worker.status === "TERMINATION_PENDING") && (
        <Card className="border-warning/40 bg-warning/5">
          <div className="text-sm font-medium">Currently {worker.status.replace(/_/g, " ").toLowerCase()}</div>
          <div className="text-xs text-muted-foreground">Reflected in payroll reconciliation — see the Payroll page for pay treatment.</div>
        </Card>
      )}
      {leaveEvents.length === 0 ? (
        <EmptyState>No leave-transition events recorded for this worker.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>Detail</Th></tr></thead>
            <tbody>
              {leaveEvents.map((e) => (
                <tr key={e.id}><Td>{formatDate(e.effectiveDate)}</Td><Td>{formatPayload(e.payload)}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );

  // ---------- Transactions ----------
  const transactionsContent = (
    <Card>
      <Table>
        <thead><tr><Th>Type</Th><Th>Effective date</Th><Th>Detail</Th><Th>Recorded</Th></tr></thead>
        <tbody>
          {events.slice().reverse().map((e) => (
            <tr key={e.id}>
              <Td><Badge>{e.type.replace(/_/g, " ")}</Badge></Td>
              <Td>{formatDate(e.effectiveDate)}</Td>
              <Td className="text-xs text-muted-foreground">{formatPayload(e.payload)}</Td>
              <Td className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</Td>
            </tr>
          ))}
          {events.length === 0 && <tr><Td colSpan={4} className="text-center text-muted-foreground">No transactions recorded.</Td></tr>}
        </tbody>
      </Table>
    </Card>
  );

  // ---------- Approval requests ----------
  const approvalContent = (
    <Card>
      <Table>
        <thead><tr><Th>Request</Th><Th>Role</Th><Th>Status</Th><Th>Current step</Th><Th>Date</Th></tr></thead>
        <tbody>
          {bpInstances.map((inst) => {
            const roles: string[] = [];
            if (inst.subjectWorkerId === workerId) roles.push("Subject");
            if (inst.initiatorId === workerId) roles.push("Initiator");
            const myStep = inst.stepInstances.find((s) => s.assigneeId === workerId);
            if (myStep) roles.push(`Approver (${myStep.stepName})`);
            const currentStep = inst.stepInstances.find((s) => s.action === "PENDING");
            return (
              <tr key={inst.id}>
                <Td>
                  <Link href="/processes" className="text-accent hover:underline">{inst.definition.name}</Link>
                  <div className="text-xs text-muted-foreground">{inst.subjectWorker.legalName}</div>
                </Td>
                <Td className="text-xs">{roles.join(", ") || "—"}</Td>
                <Td><Badge variant={inst.status === "COMPLETED" ? "success" : inst.status === "DENIED" ? "destructive" : inst.status === "CANCELED" ? "warning" : "accent"}>{inst.status.replace(/_/g, " ")}</Badge></Td>
                <Td className="text-xs">
                  {currentStep ? <Badge variant={STEP_VARIANT[currentStep.action]}>{currentStep.stepName}</Badge> : "—"}
                </Td>
                <Td className="text-xs text-muted-foreground">{formatDate(inst.createdAt)}</Td>
              </tr>
            );
          })}
          {bpInstances.length === 0 && <tr><Td colSpan={5} className="text-center text-muted-foreground">No approval requests involving this worker.</Td></tr>}
        </tbody>
      </Table>
    </Card>
  );

  const tabs: ProfileTab[] = [
    { key: "overview", label: "Overview", content: overviewContent },
    { key: "manager", label: "Manager", content: managerContent },
    { key: "compensation", label: "Compensation", count: compRecords.length, content: compensationContent },
    { key: "promotions", label: "Promotions", count: promotions.length, content: promotionContent },
    { key: "leave", label: "Leave", content: leaveContent },
    { key: "transactions", label: "Transactions", count: events.length, content: transactionsContent },
    { key: "approvals", label: "Approval Requests", count: bpInstances.length, content: approvalContent },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/workers" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to directory
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{worker.legalName}</h1>
          <p className="text-sm text-muted-foreground">{workerId} · {current?.department ?? "—"} · {current?.locationName ?? "—"}</p>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && workerId !== effectiveWorkerId(ctx) && (
            <Link href="/processes" className="text-sm text-accent hover:underline">
              Initiate a data change →
            </Link>
          )}
          {current && (
            <Link href={`/org-chart?center=${workerId}`} className="text-sm text-accent hover:underline">
              View in org chart →
            </Link>
          )}
          <Badge variant={STATUS_VARIANT[worker.status] ?? "default"}>{worker.status.replace(/_/g, " ")}</Badge>
        </div>
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

      <ProfileTabs tabs={tabs} />
    </div>
  );
}

function formatPayload(payload: string): string {
  try {
    const p = JSON.parse(payload);
    return Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(" · ");
  } catch {
    return "";
  }
}
