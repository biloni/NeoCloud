/**
 * ============================================================================
 * ROUTE GUARD — the mapping from URL routes to required permissions, plus
 * the two enforcement primitives every Server Component / Server Action
 * should call: guardRoute() (redirects) and assertPermission() (throws).
 * ============================================================================
 *
 * DESIGN DECISIONS
 * -----------------------------------------------------------------------
 * 1. ROUTE_PERMISSIONS is the single table of "which permission does this
 *    URL require." Pages import it (indirectly, via guardRoute) rather
 *    than hardcoding a permission check inline, so the same table also
 *    powers the permission-matrix admin page (/admin/permission-matrix)
 *    without a second, hand-maintained list.
 *
 * 2. Two enforcement styles, because Server Components and Server Actions
 *    fail differently:
 *      - guardRoute(ctx, path) — for page components. Calls Next's
 *        redirect() (which internally throws a special Next.js redirect
 *        signal) when the permission is missing. Never returns false; if
 *        it returns, access is granted.
 *      - assertPermission(ctx, permission) — for Server Actions and any
 *        future Route Handlers. Throws a plain Error with a message the
 *        existing client-side try/catch pattern (see lib/actions.ts)
 *        already surfaces to the user.
 * ============================================================================
 */
import { redirect } from "next/navigation";
import { Permission } from "./permissions";
import { type AuthContext, can, canAny } from "./authorization";

/**
 * Route -> required permission(s). An array means "any of these" (some
 * routes are reachable by more than one role via different permissions,
 * e.g. the dashboard by either the Executive or a future Workforce-wide
 * dashboard permission).
 */
export const ROUTE_PERMISSIONS: Record<string, Permission | Permission[]> = {
  "/": [Permission.VIEW_EXECUTIVE_DASHBOARD, Permission.VIEW_WORKFORCE_DASHBOARD],
  "/workers": Permission.VIEW_WORKER_DIRECTORY,
  "/org-chart": Permission.VIEW_ORG_CHART,
  "/processes": [Permission.VIEW_MANAGER_INBOX, Permission.VIEW_APPROVAL_INBOX, Permission.VIEW_HOME_INBOX],
  "/planning": Permission.VIEW_PLANNING,
  "/planning/compare": Permission.VIEW_PLANNING,
  "/payroll": Permission.VIEW_PAYROLL,
  "/ask": Permission.VIEW_ASK_PEOPLE_OS,
  "/profile": Permission.VIEW_OWN_PROFILE,
  "/paycheck": Permission.VIEW_PAYCHECK,
  "/inbox": Permission.VIEW_HOME_INBOX,
  "/team": Permission.VIEW_MANAGER_DASHBOARD,
  "/new-employee": Permission.ADD_EMPLOYEE,
  "/admin/permission-matrix": Permission.MANAGE_ROLES,
};

function isPermitted(ctx: AuthContext, required: Permission | Permission[]): boolean {
  return Array.isArray(required) ? canAny(ctx, required) : can(ctx, required);
}

/**
 * For Server Components. Redirects to `fallback` (default "/") if the
 * effective user lacks the route's required permission. Call at the top of
 * every page component, before fetching any data.
 */
export function guardRoute(ctx: AuthContext, path: keyof typeof ROUTE_PERMISSIONS | string, fallback = "/"): void {
  const required = ROUTE_PERMISSIONS[path];
  if (required === undefined) return; // unregistered routes are unguarded by default (e.g. dynamic /workers/[id], guarded separately by canViewEmployee)
  if (!isPermitted(ctx, required)) {
    redirect(fallback);
  }
}

export class AuthorizationError extends Error {}

/** For Server Actions / Route Handlers. Throws rather than redirecting. */
export function assertPermission(ctx: AuthContext, permission: Permission, message?: string): void {
  if (!can(ctx, permission)) {
    throw new AuthorizationError(message ?? `Missing required permission: ${permission}`);
  }
}

export function assertAnyPermission(ctx: AuthContext, permissions: Permission[], message?: string): void {
  if (!canAny(ctx, permissions)) {
    throw new AuthorizationError(message ?? `Missing one of required permissions: ${permissions.join(", ")}`);
  }
}
