// Generic Business Process engine: BpDefinition -> BpStep (+ conditionRule)
// -> BpInstance -> BpStepInstance (the audit trail). "Worker Data Change"
// is just one definition; nothing here is specific to it except the
// side-effects executed on completion. Mirrors Workday's BP framework —
// see the mapping table in CLAUDE.md / README.
import { prisma } from "./prisma";
import { getWorkforceSnapshot } from "./snapshot";
import { LEVEL_ORDER } from "./reference-data";
import type { AssigneeRule, StepAction } from "./enums";
import { resolveRolesForWorker, getFixedAssignee, Role } from "@/security/roles";

function evaluateCondition(rule: string, ctx: Record<string, number>): boolean {
  const m = rule.match(/^(\w+)\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return true;
  const [, field, op, valueStr] = m;
  const actual = ctx[field];
  if (actual === undefined) return true;
  const value = Number(valueStr);
  switch (op) {
    case ">": return actual > value;
    case ">=": return actual >= value;
    case "<": return actual < value;
    case "<=": return actual <= value;
    case "==": return actual === value;
    default: return true;
  }
}

/** Deterministically pick the Nth-most-senior active worker in a department to stand in for an org-wide role (HR Partner, Comp Partner). */
async function resolveOrgRole(department: string, rank: number): Promise<string> {
  const snapshot = await getWorkforceSnapshot();
  const rankOf = (lvl: string) => LEVEL_ORDER.indexOf(lvl as any);
  const candidates = snapshot
    .filter((r) => r.department === department && r.status === "ACTIVE" && r.workerId !== "E0000")
    .sort((a, b) => rankOf(b.level) - rankOf(a.level) || a.workerId.localeCompare(b.workerId));
  return candidates[rank]?.workerId ?? candidates[0]?.workerId ?? "E0000";
}

async function resolveAssignee(rule: AssigneeRule, subjectWorkerId: string, initiatorId: string): Promise<string> {
  if (rule === "INITIATOR") return initiatorId;
  if (rule === "HR_PARTNER") return resolveOrgRole("G&A", 0);
  if (rule === "COMP_PARTNER") return resolveOrgRole("G&A", 1);
  if (rule === "ROUTE_BASED_APPROVER") {
    // RBAC routing table (security/README.md "Workflow authorization"):
    // Employee-initiated -> HR Ops; Manager/Skip-Level-initiated -> HR Partner.
    const initiatorRoles = await resolveRolesForWorker(initiatorId);
    const initiatedByManager = initiatorRoles.includes(Role.MANAGER) || initiatorRoles.includes(Role.SKIP_LEVEL_MANAGER);
    const targetRole = initiatedByManager ? Role.HR_PARTNER : Role.HR_OPS;
    return getFixedAssignee(targetRole) ?? "E0000";
  }
  const snapshot = await getWorkforceSnapshot();
  const subject = snapshot.find((r) => r.workerId === subjectWorkerId);
  const managerId = subject?.managerId ?? "E0000";
  if (rule === "MANAGER_OF_WORKER") return managerId;
  if (rule === "SKIP_LEVEL_MANAGER") {
    const manager = snapshot.find((r) => r.workerId === managerId);
    return manager?.managerId ?? "E0000";
  }
  return "E0000";
}

/**
 * Shared instance+step creation, used by every BpDefinition this engine
 * runs. Creates the BpInstance, auto-approves the "Initiate" step, and
 * resolves+creates every subsequent step (PENDING, or SKIPPED_BY_RULE if
 * it has a conditionRule that doesn't pass against `conditionContext`).
 * Extracted so a new workflow (e.g. Profile Change Request) never
 * re-implements this loop.
 */
async function createBpInstanceWithSteps(
  definitionId: string,
  subjectWorkerId: string,
  initiatorId: string,
  proposedChange: Record<string, unknown>,
  conditionContext: Record<string, number> = {}
) {
  const definition = await prisma.bpDefinition.findUniqueOrThrow({
    where: { id: definitionId },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const instance = await prisma.bpInstance.create({
    data: {
      definitionId: definition.id,
      subjectWorkerId,
      initiatorId,
      status: "IN_PROGRESS",
      proposedChange: JSON.stringify(proposedChange),
    },
  });

  for (const step of definition.steps) {
    if (step.name === "Initiate") {
      await prisma.bpStepInstance.create({
        data: {
          instanceId: instance.id, order: step.order, stepName: step.name,
          assigneeId: initiatorId, action: "APPROVED", actedAt: new Date(),
          comment: "Initiated",
        },
      });
      continue;
    }
    const assigneeId = await resolveAssignee(step.assigneeRule as AssigneeRule, subjectWorkerId, initiatorId);
    if (step.conditionRule) {
      const passes = evaluateCondition(step.conditionRule, conditionContext);
      if (!passes) {
        await prisma.bpStepInstance.create({
          data: {
            instanceId: instance.id, order: step.order, stepName: step.name, assigneeId,
            action: "SKIPPED_BY_RULE", actedAt: new Date(), comment: `Condition not met: ${step.conditionRule}`,
          },
        });
        continue;
      }
    }
    await prisma.bpStepInstance.create({
      data: { instanceId: instance.id, order: step.order, stepName: step.name, assigneeId, action: "PENDING" },
    });
  }

  return instance;
}

export interface StartChangeInput {
  subjectWorkerId: string;
  initiatorId: string;
  changeType: "COMP_CHANGE" | "TRANSFER";
  newSalary?: number;
  currency?: string;
  newManagerId?: string;
  newLocationId?: string;
}

export async function startWorkerDataChange(input: StartChangeInput) {
  const snapshot = await getWorkforceSnapshot();
  const subject = snapshot.find((r) => r.workerId === input.subjectWorkerId);
  if (!subject) throw new Error(`Subject worker ${input.subjectWorkerId} not found or not currently active`);

  let compChangePct = 0;
  let proposedChange: Record<string, unknown>;
  if (input.changeType === "COMP_CHANGE") {
    if (!input.newSalary || input.newSalary <= 0) throw new Error("newSalary is required and must be positive");
    const currency = input.currency ?? subject.currency;
    compChangePct = ((input.newSalary - subject.annualSalaryLocal) / subject.annualSalaryLocal) * 100;
    proposedChange = {
      changeType: "COMP_CHANGE",
      newSalary: input.newSalary,
      currency,
      oldSalary: subject.annualSalaryLocal,
      oldCurrency: subject.currency,
      compChangePct: Number(compChangePct.toFixed(2)),
    };
  } else {
    if (!input.newManagerId) throw new Error("newManagerId is required for a transfer");
    proposedChange = {
      changeType: "TRANSFER",
      newManagerId: input.newManagerId,
      newLocationId: input.newLocationId ?? subject.locationId,
      oldManagerId: subject.managerId,
      oldLocationId: subject.locationId,
    };
  }

  return createBpInstanceWithSteps(
    "BP-WORKER-DATA-CHANGE",
    input.subjectWorkerId,
    input.initiatorId,
    proposedChange,
    { compChangePct: Math.abs(compChangePct) }
  );
}

export interface StartProfileChangeInput {
  subjectWorkerId: string;
  initiatorId: string;
  requestedChange: string; // free-text description, e.g. "Update phone number to ..."
}

/**
 * The Employee-submitted "Profile Change Request" workflow — a second
 * BpDefinition reusing this same generic engine (see CLAUDE.md: "the
 * engine could run others"). Routing: Employee-initiated -> HR Ops;
 * Manager/Skip-Level-initiated (editing a report's data) -> HR Partner —
 * resolved dynamically per instance by the ROUTE_BASED_APPROVER assignee
 * rule (see resolveAssignee above), based on the INITIATOR's role at the
 * moment they submit.
 */
export async function startProfileChangeRequest(input: StartProfileChangeInput) {
  const snapshot = await getWorkforceSnapshot();
  const subject = snapshot.find((r) => r.workerId === input.subjectWorkerId);
  if (!subject) throw new Error(`Subject worker ${input.subjectWorkerId} not found or not currently active`);
  if (!input.requestedChange.trim()) throw new Error("Describe the requested change");

  const proposedChange = {
    changeType: "PROFILE_CHANGE",
    requestedChange: input.requestedChange.trim(),
  };

  return createBpInstanceWithSteps("BP-PROFILE-CHANGE-REQUEST", input.subjectWorkerId, input.initiatorId, proposedChange);
}

async function executeCompletion(instanceId: string, completeStepId: string) {
  const instance = await prisma.bpInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const change = JSON.parse(instance.proposedChange) as Record<string, any>;
  const now = new Date();

  if (change.changeType === "COMP_CHANGE") {
    const currentComp = await prisma.compRecord.findFirst({ where: { workerId: instance.subjectWorkerId, effectiveTo: null } });
    if (currentComp) await prisma.compRecord.update({ where: { id: currentComp.id }, data: { effectiveTo: now } });
    await prisma.compRecord.create({
      data: {
        workerId: instance.subjectWorkerId, annualSalary: change.newSalary, currency: change.currency,
        effectiveFrom: now, effectiveTo: null,
        reason: Math.abs(change.compChangePct) > 10 ? "PROMOTION" : "ADJUSTMENT",
      },
    });
    await prisma.workerEvent.create({
      data: { workerId: instance.subjectWorkerId, type: "COMP_CHANGE", effectiveDate: now, payload: JSON.stringify(change), bpInstanceId: instanceId },
    });
  } else if (change.changeType === "TRANSFER") {
    const currentAssignment = await prisma.positionAssignment.findFirst({
      where: { workerId: instance.subjectWorkerId, effectiveTo: null },
      include: { position: true },
    });
    if (currentAssignment) {
      await prisma.positionAssignment.update({ where: { id: currentAssignment.id }, data: { effectiveTo: now } });
      await prisma.position.update({ where: { id: currentAssignment.positionId }, data: { status: "OPEN" } });
    }
    const newOrgId = `SO-${change.newManagerId}`;
    const orgExists = await prisma.supervisoryOrg.findUnique({ where: { id: newOrgId } });
    if (!orgExists) {
      const managerRow = (await getWorkforceSnapshot()).find((r) => r.workerId === change.newManagerId);
      await prisma.supervisoryOrg.create({
        data: { id: newOrgId, name: `${change.newManagerId}'s Org`, managerId: change.newManagerId, parentId: managerRow?.supOrgId ?? "SO-E0000" },
      });
    }
    const newPositionId = `P-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await prisma.position.create({
      data: {
        id: newPositionId, supOrgId: newOrgId,
        jobProfileId: currentAssignment?.position.jobProfileId ?? "JP-IC3",
        locationId: change.newLocationId ?? currentAssignment?.position.locationId ?? "SF",
        status: "FILLED",
      },
    });
    await prisma.positionAssignment.create({ data: { workerId: instance.subjectWorkerId, positionId: newPositionId, effectiveFrom: now, effectiveTo: null } });
    await prisma.workerEvent.create({
      data: { workerId: instance.subjectWorkerId, type: "TRANSFER", effectiveDate: now, payload: JSON.stringify(change), bpInstanceId: instanceId },
    });
  } else if (change.changeType === "PROFILE_CHANGE") {
    await prisma.workerEvent.create({
      data: { workerId: instance.subjectWorkerId, type: "PROFILE_CHANGE", effectiveDate: now, payload: JSON.stringify(change), bpInstanceId: instanceId },
    });
  }

  await prisma.bpStepInstance.update({ where: { id: completeStepId }, data: { action: "APPROVED", actedAt: now, comment: "Auto-completed by system" } });
  await prisma.bpInstance.update({ where: { id: instanceId }, data: { status: "COMPLETED", completedAt: now } });
}

export async function actOnStep(stepInstanceId: string, actorWorkerId: string, action: Extract<StepAction, "APPROVED" | "DENIED" | "SENT_BACK">, comment?: string) {
  const step = await prisma.bpStepInstance.findUniqueOrThrow({ where: { id: stepInstanceId } });
  if (step.action !== "PENDING") throw new Error("This step has already been resolved");

  const allSteps = await prisma.bpStepInstance.findMany({ where: { instanceId: step.instanceId }, orderBy: { order: "asc" } });
  const earliestPending = allSteps.find((s) => s.action === "PENDING");
  if (!earliestPending || earliestPending.id !== step.id) throw new Error("This step is not yet actionable — an earlier step is still pending");
  if (step.assigneeId !== actorWorkerId) throw new Error("This step is not assigned to you");
  if ((action === "DENIED" || action === "SENT_BACK") && !comment) throw new Error("A comment is required to deny or send back");

  await prisma.bpStepInstance.update({ where: { id: step.id }, data: { action, comment: comment ?? null, actedAt: new Date() } });

  if (action === "DENIED") {
    await prisma.bpInstance.update({ where: { id: step.instanceId }, data: { status: "DENIED", completedAt: new Date() } });
    return;
  }
  if (action === "SENT_BACK") {
    await prisma.bpInstance.update({ where: { id: step.instanceId }, data: { status: "CANCELED", completedAt: new Date() } });
    return;
  }

  const remaining = allSteps.filter((s) => s.order > step.order);
  const nextPending = remaining.find((s) => s.action === "PENDING");
  if (nextPending && nextPending.stepName === "Complete") {
    await executeCompletion(step.instanceId, nextPending.id);
  }
}

/** Steps assigned to `workerId` where it is actually their turn (all earlier steps in the instance are resolved). */
export async function getInbox(workerId: string) {
  const candidates = await prisma.bpStepInstance.findMany({
    where: { assigneeId: workerId, action: "PENDING" },
    include: { instance: { include: { definition: true } } },
    orderBy: { createdAt: "asc" },
  });
  const result = [];
  for (const s of candidates) {
    const earliest = await prisma.bpStepInstance.findFirst({ where: { instanceId: s.instanceId, action: "PENDING" }, orderBy: { order: "asc" } });
    if (earliest?.id === s.id) result.push(s);
  }
  return result;
}

export interface EnrichedInboxItem {
  stepInstanceId: string;
  stepName: string;
  instanceId: string;
  subjectWorkerId: string;
  subjectName: string;
  initiatorName: string;
  proposedChange: Record<string, any>;
}

/**
 * getInbox() plus worker-name resolution — the exact enrichment both
 * /processes and /inbox need, extracted once so neither page re-implements
 * the name-lookup pass.
 */
export async function getEnrichedInbox(workerId: string): Promise<EnrichedInboxItem[]> {
  const raw = await getInbox(workerId);
  const ids = new Set<string>();
  raw.forEach((s) => { ids.add(s.instance.subjectWorkerId); ids.add(s.instance.initiatorId); });
  const workers = await prisma.worker.findMany({ where: { id: { in: Array.from(ids) } } });
  const nameById = new Map(workers.map((w) => [w.id, w.legalName]));

  return raw.map((s) => ({
    stepInstanceId: s.id,
    stepName: s.stepName,
    instanceId: s.instanceId,
    subjectWorkerId: s.instance.subjectWorkerId,
    subjectName: nameById.get(s.instance.subjectWorkerId) ?? s.instance.subjectWorkerId,
    initiatorName: nameById.get(s.instance.initiatorId) ?? s.instance.initiatorId,
    proposedChange: JSON.parse(s.instance.proposedChange),
  }));
}

export async function getAllInstances() {
  return prisma.bpInstance.findMany({
    include: { definition: true, subjectWorker: true, initiator: true, stepInstances: { orderBy: { order: "asc" }, include: { assignee: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getInstance(id: string) {
  return prisma.bpInstance.findUnique({
    where: { id },
    include: { definition: true, subjectWorker: true, initiator: true, stepInstances: { orderBy: { order: "asc" }, include: { assignee: true } } },
  });
}

/** Every BP instance touching this worker — as the subject, the initiator, or an assignee on any step. Powers the "Approval Requests" tab on the worker profile. */
export async function getInstancesForWorker(workerId: string) {
  return prisma.bpInstance.findMany({
    where: {
      OR: [
        { subjectWorkerId: workerId },
        { initiatorId: workerId },
        { stepInstances: { some: { assigneeId: workerId } } },
      ],
    },
    include: { definition: true, subjectWorker: true, initiator: true, stepInstances: { orderBy: { order: "asc" }, include: { assignee: true } } },
    orderBy: { createdAt: "desc" },
  });
}
