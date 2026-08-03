import { getEnrichedInbox, getAllInstances } from "@/lib/bp-engine";
import { prisma } from "@/lib/prisma";
import { Inbox } from "@/components/processes/Inbox";
import { StartChangeForm } from "@/components/processes/StartChangeForm";
import { InstanceList, type InstanceRow } from "@/components/processes/InstanceList";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId, canViewEmployee, effectiveDataScope, DataScope } from "@/security/authorization";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/processes", "/home");
  const actingWorkerId = effectiveWorkerId(ctx);

  // Skip Level Manager's data scope (SELF_AND_ORG_SUBTREE) would otherwise
  // qualify them to see Process history for their whole reporting subtree
  // — deliberately excluded instead: that visibility belongs to their own
  // Manager Dashboard/Direct Reports view, not a raw company-process feed.
  // A worker who ALSO holds a broader role (HR Partner, Super Admin, etc.)
  // still sees history normally, since their wider scope isn't SELF_AND_ORG_SUBTREE.
  const canSeeHistory = effectiveDataScope(ctx) !== DataScope.SELF_AND_ORG_SUBTREE;

  const [inbox, allInstances] = await Promise.all([
    getEnrichedInbox(actingWorkerId),
    canSeeHistory ? getAllInstances() : Promise.resolve([]),
  ]);

  // Data-scope filter: reaching /processes at all only proves you hold
  // EDIT_EMPLOYEE or APPROVE_WORKFLOW (feature access) — it says nothing
  // about which SPECIFIC instances you're allowed to see. A Manager should
  // see requests about their own reports (or ones they started, or ones
  // assigned to them) — not every comp/transfer/name change company-wide.
  // Same canViewEmployee scope check the worker profile page already uses,
  // so a Manager's reach here and on /workers/[id] can't disagree.
  const instancesRaw = (
    await Promise.all(
      allInstances.map(async (inst) => {
        const isInitiator = inst.initiatorId === actingWorkerId;
        const isAssignee = inst.stepInstances.some((s) => s.assigneeId === actingWorkerId);
        const canSeeSubject = isInitiator || isAssignee || (await canViewEmployee(ctx, inst.subjectWorkerId));
        return canSeeSubject ? inst : null;
      })
    )
  ).filter((inst): inst is (typeof allInstances)[number] => inst !== null);

  // Names for the full instance list below (separate from the inbox's own enrichment).
  const allWorkerIds = new Set<string>();
  instancesRaw.forEach((i) => { allWorkerIds.add(i.subjectWorkerId); allWorkerIds.add(i.initiatorId); i.stepInstances.forEach((s) => allWorkerIds.add(s.assigneeId)); });
  const workers = canSeeHistory ? await prisma.worker.findMany({ where: { id: { in: Array.from(allWorkerIds) } } }) : [];
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

      {canSeeHistory && <InstanceList instances={instances} />}
    </div>
  );
}
