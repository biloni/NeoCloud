/**
 * ============================================================================
 * PROXY — "act as" impersonation for HR Ops, HR Partner, and Super Admin.
 * ============================================================================
 *
 * DESIGN DECISIONS
 * -----------------------------------------------------------------------
 * 1. Eligibility is checked against the ACTUAL user's roles ONLY, resolved
 *    fresh from resolveRolesForWorker() — never trusted from client input,
 *    never derived from a proxy target. See canStartProxy().
 *
 * 2. Infinite proxy chain prevention is architectural, not a runtime
 *    counter: the app has exactly ONE "actual user" identity (the existing
 *    peopleos_worker cookie, WORKER_COOKIE — see security/ProxyContext.tsx)
 *    and AT MOST ONE "proxy target" identity (the new peopleos_proxy_worker
 *    cookie). There is no stack of nested proxies to overflow. Starting a
 *    new proxy session
 *    while one is already active simply REPLACES the single proxyUserId
 *    slot; it is evaluated against the same, unchanged actualUserId. A
 *    proxy target's own PROXY_USER permission is never consulted (see
 *    authorization.ts buildAuthContext and canProxy(), which both read
 *    ctx.actualRoles exclusively) — so even a proxy target who happens to
 *    hold an eligible role cannot bootstrap a second, nested proxy. The
 *    UI additionally hides the proxy selector entirely while a session is
 *    active (see ProxySelector.tsx) as a second, defense-in-depth layer.
 *
 * 3. Every proxy start, stop, and action taken while proxying is written
 *    to ProxyAuditLog (append-only, matches the effective-dating/audit
 *    philosophy used everywhere else in this app). Actual user, proxy
 *    user, timestamp, and action are always recorded together — see
 *    logProxyAction().
 * ============================================================================
 */
import { prisma } from "@/lib/prisma";
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { Role, resolveRolesForWorker } from "./roles";
import { Permission, ROLE_PERMISSIONS } from "./permissions";

/** Only these roles may open a proxy session, per spec. */
export const PROXY_ELIGIBLE_ROLES: Role[] = [Role.HR_OPS, Role.HR_PARTNER, Role.SUPER_ADMIN];

export function rolesCanProxy(roles: Role[]): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(Permission.PROXY_USER));
}

export interface ProxyEligibilityResult {
  allowed: boolean;
  reason?: string;
}

/** Validates a proxy request against the ACTUAL user's freshly-resolved roles. */
export async function checkProxyEligibility(actualWorkerId: string, targetWorkerId: string): Promise<ProxyEligibilityResult> {
  if (actualWorkerId === targetWorkerId) return { allowed: false, reason: "Cannot proxy yourself" };
  const actualRoles = await resolveRolesForWorker(actualWorkerId);
  if (!rolesCanProxy(actualRoles)) {
    return { allowed: false, reason: `${actualWorkerId} does not hold a proxy-eligible role (${PROXY_ELIGIBLE_ROLES.join(", ")})` };
  }
  const targetExists = (await getWorkforceSnapshot()).some((r) => r.workerId === targetWorkerId);
  if (!targetExists) return { allowed: false, reason: "Target worker not found or not currently active" };
  return { allowed: true };
}

export async function logProxyAction(actualUserId: string, proxyUserId: string, action: string, detail?: string) {
  await prisma.proxyAuditLog.create({ data: { actualUserId, proxyUserId, action, detail } });
}

export async function startProxySession(actualWorkerId: string, targetWorkerId: string): Promise<ProxyEligibilityResult> {
  const result = await checkProxyEligibility(actualWorkerId, targetWorkerId);
  if (result.allowed) {
    await logProxyAction(actualWorkerId, targetWorkerId, "PROXY_START");
  }
  return result;
}

export async function endProxySession(actualWorkerId: string, targetWorkerId: string): Promise<void> {
  await logProxyAction(actualWorkerId, targetWorkerId, "PROXY_END");
}

export interface ProxyAuditEntry {
  id: string;
  actualUserId: string;
  proxyUserId: string;
  action: string;
  detail: string | null;
  createdAt: Date;
}

export async function getProxyAuditLog(limit = 100): Promise<ProxyAuditEntry[]> {
  return prisma.proxyAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

// ---------------------------------------------------------------------------
// Employee search — powers the proxy selector's search box.
// ---------------------------------------------------------------------------

export interface EmployeeSearchResult {
  workerId: string;
  legalName: string;
  department: string;
  level: string;
  status: string;
}

export async function searchEmployees(query: string, limit = 20): Promise<EmployeeSearchResult[]> {
  const snapshot = await getWorkforceSnapshot();
  const q = query.trim().toLowerCase();
  const matches = snapshot.filter(
    (r) => !q || r.legalName.toLowerCase().includes(q) || r.workerId.toLowerCase().includes(q)
  );
  return matches
    .slice(0, limit)
    .map((r) => ({ workerId: r.workerId, legalName: r.legalName, department: r.department, level: r.level, status: r.status }));
}
