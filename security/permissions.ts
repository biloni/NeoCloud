/**
 * ============================================================================
 * PERMISSIONS — atomic, strongly-typed capabilities + the Role -> Permission
 * matrix. This file is the SINGLE source of truth for "what can each role
 * do." Nothing outside this file should ever hardcode a role name to decide
 * visibility or access — every check goes through authorization.ts, which
 * reads ROLE_PERMISSIONS defined here.
 * ============================================================================
 *
 * DESIGN DECISIONS
 * -----------------------------------------------------------------------
 * 1. The 15 permissions explicitly requested are all present verbatim.
 *    Six more (marked EXTENSION below) were added because the requested
 *    menu-visibility spec names distinct pages (Org Chart, Paycheck, Home
 *    Inbox, Manager Inbox, Approval Inbox, Ask People OS, Manager
 *    Dashboard) that the required 15 don't individually cover — reusing an
 *    unrelated permission to gate them would be its own form of hardcoding.
 *    Extending the enum keeps every gate meaningful and named after what
 *    it actually protects.
 *
 * 2. Permissions are FEATURE ACCESS (can you open this page / see this nav
 *    item / call this action at all). DATA ACCESS (which specific worker
 *    rows you can see/edit once you're on the page) is a separate concern,
 *    deliberately not encoded here — see authorization.ts's
 *    canViewEmployee/canEditEmployee, which combine a permission check
 *    with a data-scope check. Conflating the two would make row-level
 *    rules impossible to extend independently of page-level ones.
 *
 * 3. ROLE_PERMISSIONS is additive-only: a worker's effective permissions
 *    are the union of every held role's permission set (see
 *    authorization.ts). There is no "deny" permission and no permission
 *    precedence to reason about — matching Workday security groups, where
 *    membership only ever grants, never revokes.
 * ============================================================================
 */
import { Role } from "./roles";

export enum Permission {
  // ---- Required (exact names from the spec) ----
  VIEW_OWN_PROFILE = "VIEW_OWN_PROFILE",
  VIEW_DIRECT_REPORTS = "VIEW_DIRECT_REPORTS",
  VIEW_INDIRECT_REPORTS = "VIEW_INDIRECT_REPORTS",
  EDIT_OWN_PROFILE = "EDIT_OWN_PROFILE",
  EDIT_EMPLOYEE = "EDIT_EMPLOYEE",
  APPROVE_WORKFLOW = "APPROVE_WORKFLOW",
  REJECT_WORKFLOW = "REJECT_WORKFLOW",
  VIEW_PAYROLL = "VIEW_PAYROLL",
  VIEW_PLANNING = "VIEW_PLANNING",
  VIEW_WORKFORCE_DASHBOARD = "VIEW_WORKFORCE_DASHBOARD",
  VIEW_WORKER_DIRECTORY = "VIEW_WORKER_DIRECTORY",
  VIEW_EXECUTIVE_DASHBOARD = "VIEW_EXECUTIVE_DASHBOARD",
  ADD_EMPLOYEE = "ADD_EMPLOYEE",
  PROXY_USER = "PROXY_USER",
  MANAGE_USERS = "MANAGE_USERS",
  MANAGE_ROLES = "MANAGE_ROLES",

  // ---- Extensions: needed to gate pages the menu spec names individually ----
  VIEW_ORG_CHART = "VIEW_ORG_CHART",
  VIEW_PAYCHECK = "VIEW_PAYCHECK",
  VIEW_HOME_INBOX = "VIEW_HOME_INBOX",
  VIEW_MANAGER_DASHBOARD = "VIEW_MANAGER_DASHBOARD",
  VIEW_MANAGER_INBOX = "VIEW_MANAGER_INBOX",
  VIEW_APPROVAL_INBOX = "VIEW_APPROVAL_INBOX",
  VIEW_ASK_PEOPLE_OS = "VIEW_ASK_PEOPLE_OS",
}

export const ALL_PERMISSIONS: Permission[] = Object.values(Permission);

const EMPLOYEE_BASE: Permission[] = [
  Permission.VIEW_OWN_PROFILE,
  Permission.EDIT_OWN_PROFILE,
  Permission.VIEW_ORG_CHART,
  Permission.VIEW_PAYCHECK,
  Permission.VIEW_HOME_INBOX,
];

const MANAGER_ADDITIONS: Permission[] = [
  Permission.VIEW_DIRECT_REPORTS,
  Permission.EDIT_EMPLOYEE, // scope (direct reports only) enforced by the data-access layer, not here
  Permission.VIEW_MANAGER_DASHBOARD,
  Permission.VIEW_MANAGER_INBOX,
];

/**
 * The permission matrix. Read as "this role grants these permissions" —
 * a worker's effective set is the union across every role they hold
 * (see authorization.ts effectivePermissions()).
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.EMPLOYEE]: EMPLOYEE_BASE,

  [Role.MANAGER]: [...EMPLOYEE_BASE, ...MANAGER_ADDITIONS],

  [Role.SKIP_LEVEL_MANAGER]: [...EMPLOYEE_BASE, ...MANAGER_ADDITIONS, Permission.VIEW_INDIRECT_REPORTS],

  [Role.HR_OPS]: [
    ...EMPLOYEE_BASE,
    Permission.VIEW_APPROVAL_INBOX,
    Permission.APPROVE_WORKFLOW,
    Permission.REJECT_WORKFLOW,
    Permission.PROXY_USER,
  ],

  [Role.HR_PARTNER]: [
    ...EMPLOYEE_BASE,
    Permission.VIEW_APPROVAL_INBOX,
    Permission.ADD_EMPLOYEE,
    Permission.EDIT_EMPLOYEE,
    Permission.APPROVE_WORKFLOW,
    Permission.REJECT_WORKFLOW,
    Permission.PROXY_USER,
  ],

  [Role.FINANCE_PLANNER]: [...EMPLOYEE_BASE, Permission.VIEW_PLANNING],

  [Role.PAYROLL_ADMIN]: [...EMPLOYEE_BASE, Permission.VIEW_PAYROLL],

  [Role.EXECUTIVE]: [
    ...EMPLOYEE_BASE,
    Permission.VIEW_EXECUTIVE_DASHBOARD,
    Permission.VIEW_WORKFORCE_DASHBOARD,
    Permission.VIEW_WORKER_DIRECTORY,
    Permission.VIEW_PLANNING,
    Permission.VIEW_ASK_PEOPLE_OS,
    // Deliberately NOT VIEW_PAYROLL — "No Payroll" is explicit in the spec.
  ],

  // Super Admin: every permission that exists, always — "all tabs." Computed
  // from ALL_PERMISSIONS rather than repeated by hand so adding a new
  // permission automatically grants it to Super Admin with no separate edit.
  [Role.SUPER_ADMIN]: ALL_PERMISSIONS,
};
