import { getEnrichedInbox } from "@/lib/bp-engine";
import { Inbox } from "@/components/processes/Inbox";
import { ProfilePhotoTaskRow } from "@/components/workers/ProfilePhotoTaskRow";
import { Card, CardTitle } from "@/components/ui";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveWorkerId, can } from "@/security/authorization";
import { Permission } from "@/security/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Same underlying data (lib/bp-engine.ts getEnrichedInbox) and the same
// Inbox component /processes uses — only the heading is role-aware, per
// the spec's "Employee Home: My Tasks / Manager: My Team Requests /
// HR Partner & HR Ops: Pending Approvals." No separate inbox implementation
// per role.
//
// The self-service "add a photo" task (see app/home/page.tsx) is rendered
// here too, in its own small card above the BP-approval Inbox — this page
// and Home's "My Tasks" preview render the identical heading for an
// Employee-tier persona, so they need to agree on what counts as pending.
export default async function InboxPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/inbox", "/home");
  const workerId = effectiveWorkerId(ctx);

  const heading = can(ctx, Permission.VIEW_APPROVAL_INBOX)
    ? "Pending Approvals"
    : can(ctx, Permission.VIEW_MANAGER_INBOX)
      ? "My Team Requests"
      : "My Tasks";

  const [items, worker] = await Promise.all([
    getEnrichedInbox(workerId),
    prisma.worker.findUnique({ where: { id: workerId } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm text-muted-foreground">Everything currently waiting on you across every business process.</p>
      </div>
      {!worker?.photoUrl && (
        <Card>
          <CardTitle>Your to-dos</CardTitle>
          <div className="mt-3">
            <ProfilePhotoTaskRow />
          </div>
        </Card>
      )}
      <Inbox items={items} actorWorkerId={workerId} />
    </div>
  );
}
