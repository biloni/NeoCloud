// Direct "Hire" action for HR Partners — creates a new Worker + Position +
// CompRecord + WorkerEvent(HIRE) in one shot. Unlike Worker Data Change,
// hiring isn't one of the exercise's required multi-step BPs, so this is a
// plain server action rather than routed through lib/bp-engine.ts — but it
// follows the same master-data-vs-transactions and effective-dating rules
// as everything else (see CLAUDE.md).
import { prisma } from "./prisma";
import { getWorkforceSnapshot } from "./snapshot";
import { CURRENCY_BY_COUNTRY, type LevelCode } from "./reference-data";

export interface CreateHireInput {
  legalName: string;
  countryCode: string; // US, CA, GB, IN
  locationId: string;
  level: LevelCode;
  managerId: string;
  annualSalary: number;
  hireDate: Date;
}

async function nextWorkerId(): Promise<string> {
  const workers = await prisma.worker.findMany({ select: { id: true } });
  let max = 0;
  for (const w of workers) {
    const m = w.id.match(/^E(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  return `E${String(next).padStart(4, "0")}`;
}

/** The org a worker heads (where their direct reports' positions sit), creating it if this is their first report. */
async function getOrCreateOrgForManager(managerId: string): Promise<string> {
  const orgId = `SO-${managerId}`;
  const existing = await prisma.supervisoryOrg.findUnique({ where: { id: orgId } });
  if (existing) return orgId;
  const managerRow = (await getWorkforceSnapshot()).find((r) => r.workerId === managerId);
  if (!managerRow) throw new Error(`Manager ${managerId} not found or not currently active`);
  await prisma.supervisoryOrg.create({
    data: { id: orgId, name: `${managerId}'s Org`, managerId, parentId: managerRow.supOrgId },
  });
  return orgId;
}

export async function createHire(input: CreateHireInput) {
  if (!input.legalName.trim()) throw new Error("Legal name is required");
  if (!input.annualSalary || input.annualSalary <= 0) throw new Error("Annual salary must be positive");

  const managerId = input.managerId.toUpperCase().trim();
  const manager = await prisma.worker.findUnique({ where: { id: managerId } });
  if (!manager) throw new Error(`Manager ${managerId} does not exist`);

  const jobProfileId = `JP-${input.level}`;
  const jobProfile = await prisma.jobProfile.findUnique({ where: { id: jobProfileId } });
  if (!jobProfile) throw new Error(`Unknown level ${input.level}`);

  const location = await prisma.location.findUnique({ where: { id: input.locationId } });
  if (!location) throw new Error(`Unknown location ${input.locationId}`);

  const currency = CURRENCY_BY_COUNTRY[input.countryCode] ?? "USD";
  const workerId = await nextWorkerId();
  const supOrgId = await getOrCreateOrgForManager(managerId);
  const positionId = `P-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  await prisma.worker.create({
    data: { id: workerId, legalName: input.legalName.trim(), countryCode: input.countryCode, hireDate: input.hireDate, status: "ACTIVE" },
  });
  await prisma.position.create({
    data: { id: positionId, supOrgId, jobProfileId, locationId: input.locationId, status: "FILLED" },
  });
  await prisma.positionAssignment.create({
    data: { workerId, positionId, effectiveFrom: input.hireDate, effectiveTo: null },
  });
  await prisma.compRecord.create({
    data: { workerId, annualSalary: input.annualSalary, currency, effectiveFrom: input.hireDate, effectiveTo: null, reason: "HIRE" },
  });
  await prisma.workerEvent.create({
    data: {
      workerId,
      type: "HIRE",
      effectiveDate: input.hireDate,
      payload: JSON.stringify({ level: input.level, managerId, annualSalary: input.annualSalary, currency }),
    },
  });

  return workerId;
}
