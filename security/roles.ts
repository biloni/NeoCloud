/**
 * ============================================================================
 * ROLES — enterprise Security Group model (Workday-inspired)
 * ============================================================================
 *
 * DESIGN DECISIONS
 * -----------------------------------------------------------------------
 * 1. "Users" are Workers. This app has no login/session layer (per
 *    CLAUDE.md — auth is explicitly out of scope for the exercise), so
 *    rather than invent a parallel `User` table, every security-relevant
 *    identity IS a row in the existing `Worker` table. This mirrors
 *    Workday itself: a Worker business object *is* the security principal;
 *    there's no separate "user account" object to keep in sync with it.
 *
 * 2. Role assignment is a HYBRID model, matching Workday's two security
 *    group flavors:
 *      - "Assignable" roles (HR Ops, HR Partner, Finance Planner, Payroll
 *        Admin, Executive, Super Admin) are assigned directly to specific
 *        workers — see FIXED_ROLE_ASSIGNMENTS below. This is Workday's
 *        "Role-Based Security Group assigned to a specific Worker/Position."
 *      - "Derived" roles (Manager, Skip Level Manager) are NEVER manually
 *        assigned. They're computed from the live supervisory-org tree —
 *        exactly Workday's "Manager" security group, whose membership is
 *        whoever the org hierarchy currently says has reports. This keeps
 *        the role model consistent with the effective-dated org data
 *        instead of a second, driftable source of truth. See
 *        resolveRolesForWorker() below.
 *      - Every worker who isn't otherwise assigned falls back to EMPLOYEE.
 *
 * 3. A worker can hold MULTIPLE roles at once (e.g. a Manager who is also
 *    the fixed HR Partner). Effective permissions are the UNION across all
 *    held roles — additive access, matching Workday security group
 *    membership semantics (never subtractive).
 *
 * 4. Roles are intentionally NOT permissions. Roles group permissions;
 *    permissions gate behavior. See permissions.ts. Nothing in this file
 *    encodes "what a role can do" — only "who holds which role."
 *
 * 5. This module has zero React/Next.js imports — it's plain, testable
 *    TypeScript, importable from Server Components, Route Handlers, and
 *    Vitest unit tests alike.
 * ============================================================================
 */
import { hasDirectReports, hasIndirectReports } from "@/lib/org-hierarchy";

/** Every role in the system. Strongly typed — never compare against raw strings elsewhere. */
export enum Role {
  EMPLOYEE = "EMPLOYEE",
  MANAGER = "MANAGER",
  SKIP_LEVEL_MANAGER = "SKIP_LEVEL_MANAGER",
  HR_OPS = "HR_OPS",
  HR_PARTNER = "HR_PARTNER",
  FINANCE_PLANNER = "FINANCE_PLANNER",
  PAYROLL_ADMIN = "PAYROLL_ADMIN",
  EXECUTIVE = "EXECUTIVE",
  SUPER_ADMIN = "SUPER_ADMIN",
}

export const ALL_ROLES: Role[] = Object.values(Role);

/**
 * Most-specific-first ordering, used anywhere a worker's several held roles
 * need to collapse to ONE for framing/UX purposes (e.g. which persona
 * voice the AI assistant uses). This is display/tone only — it never
 * narrows actual permissions or tool access, which stay the union of every
 * held role (see ROLE_PERMISSIONS, ai-tools.ts ROLE_TOOL_ACCESS).
 */
export const ROLE_PRIORITY: Role[] = [
  Role.SUPER_ADMIN, Role.EXECUTIVE, Role.HR_PARTNER, Role.FINANCE_PLANNER,
  Role.PAYROLL_ADMIN, Role.HR_OPS, Role.SKIP_LEVEL_MANAGER, Role.MANAGER, Role.EMPLOYEE,
];

/** The single most specific role in a held-role set, per ROLE_PRIORITY. Never throws — EMPLOYEE is always a safe fallback since every worker holds it. */
export function primaryRole(roles: Role[]): Role {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? Role.EMPLOYEE;
}

export interface RoleMetadata {
  label: string;
  description: string;
  /** true = assigned directly to specific workers; false = computed from org structure. */
  assignable: boolean;
}

export const ROLE_METADATA: Record<Role, RoleMetadata> = {
  [Role.EMPLOYEE]: { label: "Employee", description: "Default role for every worker.", assignable: false },
  [Role.MANAGER]: { label: "Manager", description: "Derived: heads a supervisory org with at least one direct report.", assignable: false },
  [Role.SKIP_LEVEL_MANAGER]: { label: "Skip Level Manager", description: "Derived: at least one direct report who themselves has direct reports.", assignable: false },
  [Role.HR_OPS]: { label: "HR Ops", description: "HR operations — processes employee-submitted profile changes.", assignable: true },
  [Role.HR_PARTNER]: { label: "HR Partner", description: "HR business partner — approves manager-initiated data changes, hires.", assignable: true },
  [Role.FINANCE_PLANNER]: { label: "Finance Planner", description: "Workforce planning & budget scenarios.", assignable: true },
  [Role.PAYROLL_ADMIN]: { label: "Payroll Admin", description: "Payroll preview, GL posting, anomaly review.", assignable: true },
  [Role.EXECUTIVE]: { label: "Executive", description: "Company-wide visibility, no payroll access.", assignable: true },
  [Role.SUPER_ADMIN]: { label: "Super Admin", description: "Unrestricted access, including proxy and role administration.", assignable: true },
};

/**
 * Fixed role assignments, exactly as specified. Keyed by Worker.id.
 * A worker may appear at most once here today, but the type is Role[] so a
 * future worker could legitimately hold two assignable roles at once.
 */
export const FIXED_ROLE_ASSIGNMENTS: Record<string, Role[]> = {
  E0302: [Role.HR_OPS],
  E0301: [Role.HR_PARTNER],
  E0300: [Role.FINANCE_PLANNER],
  E0149: [Role.PAYROLL_ADMIN],
  E0010: [Role.SUPER_ADMIN],
  E0000: [Role.EXECUTIVE],
};

/**
 * The full set of roles held by a worker right now: fixed assignments
 * (if any) UNION derived Manager/Skip-Level-Manager roles UNION Employee
 * as the universal baseline. Never returns an empty array. Org-derived
 * checks delegate to lib/org-hierarchy.ts — the one place that builds and
 * caches the manager graph — rather than re-deriving it here.
 */
export async function resolveRolesForWorker(workerId: string): Promise<Role[]> {
  const roles = new Set<Role>([Role.EMPLOYEE]);
  for (const r of FIXED_ROLE_ASSIGNMENTS[workerId] ?? []) roles.add(r);

  if (await hasDirectReports(workerId)) roles.add(Role.MANAGER);
  if (await hasIndirectReports(workerId)) roles.add(Role.SKIP_LEVEL_MANAGER);

  return Array.from(roles);
}

/** Every worker id with a fixed, directly-assigned role — used by the permission matrix page and demo seeding. */
export function listFixedAssignments(): { workerId: string; roles: Role[] }[] {
  return Object.entries(FIXED_ROLE_ASSIGNMENTS).map(([workerId, roles]) => ({ workerId, roles }));
}

/** The worker id fixed to a given assignable role, if any — e.g. getFixedAssignee(Role.HR_OPS) -> "E0302". */
export function getFixedAssignee(role: Role): string | null {
  for (const [workerId, roles] of Object.entries(FIXED_ROLE_ASSIGNMENTS)) {
    if (roles.includes(role)) return workerId;
  }
  return null;
}
