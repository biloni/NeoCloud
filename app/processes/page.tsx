import { getEnrichedInbox, getAllInstances } from "@/lib/bp-engine";
import { prisma } from "@/lib/prisma";
import { Inbox } from "@/components/processes/Inbox";
import { StartChangeForm } from "@/components/processes/StartChangeForm";
import { InstanceList, type InstanceRow } from "@/components/processes/InstanceList";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId } from "@/security/authorization";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/processes", "/home");
  const actingWorkerId = effectiveWorkerId(ctx);

  const [inbox, instancesRaw] = await Promise.all([getEnrichedInbox(actingWorkerId), getAllInstances()]);

  // Names for the full instance list below (separate from the inbox's own enrichment).
  const allWorkerIds = new Set<string>();
  instancesRaw.forEach((i) => { allWorkerIds.add(i.subjectWorkerId); allWorkerIds.add(i.initiatorId); i.stepInstances.forEach((s) => allWorkerIds.add(s.assigneeId)); });
  const workers = await prisma.worker.findMany({ where: { id: { in: Array.from(allWorkerIds) } } });
  const nameById = new Map(workers.map((w) => [w.id, w.legalName]));

  const instances: InstanceRow[] = instancesRaw.map((inst) => ({
    id: inst.id,
    definitionName: inst.definition.name,
    subjectName: nameById.get(inst.subjectWorkerId) ?? inst.subjectWorkerId,
    subjectWorkerId: inst.subjectWorkerId,
    initiatorName: nameById.get(inst.initiatorId) ?? inst.initiatorId,
    status: inst.status,
    createdAt: inst.createdAt,
    proposedChange: JSON.parse(inst.proposedChange),
    steps: inst.stepInstances.map((s) => ({
      id: s.id, order: s.order, stepName: s.stepName,
      assigneeName: nameById.get(s.assigneeId) ?? s.assigneeId,
      action: s.action, comment: s.comment, actedAt: s.actedAt,
    })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Business Processes</h1>
        <p className="text-sm text-muted-foreground">
          Worker Data Change — Workday-style multi-step approval with conditional routing and a full audit trail.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Inbox items={inbox} actorWorkerId={actingWorkerId} />
        <StartChangeForm initiatorId={actingWorkerId} />
      </div>

      <InstanceList instances={instances} />
    </div>
  );
}
