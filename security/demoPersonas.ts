/**
 * Dev-only persona switcher support: one representative worker id per role,
 * in a fixed display order. The six assignable roles use their exact fixed
 * assignment (FIXED_ROLE_ASSIGNMENTS). Employee/Manager/Skip Level Manager
 * have no fixed assignment (they're derived — see roles.ts) so a
 * representative worker is picked at runtime by scanning the live org data,
 * excluding whoever is already a fixed assignee so the nine options never
 * collide on a single worker.
 */
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { hasDirectReports, hasIndirectReports } from "@/lib/org-hierarchy";
import { Role, ROLE_METADATA, FIXED_ROLE_ASSIGNMENTS } from "./roles";

export interface DemoPersonaOption {
  role: Role;
  label: string;
  workerId: string;
  workerName: string;
}

const DISPLAY_ORDER: Role[] = [
  Role.EMPLOYEE,
  Role.MANAGER,
  Role.SKIP_LEVEL_MANAGER,
  Role.HR_OPS,
  Role.HR_PARTNER,
  Role.FINANCE_PLANNER,
  Role.PAYROLL_ADMIN,
  Role.EXECUTIVE,
  Role.SUPER_ADMIN,
];

let cachedOptions: { at: number; value: DemoPersonaOption[] } | null = null;

export async function getDemoPersonaOptions(): Promise<DemoPersonaOption[]> {
  const now = Date.now();
  if (cachedOptions && now - cachedOptions.at < 60_000) return cachedOptions.value;

  const snapshot = await getWorkforceSnapshot();
  const nameById = new Map(snapshot.map((r) => [r.workerId, r.legalName]));
  const fixedWorkerIdByRole = new Map<Role, string>();
  for (const [workerId, roles] of Object.entries(FIXED_ROLE_ASSIGNMENTS)) {
    for (const role of roles) fixedWorkerIdByRole.set(role, workerId);
  }
  const usedIds = new Set(fixedWorkerIdByRole.values());

  let employeeId: string | null = null;
  let managerId: string | null = null;
  let skipLevelId: string | null = null;

  for (const row of snapshot) {
    if (row.status !== "ACTIVE" || usedIds.has(row.workerId)) continue;
    const isSkipLevel = await hasIndirectReports(row.workerId);
    // A "pure" manager for demo purposes: has direct reports, but none of
    // those reports themselves manage anyone — otherwise this worker also
    // legitimately qualifies as Skip Level Manager (roles are additive, see
    // roles.ts), and picking them for the plain "Manager" persona makes the
    // top bar show all three roles at once, which reads as a bug even
    // though the underlying RBAC is correct.
    const isPureManager = !isSkipLevel && (await hasDirectReports(row.workerId));
    if (isSkipLevel && !skipLevelId) skipLevelId = row.workerId;
    else if (isPureManager && !managerId) managerId = row.workerId;
    else if (!isSkipLevel && !isPureManager && !employeeId) employeeId = row.workerId;
    if (employeeId && managerId && skipLevelId) break;
  }

  const derivedWorkerIdByRole = new Map<Role, string>([
    [Role.EMPLOYEE, employeeId ?? "E0004"],
    [Role.MANAGER, managerId ?? "E0002"],
    [Role.SKIP_LEVEL_MANAGER, skipLevelId ?? "E0001"],
  ]);

  const options: DemoPersonaOption[] = DISPLAY_ORDER.map((role) => {
    const workerId = fixedWorkerIdByRole.get(role) ?? derivedWorkerIdByRole.get(role)!;
    return { role, label: ROLE_METADATA[role].label, workerId, workerName: nameById.get(workerId) ?? workerId };
  });

  cachedOptions = { at: now, value: options };
  return options;
}
