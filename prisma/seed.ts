// Deterministic synthetic data generator for NeoCloud Inc. (~350 workers).
// See CLAUDE.md "Seed data spec" for the distribution assumptions this
// script implements, and README.md "Data assumptions" for the human-
// readable summary this script's own summary printout feeds.
import { PrismaClient } from "@prisma/client";
import seedrandom from "seedrandom";
import {
  LEVEL_ORDER,
  LEVEL_INFO,
  LOCATIONS,
  DEPARTMENTS,
  FX_RATES,
  CURRENCY_BY_COUNTRY,
  usdToLocal,
  type LevelCode,
} from "../lib/reference-data";

const prisma = new PrismaClient();
const rng = seedrandom("neocloud-42");

function rand(): number {
  return rng();
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickWeighted<T extends { weight: number }>(arr: readonly T[]): T {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const item of arr) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return arr[arr.length - 1];
}
function round(n: number, nearest = 500): number {
  return Math.round(n / nearest) * nearest;
}
function daysAgo(days: number): Date {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - days);
  return d;
}
function randomDateBetween(start: Date, end: Date): Date {
  const t = start.getTime() + rand() * (end.getTime() - start.getTime());
  return new Date(t);
}

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

// IC-heavy pyramid: bulk in IC2-IC4, thin at the top.
const LEVEL_WEIGHTS: Record<LevelCode, number> = {
  IC1: 5, IC2: 20, IC3: 27, IC4: 22, IC5: 12, IC6: 5, IC7: 1,
  M3: 4.5, M4: 2.5, M5: 0.7, M6: 0.3,
};
function randomLevel(): LevelCode {
  const total = Object.values(LEVEL_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const lvl of LEVEL_ORDER) {
    r -= LEVEL_WEIGHTS[lvl];
    if (r <= 0) return lvl;
  }
  return "IC3";
}

function randomLocationForCountryBias(): (typeof LOCATIONS)[number] {
  return pickWeighted(LOCATIONS);
}

// Salary: ~10% below band mid, ~3% above band max, remainder between mid and max.
function salaryForLevel(level: LevelCode, countryCode: string): { amount: number; currency: string } {
  const [min, mid, max] = LEVEL_INFO[level].bandUsd;
  const currency = CURRENCY_BY_COUNTRY[countryCode] ?? "USD";
  const r = rand();
  let usd: number;
  if (r < 0.10) usd = min + rand() * (mid - min);
  else if (r < 0.13) usd = max + rand() * (max * 0.15);
  else usd = mid + rand() * (max - mid);
  const local = usdToLocal(usd, currency);
  return { amount: round(local, currency === "INR" ? 5000 : currency === "USD" ? 500 : 500), currency };
}

interface WorkerDraft {
  id: string;
  legalName: string;
  countryCode: string;
  hireDate: Date;
  status: string;
  level: LevelCode;
  locationId: string;
  managerId: string | null; // null only for CEO
  department: string; // one of DEPARTMENTS[].name, for org naming/derivation
  salaryOverride?: { amount: number; currency: string };
}

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Sam", "Jamie", "Avery", "Quinn", "Priya", "Wei", "Fatima", "Liam", "Noah", "Emma", "Olivia", "Sofia", "Raj", "Ananya", "Chen", "Yuki", "Diego", "Mateo", "Aisha", "Omar", "Ines", "Lucas", "Mia", "Zoe"];
const LAST_NAMES = ["Chen", "Patel", "Kim", "Garcia", "Nguyen", "Smith", "Johnson", "Williams", "Brown", "Singh", "Kumar", "Sharma", "Wilson", "Anderson", "Lee", "Park", "Lopez", "Gonzalez", "Clark", "Wright", "Iyer", "Rao", "Khan", "Ali", "Torres", "Rivera", "Cooper", "Bailey", "Reed", "Foster"];
function randomName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

async function main() {
  console.log("Seeding NeoCloud People OS (deterministic, seed=neocloud-42)...");

  // ---------- Reference data ----------
  await prisma.location.createMany({
    data: LOCATIONS.map((l) => ({ id: l.id, name: l.name, countryCode: l.countryCode })),
  });

  await prisma.fxRate.createMany({
    data: Object.entries(FX_RATES)
      .filter(([code]) => code !== "USD")
      .map(([currency, toUsd]) => ({ currency, toUsd })),
  });

  await prisma.jobProfile.createMany({
    data: LEVEL_ORDER.map((level) => ({
      id: `JP-${level}`,
      title: LEVEL_INFO[level].title,
      level,
      track: LEVEL_INFO[level].track,
    })),
  });

  const compBandRows: { id: string; jobProfileId: string; countryCode: string; currency: string; bandMin: number; bandMid: number; bandMax: number }[] = [];
  for (const level of LEVEL_ORDER) {
    const [min, mid, max] = LEVEL_INFO[level].bandUsd;
    for (const countryCode of Object.keys(CURRENCY_BY_COUNTRY)) {
      const currency = CURRENCY_BY_COUNTRY[countryCode];
      compBandRows.push({
        id: `CB-${level}-${countryCode}`,
        jobProfileId: `JP-${level}`,
        countryCode,
        currency,
        bandMin: round(usdToLocal(min, currency), currency === "INR" ? 5000 : 500),
        bandMid: round(usdToLocal(mid, currency), currency === "INR" ? 5000 : 500),
        bandMax: round(usdToLocal(max, currency), currency === "INR" ? 5000 : 500),
      });
    }
  }
  await prisma.compBand.createMany({ data: compBandRows });

  // ---------- Worker population + org tree ----------
  const workers: WorkerDraft[] = [];
  const orgCreationOrder: { id: string; name: string; managerId: string; parentId: string | null }[] = [];
  const orgOfManager = new Map<string, string>(); // workerId -> orgId they head
  const deptOfWorker = new Map<string, string>(); // workerId -> department name
  const reportCount = new Map<string, number>();

  // CEO — root of the tree.
  workers.push({
    id: "E0000",
    legalName: "Jordan CEO Whitfield",
    countryCode: "US",
    hireDate: new Date("2019-01-01"),
    status: "ACTIVE",
    level: "M6",
    locationId: "SF",
    managerId: null,
    department: "G&A",
  });
  orgOfManager.set("E0000", "SO-E0000");
  orgCreationOrder.push({ id: "SO-E0000", name: "NeoCloud Inc. (Corporate)", managerId: "E0000", parentId: null });
  deptOfWorker.set("E0000", "G&A");

  function getOrCreateOrgFor(workerId: string, managerId: string, name: string): string {
    const existing = orgOfManager.get(workerId);
    if (existing) return existing;
    const parentOrgId = orgOfManager.get(managerId)!;
    const orgId = `SO-${workerId}`;
    orgOfManager.set(workerId, orgId);
    orgCreationOrder.push({ id: orgId, name, managerId: workerId, parentId: parentOrgId });
    return orgId;
  }

  function addWorker(draft: Omit<WorkerDraft, "department"> & { department: string }) {
    workers.push(draft);
    deptOfWorker.set(draft.id, draft.department);
    reportCount.set(draft.managerId!, (reportCount.get(draft.managerId!) ?? 0) + 1);
    // Ensure the manager has an org to hold this worker's position.
    const managerDept = deptOfWorker.get(draft.managerId!)!;
    getOrCreateOrgFor(draft.managerId!, findGrandManager(draft.managerId!), `${nameOf(draft.managerId!)}'s Org`);
    return draft;
  }
  const managerOf = new Map<string, string>(); // derived convenience map used only during generation
  function findGrandManager(workerId: string): string {
    return managerOf.get(workerId) ?? "E0000";
  }
  const nameCache = new Map<string, string>();
  function nameOf(workerId: string): string {
    return nameCache.get(workerId) ?? workerId;
  }

  // Verbatim exercise sample employees (exact values from the take-home doc).
  const SAMPLE: WorkerDraft[] = [
    { id: "E0001", legalName: randomName(), countryCode: "US", hireDate: new Date("2022-03-15"), status: "ACTIVE", level: "M5", locationId: "SF", managerId: "E0000", department: "GPU Cloud", salaryOverride: { amount: 285000, currency: "USD" } },
    { id: "E0002", legalName: randomName(), countryCode: "US", hireDate: new Date("2022-06-01"), status: "ACTIVE", level: "IC5", locationId: "SF", managerId: "E0001", department: "GPU Cloud", salaryOverride: { amount: 245000, currency: "USD" } },
    { id: "E0003", legalName: randomName(), countryCode: "US", hireDate: new Date("2023-01-12"), status: "ACTIVE", level: "IC4", locationId: "SJ", managerId: "E0001", department: "GPU Cloud", salaryOverride: { amount: 195000, currency: "USD" } },
    { id: "E0004", legalName: randomName(), countryCode: "US", hireDate: new Date("2023-08-20"), status: "ACTIVE", level: "IC3", locationId: "REMOTE_US", managerId: "E0002", department: "GPU Cloud", salaryOverride: { amount: 160000, currency: "USD" } },
    { id: "E0005", legalName: randomName(), countryCode: "US", hireDate: new Date("2022-11-04"), status: "ACTIVE", level: "M4", locationId: "SF", managerId: "E0000", department: "On-Prem", salaryOverride: { amount: 230000, currency: "USD" } },
    { id: "E0006", legalName: randomName(), countryCode: "GB", hireDate: new Date("2024-02-18"), status: "ACTIVE", level: "IC4", locationId: "LONDON", managerId: "E0005", department: "On-Prem", salaryOverride: { amount: 85000, currency: "GBP" } },
    { id: "E0007", legalName: randomName(), countryCode: "US", hireDate: new Date("2021-09-09"), status: "ACTIVE", level: "IC6", locationId: "SF", managerId: "E0000", department: "Engineering", salaryOverride: { amount: 340000, currency: "USD" } },
    { id: "E0008", legalName: randomName(), countryCode: "CA", hireDate: new Date("2023-04-03"), status: "ACTIVE", level: "IC5", locationId: "TORONTO", managerId: "E0007", department: "Engineering", salaryOverride: { amount: 225000, currency: "CAD" } },
    { id: "E0009", legalName: randomName(), countryCode: "IN", hireDate: new Date("2023-11-22"), status: "ACTIVE", level: "IC4", locationId: "BANGALORE", managerId: "E0007", department: "Engineering", salaryOverride: { amount: 4500000, currency: "INR" } },
    { id: "E0010", legalName: randomName(), countryCode: "US", hireDate: new Date("2022-08-14"), status: "ACTIVE", level: "IC5", locationId: "SF", managerId: "E0000", department: "G&A", salaryOverride: { amount: 210000, currency: "USD" } },
    { id: "E0148", legalName: randomName(), countryCode: "US", hireDate: new Date("2024-09-10"), status: "TERMINATION_PENDING", level: "IC3", locationId: "SF", managerId: "E0002", department: "GPU Cloud", salaryOverride: { amount: 165000, currency: "USD" } },
    { id: "E0149", legalName: randomName(), countryCode: "US", hireDate: new Date("2024-04-01"), status: "ON_LEAVE", level: "IC4", locationId: "REMOTE_US", managerId: "E0010", department: "G&A", salaryOverride: { amount: 180000, currency: "USD" } },
  ];
  nameCache.set("E0000", "Jordan CEO Whitfield");
  for (const w of SAMPLE) {
    managerOf.set(w.id, w.managerId!);
    nameCache.set(w.id, w.legalName);
    addWorker(w);
  }

  // Reserved IDs: E0000 (CEO), E0001-E0010, E0148, E0149 (samples).
  const reserved = new Set(["E0000", ...SAMPLE.map((s) => s.id)]);
  let nextId = 11;
  function newWorkerId(): string {
    while (reserved.has(`E${String(nextId).padStart(4, "0")}`)) nextId++;
    const id = `E${String(nextId).padStart(4, "0")}`;
    nextId++;
    return id;
  }

  // Target headcount per department (350 total minus the 12 samples already placed,
  // and minus CEO who isn't counted in any department bucket for this KPI).
  const TOTAL_TARGET = 350;
  const deptTargets: Record<string, number> = {};
  let allocated = 0;
  for (const d of DEPARTMENTS) {
    const n = Math.round(TOTAL_TARGET * d.weight);
    deptTargets[d.name] = n;
    allocated += n;
  }
  // Reconcile rounding drift onto Engineering (largest dept).
  deptTargets["Engineering"] += TOTAL_TARGET - allocated;

  const sampleCountByDept: Record<string, number> = {};
  for (const s of SAMPLE) sampleCountByDept[s.department] = (sampleCountByDept[s.department] ?? 0) + 1;

  // deptMembers: pool of worker IDs eligible to receive new reports, per department.
  const deptMembers: Record<string, string[]> = {
    "GPU Cloud": ["E0001", "E0002", "E0003", "E0004", "E0148"],
    "On-Prem": ["E0005", "E0006"],
    "Engineering": ["E0007", "E0008", "E0009"],
    "G&A": ["E0010", "E0149"],
  };
  const RECENT_HIRE_TARGET = 25;
  let recentHireCount = 0;
  const RECENT_HIRE_PROB = RECENT_HIRE_TARGET / (TOTAL_TARGET - SAMPLE.length);

  const STATUS_ROLL: { status: string; weight: number }[] = [
    { status: "ACTIVE", weight: 92 },
    { status: "ON_LEAVE", weight: 4 },
    { status: "TERMINATION_PENDING", weight: 1 },
    { status: "CONTRACTOR", weight: 3 },
  ];
  function randomStatus(): string {
    return pickWeighted(STATUS_ROLL).status;
  }

  for (const dept of DEPARTMENTS) {
    const target = deptTargets[dept.name];
    const already = sampleCountByDept[dept.name] ?? 0;
    for (let i = already; i < target; i++) {
      const id = newWorkerId();
      const pool = deptMembers[dept.name];
      // Weight toward members with fewer existing reports to spread the tree into multiple layers.
      let managerId = pool[0];
      let best = Infinity;
      const candidates = pool.length <= 3 ? pool : [pool[0], ...pickN(pool.slice(1), Math.min(6, pool.length - 1))];
      for (const c of candidates) {
        const cap = c === pool[0] ? 14 : 7;
        const rc = reportCount.get(c) ?? 0;
        const score = rc / cap + rand() * 0.35; // small jitter so it's not purely greedy
        if (score < best) {
          best = score;
          managerId = c;
        }
      }

      const isRecent = rand() < RECENT_HIRE_PROB && recentHireCount < RECENT_HIRE_TARGET;
      if (isRecent) recentHireCount++;
      const hireDate = isRecent
        ? daysAgo(randInt(1, 364))
        : randomDateBetween(new Date("2019-01-01"), daysAgo(366));

      const level = randomLevel();
      const location = randomLocationForCountryBias();
      const legalName = randomName();
      const draft: WorkerDraft = {
        id,
        legalName,
        countryCode: location.countryCode,
        hireDate,
        status: randomStatus(),
        level,
        locationId: location.id,
        managerId,
        department: dept.name,
      };
      nameCache.set(id, legalName);
      managerOf.set(id, managerId);
      addWorker(draft);
      pool.push(id);
    }
  }

  function pickN<T>(arr: T[], n: number): T[] {
    const copy = [...arr];
    const out: T[] = [];
    for (let i = 0; i < n && copy.length; i++) {
      const idx = Math.floor(rand() * copy.length);
      out.push(copy[idx]);
      copy.splice(idx, 1);
    }
    return out;
  }

  // ---------- Extra historical population: ~30 trailing-12mo terminations ----------
  const TERMINATIONS_TARGET = 30;
  const terminatedWorkers: WorkerDraft[] = [];
  const terminationDates = new Map<string, Date>();
  for (let i = 0; i < TERMINATIONS_TARGET; i++) {
    const id = newWorkerId();
    const dept = pickWeighted(DEPARTMENTS);
    const pool = deptMembers[dept.name];
    const managerId = pool[Math.floor(rand() * Math.min(pool.length, 10))];
    const termDate = daysAgo(randInt(5, 360));
    const tenureDays = randInt(200, 1600);
    const hireDate = new Date(termDate);
    hireDate.setDate(hireDate.getDate() - tenureDays);
    const level = randomLevel();
    const location = randomLocationForCountryBias();
    const legalName = randomName();
    const draft: WorkerDraft = {
      id,
      legalName,
      countryCode: location.countryCode,
      hireDate,
      status: "TERMINATED",
      level,
      locationId: location.id,
      managerId,
      department: dept.name,
    };
    nameCache.set(id, legalName);
    managerOf.set(id, managerId);
    terminationDates.set(id, termDate);
    // Terminated workers don't grow the tree further (excluded from deptMembers pool).
    deptOfWorker.set(id, dept.name);
    reportCount.set(managerId, (reportCount.get(managerId) ?? 0) + 1);
    getOrCreateOrgFor(managerId, findGrandManager(managerId), `${nameOf(managerId)}'s Org`);
    terminatedWorkers.push(draft);
  }
  workers.push(...terminatedWorkers);

  console.log(`Generated ${workers.length} worker records (${workers.length - terminatedWorkers.length} current, ${terminatedWorkers.length} historical terminations).`);

  // ---------- Persist workers ----------
  // The four department-head orgs (SO-E0001/E0005/E0007/E0010) were named
  // generically ("<name>'s Org") during lazy creation. Rename them to the
  // literal department name — lib/snapshot.ts's departmentForWorker() walks
  // the org tree up to whichever org is a direct child of the root and
  // reads its `name`, so this is the only place department strings live.
  const deptHeadOrgNames: Record<string, string> = {
    "SO-E0001": "GPU Cloud",
    "SO-E0005": "On-Prem",
    "SO-E0007": "Engineering",
    "SO-E0010": "G&A",
  };
  for (const org of orgCreationOrder) {
    if (deptHeadOrgNames[org.id]) org.name = deptHeadOrgNames[org.id];
  }

  await prisma.worker.createMany({
    data: workers.map((w) => ({
      id: w.id,
      legalName: w.legalName,
      countryCode: w.countryCode,
      hireDate: w.hireDate,
      status: w.status,
    })),
  });

  // ---------- Persist orgs (topological order, sequential) ----------
  for (const org of orgCreationOrder) {
    await prisma.supervisoryOrg.create({ data: org });
  }

  // ---------- Positions + assignments + comp + events ----------
  const positions: { id: string; supOrgId: string; jobProfileId: string; locationId: string; status: string }[] = [];
  const assignments: { workerId: string; positionId: string; effectiveFrom: Date; effectiveTo: Date | null }[] = [];
  const compRecords: { workerId: string; annualSalary: number; currency: string; effectiveFrom: Date; effectiveTo: Date | null; reason: string }[] = [];
  const events: { workerId: string; type: string; effectiveDate: Date; payload: string; createdAt: Date }[] = [];

  let posSeq = 1;
  function nextPositionId(): string {
    return `P${String(posSeq++).padStart(5, "0")}`;
  }

  for (const w of workers) {
    if (w.id === "E0000") {
      // CEO sits in their own top org.
      const posId = nextPositionId();
      positions.push({ id: posId, supOrgId: "SO-E0000", jobProfileId: `JP-${w.level}`, locationId: w.locationId, status: "FILLED" });
      assignments.push({ workerId: w.id, positionId: posId, effectiveFrom: w.hireDate, effectiveTo: null });
      compRecords.push({ workerId: w.id, annualSalary: 425000, currency: "USD", effectiveFrom: w.hireDate, effectiveTo: null, reason: "HIRE" });
      events.push({ workerId: w.id, type: "HIRE", effectiveDate: w.hireDate, payload: JSON.stringify({ level: w.level }), createdAt: w.hireDate });
      continue;
    }
    const isTerminated = w.status === "TERMINATED";
    const orgId = orgOfManager.get(w.managerId!)!;
    const posId = nextPositionId();
    const termDate = terminationDates.get(w.id) ?? null;
    positions.push({ id: posId, supOrgId: orgId, jobProfileId: `JP-${w.level}`, locationId: w.locationId, status: isTerminated ? "CLOSED" : "FILLED" });
    assignments.push({ workerId: w.id, positionId: posId, effectiveFrom: w.hireDate, effectiveTo: termDate });

    const salary = w.salaryOverride ?? salaryForLevel(w.level, w.countryCode);
    const tenureDays = Math.floor((TODAY.getTime() - w.hireDate.getTime()) / 86400000);
    const eligibleForMerit = !isTerminated && !w.salaryOverride && tenureDays > 240 && rand() < 0.10;

    events.push({ workerId: w.id, type: "HIRE", effectiveDate: w.hireDate, payload: JSON.stringify({ level: w.level, department: w.department }), createdAt: w.hireDate });

    if (eligibleForMerit) {
      const raiseDate = randomDateBetween(daysAgo(tenureDays - 180), daysAgo(30));
      const oldSalary = round(salary.amount / randRange(1.08, 1.16), 500);
      compRecords.push({ workerId: w.id, annualSalary: oldSalary, currency: salary.currency, effectiveFrom: w.hireDate, effectiveTo: raiseDate, reason: "HIRE" });
      compRecords.push({ workerId: w.id, annualSalary: salary.amount, currency: salary.currency, effectiveFrom: raiseDate, effectiveTo: null, reason: "MERIT" });
      events.push({ workerId: w.id, type: "COMP_CHANGE", effectiveDate: raiseDate, payload: JSON.stringify({ oldSalary, newSalary: salary.amount, currency: salary.currency, reason: "MERIT" }), createdAt: raiseDate });
    } else {
      compRecords.push({ workerId: w.id, annualSalary: salary.amount, currency: salary.currency, effectiveFrom: w.hireDate, effectiveTo: termDate, reason: "HIRE" });
    }

    if (isTerminated && termDate) {
      events.push({ workerId: w.id, type: "TERMINATION", effectiveDate: termDate, payload: JSON.stringify({ reason: pick(["Voluntary resignation", "Role elimination", "Performance"]) }), createdAt: termDate });
    }
  }

  function randRange(min: number, max: number): number {
    return min + rand() * (max - min);
  }

  await prisma.position.createMany({ data: positions });
  await prisma.positionAssignment.createMany({ data: assignments });
  await prisma.compRecord.createMany({ data: compRecords });
  await prisma.workerEvent.createMany({ data: events });

  // ---------- Open reqs (~15 unfilled positions) ----------
  const openPositions: { id: string; supOrgId: string; jobProfileId: string; locationId: string; status: string }[] = [];
  const allOrgIds = orgCreationOrder.map((o) => o.id);
  for (let i = 0; i < 15; i++) {
    openPositions.push({
      id: nextPositionId(),
      supOrgId: pick(allOrgIds),
      jobProfileId: `JP-${randomLevel()}`,
      locationId: pick(LOCATIONS).id,
      status: "OPEN",
    });
  }
  await prisma.position.createMany({ data: openPositions });

  // ---------- Business Process definition: Worker Data Change ----------
  await prisma.bpDefinition.create({
    data: {
      id: "BP-WORKER-DATA-CHANGE",
      name: "Worker Data Change",
      steps: {
        create: [
          { order: 1, name: "Initiate", assigneeRule: "INITIATOR" },
          { order: 2, name: "Manager Approval", assigneeRule: "MANAGER_OF_WORKER" },
          { order: 3, name: "Comp Partner Review", assigneeRule: "COMP_PARTNER", conditionRule: "compChangePct>10" },
          { order: 4, name: "HR Partner Approval", assigneeRule: "HR_PARTNER" },
          { order: 5, name: "Complete", assigneeRule: "INITIATOR" },
        ],
      },
    },
  });

  // ---------- Pre-built planning scenarios ----------
  await prisma.scenario.create({
    data: {
      name: "Plan of Record",
      description: "Baseline plan: steady hiring pace, current attrition trend, standard merit cycle.",
      assumptions: JSON.stringify({
        hirePlan: [
          { department: "GPU Cloud", quarter: "Q1", count: 8, targetLevel: "IC3", targetLocation: "SF", startMonth: 1 },
          { department: "Engineering", quarter: "Q1", count: 12, targetLevel: "IC3", targetLocation: "REMOTE_US", startMonth: 1 },
          { department: "GPU Cloud", quarter: "Q2", count: 6, targetLevel: "IC4", targetLocation: "SJ", startMonth: 4 },
          { department: "Engineering", quarter: "Q2", count: 10, targetLevel: "IC3", targetLocation: "BANGALORE", startMonth: 4 },
          { department: "On-Prem", quarter: "Q2", count: 4, targetLevel: "IC3", targetLocation: "TORONTO", startMonth: 5 },
          { department: "Engineering", quarter: "Q3", count: 9, targetLevel: "IC4", targetLocation: "SF", startMonth: 7 },
          { department: "G&A", quarter: "Q3", count: 3, targetLevel: "IC3", targetLocation: "SF", startMonth: 8 },
          { department: "GPU Cloud", quarter: "Q4", count: 5, targetLevel: "IC3", targetLocation: "SF", startMonth: 10 },
          { department: "Engineering", quarter: "Q4", count: 8, targetLevel: "IC3", targetLocation: "LONDON", startMonth: 11 },
        ],
        attritionByDept: { "GPU Cloud": 12, "On-Prem": 10, "Engineering": 14, "G&A": 9 },
        meritByLevel: { IC1: 3, IC2: 3.5, IC3: 4, IC4: 4, IC5: 4.5, IC6: 5, IC7: 5, M3: 4, M4: 4.5, M5: 5, M6: 5 },
        meritEffectiveDate: new Date(TODAY.getFullYear(), 3, 1).toISOString(),
      }),
    },
  });

  await prisma.scenario.create({
    data: {
      name: "IPO Readiness (slower G&A, faster Eng)",
      description: "Front-loads Engineering hiring ahead of IPO scaling needs; slows G&A growth to manage burn.",
      assumptions: JSON.stringify({
        hirePlan: [
          { department: "Engineering", quarter: "Q1", count: 18, targetLevel: "IC3", targetLocation: "REMOTE_US", startMonth: 1 },
          { department: "Engineering", quarter: "Q1", count: 6, targetLevel: "IC4", targetLocation: "SF", startMonth: 2 },
          { department: "GPU Cloud", quarter: "Q1", count: 6, targetLevel: "IC3", targetLocation: "SF", startMonth: 1 },
          { department: "Engineering", quarter: "Q2", count: 16, targetLevel: "IC3", targetLocation: "BANGALORE", startMonth: 4 },
          { department: "GPU Cloud", quarter: "Q2", count: 5, targetLevel: "IC4", targetLocation: "SJ", startMonth: 4 },
          { department: "Engineering", quarter: "Q3", count: 14, targetLevel: "IC3", targetLocation: "LONDON", startMonth: 7 },
          { department: "On-Prem", quarter: "Q3", count: 3, targetLevel: "IC3", targetLocation: "TORONTO", startMonth: 8 },
          { department: "Engineering", quarter: "Q4", count: 12, targetLevel: "IC4", targetLocation: "SF", startMonth: 10 },
          { department: "G&A", quarter: "Q4", count: 1, targetLevel: "IC3", targetLocation: "SF", startMonth: 11 },
        ],
        attritionByDept: { "GPU Cloud": 12, "On-Prem": 10, "Engineering": 11, "G&A": 9 },
        meritByLevel: { IC1: 3, IC2: 3.5, IC3: 4, IC4: 4.5, IC5: 5, IC6: 5.5, IC7: 5.5, M3: 4.5, M4: 5, M5: 5.5, M6: 5.5 },
        meritEffectiveDate: new Date(TODAY.getFullYear(), 3, 1).toISOString(),
      }),
    },
  });

  // ---------- Summary ----------
  const current = workers.filter((w) => w.status !== "TERMINATED");
  const byDept: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byLevel: Record<string, number> = {};
  for (const w of current) {
    byDept[w.department] = (byDept[w.department] ?? 0) + 1;
    byLocation[w.locationId] = (byLocation[w.locationId] ?? 0) + 1;
    byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
    byLevel[w.level] = (byLevel[w.level] ?? 0) + 1;
  }
  console.log("\n=== Seed summary ===");
  console.log("Current population:", current.length, "| Historical terminations:", terminatedWorkers.length, "| Total rows:", workers.length);
  console.log("By department:", byDept);
  console.log("By location:", byLocation);
  console.log("By status:", byStatus);
  console.log("By level:", byLevel);
  console.log("Open positions:", openPositions.length);
  console.log("Trailing-12mo hires (recent):", recentHireCount, "target ~25");
  console.log("Trailing-12mo terminations:", terminatedWorkers.length, "target ~30");
  console.log("Sample E0009 salary local: 4,500,000 INR ->", (4500000 * FX_RATES.INR).toFixed(0), "USD");
  console.log("=== Done ===\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
