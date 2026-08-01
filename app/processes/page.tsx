import { cookies } from "next/headers";
import { getInbox, getAllInstances } from "@/lib/bp-engine";
import { prisma } from "@/lib/prisma";
import { Inbox, type InboxItem } from "@/components/processes/Inbox";
import { StartChangeForm } from "@/components/processes/StartChangeForm";
import { InstanceList, type InstanceRow } from "@/components/processes/InstanceList";
import { WORKER_COOKIE } from "@/lib/persona";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  const cookieStore = cookies();
  const actingWorkerId = (cookieStore.get(WORKER_COOKIE)?.value || "E0001").toUpperCase();

  const [inboxRaw, instancesRaw] = await Promise.all([getInbox(actingWorkerId), getAllInstances()]);

  const inbox: InboxItem[] = inboxRaw.map((s) => ({
    stepInstanceId: s.id,
    stepName: s.stepName,
    instanceId: s.instanceId,
    subjectWorkerId: s.instance.subjectWorkerId,
    subjectName: s.instance.subjectWorkerId,
    initiatorName: s.instance.initiatorId,
    proposedChange: JSON.parse(s.instance.proposedChange),
  }));

  // Enrich names (simple lookups; dataset is small so this is cheap).
  const allWorkerIds = new Set<string>();
  inbox.forEach((i) => { allWorkerIds.add(i.subjectWorkerId); allWorkerIds.add(i.initiatorName); });
  instancesRaw.forEach((i) => { allWorkerIds.add(i.subjectWorkerId); allWorkerIds.add(i.initiatorId); i.stepInstances.forEach((s) => allWorkerIds.add(s.assigneeId)); });
  const workers = await prisma.worker.findMany({ where: { id: { in: Array.from(allWorkerIds) } } });
  const nameById = new Map(workers.map((w) => [w.id, w.legalName]));

  for (const item of inbox) {
    item.subjectName = nameById.get(item.subjectWorkerId) ?? item.subjectWorkerId;
    item.initiatorName = nameById.get(item.initiatorName) ?? item.initiatorName;
  }

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
