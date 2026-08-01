import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { ALL_ROLES, ROLE_METADATA, Role } from "@/security/roles";
import { ROLE_PERMISSIONS, Permission } from "@/security/permissions";
import { NAV_ITEMS } from "@/security/menuVisibility";
import { PROXY_ELIGIBLE_ROLES } from "@/security/proxy";
import type { AuthContext } from "@/security/authorization";
import { can, canAny } from "@/security/authorization";
import { Card, CardTitle, Table, Th, Td, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

// Server actions / API routes that are individually permission-gated,
// listed here once so the matrix can show "Accessible APIs" per role
// without re-deriving it from source (this list is deliberately small and
// hand-maintained — it names *capabilities*, not URLs).
const GATED_OPERATIONS: { name: string; permission: Permission }[] = [
  { name: "createHireAction (hire a worker)", permission: Permission.ADD_EMPLOYEE },
  { name: "actOnStepAction — approve", permission: Permission.APPROVE_WORKFLOW },
  { name: "actOnStepAction — reject/send back", permission: Permission.REJECT_WORKFLOW },
  { name: "startProxyAction / endProxyAction", permission: Permission.PROXY_USER },
  { name: "POST /api/ask", permission: Permission.VIEW_ASK_PEOPLE_OS },
  { name: "acknowledgeAnomalyAction", permission: Permission.VIEW_PAYROLL },
  { name: "Scenario CRUD actions", permission: Permission.VIEW_PLANNING },
];

function fakeContextFor(role: Role): AuthContext {
  return { actualWorkerId: "(role preview)", actualRoles: [role], proxyWorkerId: null, proxyRoles: null };
}

export default async function PermissionMatrixPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/admin/permission-matrix", "/home");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Permission Matrix</h1>
        <p className="text-sm text-muted-foreground">
          Generated directly from security/permissions.ts (ROLE_PERMISSIONS), security/menuVisibility.ts (NAV_ITEMS),
          and security/proxy.ts (PROXY_ELIGIBLE_ROLES) — nothing on this page is hand-maintained separately from those tables.
        </p>
      </div>

      {ALL_ROLES.map((role) => {
        const roleCtx = fakeContextFor(role);
        const permissions = ROLE_PERMISSIONS[role];
        const visiblePages = NAV_ITEMS.filter((item) => {
          if (!item.permission) return true;
          return Array.isArray(item.permission) ? canAny(roleCtx, item.permission) : can(roleCtx, item.permission);
        });
        const accessibleApis = GATED_OPERATIONS.filter((op) => can(roleCtx, op.permission));
        const proxyAllowed = PROXY_ELIGIBLE_ROLES.includes(role);

        return (
          <Card key={role}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{ROLE_METADATA[role].label}</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_METADATA[role].description}</p>
              </div>
              <Badge variant={proxyAllowed ? "accent" : "default"}>{proxyAllowed ? "Can proxy" : "Cannot proxy"}</Badge>
            </div>

            <Table className="mt-4">
              <thead><tr><Th>Aspect</Th><Th>Detail</Th></tr></thead>
              <tbody>
                <tr>
                  <Td className="align-top font-medium">Permissions ({permissions.length})</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {permissions.map((p) => <Badge key={p} variant="default">{p}</Badge>)}
                    </div>
                  </Td>
                </tr>
                <tr>
                  <Td className="align-top font-medium">Visible pages ({visiblePages.length})</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {visiblePages.map((p) => (
                        <Badge key={p.key} variant="success">{typeof p.label === "function" ? p.label(roleCtx) : p.label}</Badge>
                      ))}
                    </div>
                  </Td>
                </tr>
                <tr>
                  <Td className="align-top font-medium">Accessible APIs ({accessibleApis.length})</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {accessibleApis.map((a) => <Badge key={a.name} variant="warning">{a.name}</Badge>)}
                      {accessibleApis.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                    </div>
                  </Td>
                </tr>
              </tbody>
            </Table>
          </Card>
        );
      })}
    </div>
  );
}
