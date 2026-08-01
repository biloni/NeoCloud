import Link from "next/link";
import { getAuthContext } from "@/lib/auth-context";
import { getInbox } from "@/lib/bp-engine";
import { effectiveWorkerId, effectiveRoles } from "@/security/authorization";
import { getVisibleMenu, NAV_ICON_MAP } from "@/security/menuVisibility";
import { HelpCircle } from "lucide-react";
import { ROLE_METADATA } from "@/security/roles";
import { prisma } from "@/lib/prisma";
import { Card, CardTitle, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

// The universal landing page — every role reaches this, unconditionally
// (see security/menuVisibility.ts, the "home" nav item carries no
// permission requirement). Content is a role-aware greeting, a compact
// "My Tasks" preview (reusing the same getInbox() the full /inbox page and
// /processes both use), and quick links generated from whatever this
// worker's menu actually contains — no separate hardcoded link list.
export default async function HomePage() {
  const ctx = await getAuthContext();
  const workerId = effectiveWorkerId(ctx);
  const roles = effectiveRoles(ctx);
  const roleLabel = roles.map((r) => ROLE_METADATA[r].label).join(" + ");

  const [worker, pendingSteps] = await Promise.all([
    prisma.worker.findUnique({ where: { id: workerId } }),
    getInbox(workerId),
  ]);
  const menu = getVisibleMenu(ctx).filter((m) => m.key !== "home");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Welcome back{worker ? `, ${worker.legalName.split(" ")[0]}` : ""}</h1>
        <p className="text-sm text-muted-foreground">
          {workerId} · <Badge variant="accent">{roleLabel}</Badge>
        </p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>My Tasks</CardTitle>
          {pendingSteps.length > 0 && <Badge variant="warning">{pendingSteps.length} pending</Badge>}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {pendingSteps.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending right now.</p>}
          {pendingSteps.slice(0, 5).map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{s.stepName} — {s.instance.subjectWorkerId}</span>
              <Badge variant="warning">Pending</Badge>
            </div>
          ))}
          {pendingSteps.length > 0 && (
            <Link href="/inbox" className="mt-1 w-fit text-xs text-accent hover:underline">View full inbox →</Link>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Quick links</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          {menu.map((item) => {
            const Icon = NAV_ICON_MAP[item.key] ?? HelpCircle;
            return (
              <Link key={item.key} href={item.href} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-muted">
                <Icon size={14} /> {item.label}
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
