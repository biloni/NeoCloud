/**
 * ============================================================================
 * AUTHORIZATION ENGINE — the single entry point every page, Server Action,
 * and Route Handler asks before rendering data or performing a mutation.
 * ============================================================================
 *
 * DESIGN DECISIONS
 * -----------------------------------------------------------------------
 * 1. AuthContext separates "actual user" from "proxy user" explicitly (see
 *    proxy.ts for how a proxy session is established). Per the spec,
 *    permissions are evaluated as "Current User AND Proxy Context": the
 *    ACTUAL user must be entitled to proxy at all (checked once, when the
 *    session starts — see proxy.ts startProxySession), and once a valid
 *    proxy session exists, effective behavior becomes the PROXY TARGET's
 *    (the app "behaves as the selected employee"). If a proxy context is
 *    ever malformed (e.g. proxyRoles missing), this module fails closed —
 *    effectivePermissions() returns empty rather than falling back to the
 *    actual user's (usually more powerful) permissions.
 *
 * 2. Two distinct kinds of check, both funnelled through this file:
 *      - FEATURE ACCESS: can(ctx, permission) — "is this capability
 *        available to me at all." Drives routeGuard.ts and
 *        menuVisibility.ts.
 *      - DATA ACCESS: canViewEmployee/canEditEmployee(ctx, targetId) —
 *        "given that I have the feature, which specific worker rows can I
 *        touch." These compose a permission check with a data-scope
 *        check (self / direct reports / indirect reports / everyone),
 *        resolved via lib/org-hierarchy.ts. Every "can I do X to worker Y"
 *        question in the app should call one of these, not re-implement
 *        the direct/indirect-report logic inline (that's the "no
 *        duplicated logic" requirement).
 *
 * 3. Role-based, not permission-based, data scoping. A role's DATA reach
 *    (self-only / team / everyone) is a property of the role, expressed in
 *    DATA_SCOPE_BY_ROLE below — deliberately separate from ROLE_PERMISSIONS
 *    (which governs feature access) because two roles can share a feature
 *    permission (e.g. EDIT_EMPLOYEE) while having very different data
 *    reach (Manager: direct reports only; HR Partner: everyone).
 *
 * 4. This file has no framework imports beyond plain async functions —
 *    every export is callable from Server Components, Route Handlers, and
 *    Vitest tests without a request/response object in scope.
 * ============================================================================
 */
import { Role, resolveRolesForWorker } from "./roles";
import { Permission, ROLE_PERMISSIONS } from "./permissions";
import { isInReportingChain, isDirectReport, isIndirectReport } from "@/lib/org-hierarchy";

export interface AuthContext {
  /** The real, logged-in-as worker id (in this app: whoever the session cookie names). */
  actualWorkerId: string;
  actualRoles: Role[];
  /** Non-null only while a valid proxy session is active. */
  proxyWorkerId: string | null;
  proxyRoles: Role[] | null;
}

/**
 * Build an AuthContext from raw worker ids. This resolves BOTH the actual
 * user's roles and (if proxying) the proxy target's roles, and enforces the
 * "Current User AND Proxy Context" rule at construction time: a proxy is
 * only honored if the actual user currently holds PROXY_USER — otherwise
 * proxyWorkerId/proxyRoles come back null and the context behaves as the
 * actual user alone. This is the ONLY place that should call
 * resolveRolesForWorker() for request-serving code — pages/actions call
 * this once, then pass the resulting AuthContext to every can*() check.
 */
export async function buildAuthContext(actualWorkerId: string, proxyWorkerId?: string | null): Promise<AuthContext> {
  const actualRoles = await resolveRolesForWorker(actualWorkerId);

  if (!proxyWorkerId || proxyWorkerId === actualWorkerId) {
    return { actualWorkerId, actualRoles, proxyWorkerId: null, proxyRoles: null };
  }

  const actualCanProxy = actualRoles.some((r) => ROLE_PERMISSIONS[r].includes(Permission.PROXY_USER));
  if (!actualCanProxy) {
    return { actualWorkerId, actualRoles, proxyWorkerId: null, proxyRoles: null };
  }

  const proxyRoles = await resolveRolesForWorker(proxyWorkerId);
  return { actualWorkerId, actualRoles, proxyWorkerId, proxyRoles };
}

export function isProxying(ctx: AuthContext): boolean {
  return ctx.proxyWorkerId !== null;
}

/** The worker id whose data/permissions currently govern the request. */
export function effectiveWorkerId(ctx: AuthContext): string {
  return ctx.proxyWorkerId ?? ctx.actualWorkerId;
}

export function effectiveRoles(ctx: AuthContext): Role[] {
  if (isProxying(ctx)) return ctx.proxyRoles ?? []; // fail closed if malformed
  return ctx.actualRoles;
}

export function effectivePermissions(ctx: AuthContext): Set<Permission> {
  const perms = new Set<Permission>();
  for (const role of effectiveRoles(ctx)) {
    for (const p of ROLE_PERMISSIONS[role]) perms.add(p);
  }
  return perms;
}

// ---------------------------------------------------------------------------
// Feature access
// ---------------------------------------------------------------------------

export function can(ctx: AuthContext, permission: Permission): boolean {
  return effectivePermissions(ctx).has(permission);
}

export function canAny(ctx: AuthContext, permissions: Permission[]): boolean {
  const held = effectivePermissions(ctx);
  return permissions.some((p) => held.has(p));
}

export function canAll(ctx: AuthContext, permissions: Permission[]): boolean {
  const held = effectivePermissions(ctx);
  return permissions.every((p) => held.has(p));
}

// ---------------------------------------------------------------------------
// Data access scope
// ---------------------------------------------------------------------------

export enum DataScope {
  SELF_ONLY = "SELF_ONLY",
  SELF_AND_TEAM = "SELF_AND_TEAM", // self + direct reports
  SELF_AND_ORG_SUBTREE = "SELF_AND_ORG_SUBTREE", // self + direct + indirect reports
  EVERYONE = "EVERYONE",
}

/** The widest data scope granted by a role. See module doc §3. */
export const DATA_SCOPE_BY_ROLE: Record<Role, DataScope> = {
  [Role.EMPLOYEE]: DataScope.SELF_ONLY,
  [Role.MANAGER]: DataScope.SELF_AND_TEAM,
  [Role.SKIP_LEVEL_MANAGER]: DataScope.SELF_AND_ORG_SUBTREE,
  [Role.HR_OPS]: DataScope.EVERYONE,
  [Role.HR_PARTNER]: DataScope.EVERYONE,
  [Role.FINANCE_PLANNER]: DataScope.EVERYONE,
  [Role.PAYROLL_ADMIN]: DataScope.EVERYONE,
  [Role.EXECUTIVE]: DataScope.EVERYONE,
  [Role.SUPER_ADMIN]: DataScope.EVERYONE,
};

const SCOPE_RANK: Record<DataScope, number> = {
  [DataScope.SELF_ONLY]: 0,
  [DataScope.SELF_AND_TEAM]: 1,
  [DataScope.SELF_AND_ORG_SUBTREE]: 2,
  [DataScope.EVERYONE]: 3,
};

/** The widest data scope across every role the context currently holds. */
export function effectiveDataScope(ctx: AuthContext): DataScope {
  let widest = DataScope.SELF_ONLY;
  for (const role of effectiveRoles(ctx)) {
    const scope = DATA_SCOPE_BY_ROLE[role];
    if (SCOPE_RANK[scope] > SCOPE_RANK[widest]) widest = scope;
  }
  return widest;
}

/**
 * Can the current effective user VIEW `targetWorkerId`'s record?
 * SELF_ONLY -> only their own id. SELF_AND_TEAM -> self + direct reports.
 * SELF_AND_ORG_SUBTREE -> self + direct + indirect reports. EVERYONE -> true.
 */
export async function canViewEmployee(ctx: AuthContext, targetWorkerId: string): Promise<boolean> {
  const me = effectiveWorkerId(ctx);
  const scope = effectiveDataScope(ctx);
  if (scope === DataScope.EVERYONE) return true;
  if (me === targetWorkerId) return true;
  if (scope === DataScope.SELF_ONLY) return false;
  if (scope === DataScope.SELF_AND_TEAM) return isDirectReport(me, targetWorkerId);
  return isInReportingChain(me, targetWorkerId); // SELF_AND_ORG_SUBTREE
}

/**
 * Can the current effective user EDIT `targetWorkerId`'s record? Requires
 * BOTH the EDIT_EMPLOYEE/EDIT_OWN_PROFILE feature permission AND the data
 * scope to reach that worker — e.g. a Manager has EDIT_EMPLOYEE but it's
 * meaningless outside their direct-report set.
 */
export async function canEditEmployee(ctx: AuthContext, targetWorkerId: string): Promise<boolean> {
  const me = effectiveWorkerId(ctx);
  if (me === targetWorkerId) return can(ctx, Permission.EDIT_OWN_PROFILE);
  if (!can(ctx, Permission.EDIT_EMPLOYEE)) return false;

  const scope = effectiveDataScope(ctx);
  if (scope === DataScope.EVERYONE) return true;
  if (scope === DataScope.SELF_AND_TEAM) return isDirectReport(me, targetWorkerId);
  if (scope === DataScope.SELF_AND_ORG_SUBTREE) {
    // Per spec: "Skip Level: Can edit indirect reports" — direct reports are
    // also editable (a skip-level manager's scope is a superset of a manager's).
    return (await isDirectReport(me, targetWorkerId)) || (await isIndirectReport(me, targetWorkerId));
  }
  return false;
}

export function canApprove(ctx: AuthContext): boolean {
  return can(ctx, Permission.APPROVE_WORKFLOW);
}

export function canReject(ctx: AuthContext): boolean {
  return can(ctx, Permission.REJECT_WORKFLOW);
}

export function canViewPayroll(ctx: AuthContext): boolean {
  return can(ctx, Permission.VIEW_PAYROLL);
}

export function canViewPlanning(ctx: AuthContext): boolean {
  return can(ctx, Permission.VIEW_PLANNING);
}

export function canAddEmployee(ctx: AuthContext): boolean {
  return can(ctx, Permission.ADD_EMPLOYEE);
}

export function canProxy(ctx: AuthContext): boolean {
  // Proxy eligibility is always evaluated against the ACTUAL user, never a
  // proxy target — you can't proxy your way into new proxy rights (see
  // proxy.ts for the full infinite-chain guard).
  return ctx.actualRoles.some((r) => ROLE_PERMISSIONS[r].includes(Permission.PROXY_USER));
}

export function canManageUsers(ctx: AuthContext): boolean {
  return can(ctx, Permission.MANAGE_USERS);
}

export function canManageRoles(ctx: AuthContext): boolean {
  return can(ctx, Permission.MANAGE_ROLES);
}
