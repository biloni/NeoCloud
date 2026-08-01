import { getEnrichedInbox } from "@/lib/bp-engine";
import { Inbox } from "@/components/processes/Inbox";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId, can } from "@/security/authorization";
import { Permission } from "@/security/permissions";

export const dynamic = "force-dynamic";

// Same underlying data (lib/bp-engine.ts getEnrichedInbox) and the same
// Inbox component /processes uses — only the heading is role-aware, per
// the spec's "Employee Home: My Tasks / Manager: My Team Requests /
// HR Partner & HR Ops: Pending Approvals." No separate inbox implementation
// per role.
export default async function InboxPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/inbox", "/home");
  const workerId = effectiveWorkerId(ctx);

  const heading = can(ctx, Permission.VIEW_APPROVAL_INBOX)
    ? "Pending Approvals"
    : can(ctx, Permission.VIEW_MANAGER_INBOX)
      ? "My Team Requests"
      : "My Tasks";

  const items = await getEnrichedInbox(workerId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm text-muted-foreground">Everything currently waiting on you across every business process.</p>
      </div>
      <Inbox items={items} actorWorkerId={workerId} />
    </div>
  );
}
