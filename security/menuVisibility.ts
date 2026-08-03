/**
 * ============================================================================
 * MENU VISIBILITY — dynamic navigation generation from permissions.
 * ============================================================================
 *
 * DESIGN DECISIONS
 * -----------------------------------------------------------------------
 * 1. ONE canonical NAV_ITEMS table drives navigation for every role. There
 *    is no per-role menu list anywhere in this codebase (not here, not in
 *    Sidebar.tsx) — getVisibleMenu() filters this single table by
 *    permission, and Sidebar.tsx renders whatever it returns. Adding a
 *    role or changing what a role can see means editing permissions.ts's
 *    ROLE_PERMISSIONS matrix, never a menu array.
 *
 * 2. A few items (Home, Inbox) are shared across roles but mean something
 *    slightly different depending on who's looking — "Inbox" becomes
 *    "Manager Inbox" for a Manager and "Approval Inbox" for HR Partner/HR
 *    Ops, per the spec. Rather than create three near-duplicate nav rows
 *    pointing at the same /inbox route (which the underlying page already
 *    labels itself, see app/inbox/page.tsx), each item's `label` may be a
 *    function of the AuthContext. This keeps a single row, single
 *    permission check, and a role-appropriate label — no duplicated
 *    routes or logic.
 *
 * 3. "Home" has no permission requirement — every authenticated worker
 *    sees it, matching how a landing page normally isn't itself gated.
 * ============================================================================
 */
import {
  LayoutDashboard, Users, Network, GitBranch, LineChart, Wallet, MessageCircleQuestion,
  Home, UserCircle, Receipt, Inbox as InboxIcon, LayoutGrid, UserPlus, ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Permission, ROLE_PERMISSIONS } from "./permissions";
import { Role } from "./roles";
import { type AuthContext, can, canAny } from "./authorization";

// The baseline every worker gets regardless of role — used to work out
// which of a role's visible nav items are something EXTRA beyond that
// baseline (e.g. Planning for Finance Planner), so the sidebar can
// highlight them. Pulling this from ROLE_PERMISSIONS rather than hardcoding
// a second list keeps it impossible for the baseline to drift out of sync
// with EMPLOYEE_BASE in permissions.ts.
const EMPLOYEE_PERMISSIONS = new Set(ROLE_PERMISSIONS[Role.EMPLOYEE]);

export interface NavItem {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string | ((ctx: AuthContext) => string);
  /** undefined = always visible once authenticated (e.g. Home). Array = visible if ANY permission is held. */
  permission?: Permission | Permission[];
}

function inboxLabel(ctx: AuthContext): string {
  if (canAny(ctx, [Permission.VIEW_APPROVAL_INBOX])) return "Approval Inbox";
  if (canAny(ctx, [Permission.VIEW_MANAGER_INBOX])) return "Manager Inbox";
  return "Inbox";
}

export const NAV_ITEMS: NavItem[] = [
  { key: "home", href: "/home", icon: Home, label: "Home" }, // always visible
  { key: "profile", href: "/profile", icon: UserCircle, label: "Profile", permission: Permission.VIEW_OWN_PROFILE },
  { key: "org-chart", href: "/org-chart", icon: Network, label: "Org Chart", permission: Permission.VIEW_ORG_CHART },
  { key: "paycheck", href: "/paycheck", icon: Receipt, label: "Paycheck", permission: Permission.VIEW_PAYCHECK },
  {
    key: "inbox",
    href: "/inbox",
    icon: InboxIcon,
    label: inboxLabel,
    permission: [Permission.VIEW_HOME_INBOX, Permission.VIEW_MANAGER_INBOX, Permission.VIEW_APPROVAL_INBOX],
  },
  { key: "manager-dashboard", href: "/team", icon: LayoutGrid, label: "Manager Dashboard", permission: Permission.VIEW_MANAGER_DASHBOARD },
  { key: "direct-reports", href: "/team/reports", icon: Users, label: "Direct Reports", permission: Permission.VIEW_DIRECT_REPORTS },
  { key: "new-employee", href: "/new-employee", icon: UserPlus, label: "New Employee", permission: Permission.ADD_EMPLOYEE },
  { key: "planning", href: "/planning", icon: LineChart, label: "Planning", permission: Permission.VIEW_PLANNING },
  { key: "payroll", href: "/payroll", icon: Wallet, label: "Payroll", permission: Permission.VIEW_PAYROLL },
  { key: "dashboard", href: "/", icon: LayoutDashboard, label: "Dashboard", permission: [Permission.VIEW_EXECUTIVE_DASHBOARD, Permission.VIEW_WORKFORCE_DASHBOARD] },
  { key: "workers", href: "/workers", icon: Users, label: "Workers", permission: Permission.VIEW_WORKER_DIRECTORY },
  { key: "ask", href: "/ask", icon: MessageCircleQuestion, label: "Ask People OS", permission: Permission.VIEW_ASK_PEOPLE_OS },
  { key: "processes", href: "/processes", icon: GitBranch, label: "Worker Data Change (demo)", permission: [Permission.EDIT_EMPLOYEE, Permission.APPROVE_WORKFLOW] },
  { key: "permission-matrix", href: "/admin/permission-matrix", icon: ShieldCheck, label: "Permission Matrix", permission: Permission.MANAGE_ROLES },
];

// Icon components are plain functions — React Server Components cannot
// serialize a function as a *prop value* when passing it to a Client
// Component (AppShell/Sidebar are "use client"). VisibleNavItem therefore
// carries `key` only; NAV_ICON_MAP lets any client component resolve the
// same key back to its icon locally, entirely within client-side code
// (importing the map itself is fine — only crossing the RSC prop boundary
// as a function value is not). Server Components that render menu items
// directly (e.g. app/home/page.tsx) use NAV_ICON_MAP the same way, for one
// consistent lookup instead of two different menu shapes.
export const NAV_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(NAV_ITEMS.map((item) => [item.key, item.icon]));

export interface VisibleNavItem {
  key: string;
  href: string;
  label: string;
  /** True if this item is visible ONLY because of a permission beyond the Employee baseline — e.g. Planning for Finance Planner. Drives the sidebar's "extra access" highlight. */
  additional: boolean;
}

/** True if every permission this item requires is something Employee already has — i.e. Employee sees this item too, so it isn't "extra" for anyone else. Items with no permission (Home) are always baseline. */
function isBeyondEmployeeBaseline(item: NavItem): boolean {
  if (!item.permission) return false;
  const perms = Array.isArray(item.permission) ? item.permission : [item.permission];
  return !perms.some((p) => EMPLOYEE_PERMISSIONS.has(p));
}

export function getVisibleMenu(ctx: AuthContext): VisibleNavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    return Array.isArray(item.permission) ? canAny(ctx, item.permission) : can(ctx, item.permission);
  }).map((item) => ({
    key: item.key,
    href: item.href,
    label: typeof item.label === "function" ? item.label(ctx) : item.label,
    additional: isBeyondEmployeeBaseline(item),
  }));
}
