// RBAC integration tests — run against the real seeded dev.db (deterministic
// seed, see prisma/seed.ts) rather than mocked data, because the behavior
// under test IS the composition of role derivation (roles.ts) with the real
// org graph (lib/org-hierarchy.ts) via authorization.ts. Run with:
//   npm run test
// Requires `npm run db:reset` to have been run at least once so dev.db exists.
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getWorkforceSnapshot } from "@/lib/snapshot";
import { getDirectReportIds, getIndirectReportIds, hasDirectReports, hasIndirectReports } from "@/lib/org-hierarchy";
import { FIXED_ROLE_ASSIGNMENTS } from "@/security/roles";
import {
  buildAuthContext,
  canViewPayroll,
  canViewPlanning,
  canAddEmployee,
  canEditEmployee,
  canProxy,
  canManageRoles,
  can,
} from "@/security/authorization";
import { Permission } from "@/security/permissions";

afterAll(async () => {
  await prisma.$disconnect();
});

// Fixed identities, guaranteed stable by security/roles.ts FIXED_ROLE_ASSIGNMENTS.
const HR_OPS = "E0302";
const HR_PARTNER = "E0301";
const SUPER_ADMIN = "E0010";
const EXECUTIVE = "E0000";

/** A worker with no fixed role assignment and no reports — a "pure" Employee. */
async function findPlainEmployee(): Promise<string> {
  const snapshot = await getWorkforceSnapshot();
  for (const row of snapshot) {
    if (row.workerId in FIXED_ROLE_ASSIGNMENTS) continue;
    if (await hasDirectReports(row.workerId)) continue;
    return row.workerId;
  }
  throw new Error("No plain Employee found in seeded data");
}

/** A worker who manages people but isn't a skip-level (no report of theirs manages people). */
async function findManagerOnly(): Promise<{ managerId: string; directReportId: string; strangerId: string }> {
  const snapshot = await getWorkforceSnapshot();
  for (const row of snapshot) {
    if (!(await hasDirectReports(row.workerId))) continue;
    if (await hasIndirectReports(row.workerId)) continue; // exclude skip-levels
    const directs = await getDirectReportIds(row.workerId);
    const directReportId = Array.from(directs)[0];
    const stranger = snapshot.find(
      (s) => s.workerId !== row.workerId && s.workerId !== directReportId && !directs.has(s.workerId)
    );
    if (directReportId && stranger) {
      return { managerId: row.workerId, directReportId, strangerId: stranger.workerId };
    }
  }
  throw new Error("No manager-only (non-skip-level) worker found in seeded data");
}

/** A worker with an indirect report (their own reporting subtree is 2+ deep). */
async function findSkipLevel(): Promise<{ skipLevelId: string; indirectReportId: string }> {
  const snapshot = await getWorkforceSnapshot();
  for (const row of snapshot) {
    if (!(await hasIndirectReports(row.workerId))) continue;
    const direct = await getDirectReportIds(row.workerId);
    const indirect = await getIndirectReportIds(row.workerId);
    const indirectOnly = Array.from(indirect).find((id) => !direct.has(id));
    if (indirectOnly) return { skipLevelId: row.workerId, indirectReportId: indirectOnly };
  }
  throw new Error("No Skip Level Manager found in seeded data");
}

describe("RBAC: feature access", () => {
  it("Employees cannot access Payroll", async () => {
    const employeeId = await findPlainEmployee();
    const ctx = await buildAuthContext(employeeId);
    expect(canViewPayroll(ctx)).toBe(false);
  });

  it("Executives cannot access Payroll", async () => {
    const ctx = await buildAuthContext(EXECUTIVE);
    expect(canViewPayroll(ctx)).toBe(false);
  });

  it("Super Admin can access everything (payroll, planning, add employee, proxy, manage roles)", async () => {
    const ctx = await buildAuthContext(SUPER_ADMIN);
    expect(canViewPayroll(ctx)).toBe(true);
    expect(canViewPlanning(ctx)).toBe(true);
    expect(canAddEmployee(ctx)).toBe(true);
    expect(canProxy(ctx)).toBe(true);
    expect(canManageRoles(ctx)).toBe(true);
    expect(can(ctx, Permission.VIEW_WORKER_DIRECTORY)).toBe(true);
    expect(can(ctx, Permission.VIEW_PAYCHECK)).toBe(true);
  });

  it("HR Partner, HR Ops, and Super Admin can proxy; a plain Employee cannot", async () => {
    expect(canProxy(await buildAuthContext(HR_PARTNER))).toBe(true);
    expect(canProxy(await buildAuthContext(HR_OPS))).toBe(true);
    expect(canProxy(await buildAuthContext(SUPER_ADMIN))).toBe(true);

    const employeeId = await findPlainEmployee();
    expect(canProxy(await buildAuthContext(employeeId))).toBe(false);
  });
});

describe("RBAC: data access scope", () => {
  it("Managers cannot edit workers outside their direct-report set", async () => {
    const { managerId, directReportId, strangerId } = await findManagerOnly();
    const ctx = await buildAuthContext(managerId);
    expect(await canEditEmployee(ctx, directReportId)).toBe(true);
    expect(await canEditEmployee(ctx, strangerId)).toBe(false);
  });

  it("Skip Level Managers can edit indirect reports", async () => {
    const { skipLevelId, indirectReportId } = await findSkipLevel();
    const ctx = await buildAuthContext(skipLevelId);
    expect(await canEditEmployee(ctx, indirectReportId)).toBe(true);
  });
});

describe("RBAC: proxy honors only the actual user's eligibility", () => {
  it("a non-eligible actual user cannot establish a proxy session, even naming an eligible-looking target", async () => {
    const employeeId = await findPlainEmployee();
    const ctx = await buildAuthContext(employeeId, HR_PARTNER);
    expect(ctx.proxyWorkerId).toBeNull();
    expect(ctx.proxyRoles).toBeNull();
  });

  it("an eligible actual user (Super Admin) can establish a proxy session, and effective payroll access follows the proxy target", async () => {
    const employeeId = await findPlainEmployee();
    const ctx = await buildAuthContext(SUPER_ADMIN, employeeId);
    expect(ctx.proxyWorkerId).toBe(employeeId);
    expect(canViewPayroll(ctx)).toBe(false); // effective identity is now the Employee target
  });
});
