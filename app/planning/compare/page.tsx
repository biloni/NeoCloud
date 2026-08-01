import Link from "next/link";
import { listScenarios, getPlanningBaseline } from "@/lib/planning";
import { CompareWorkspace } from "@/components/planning/CompareWorkspace";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/planning/compare", "/home");

  const [scenarios, baseline] = await Promise.all([listScenarios(), getPlanningBaseline()]);
  const departments = baseline.depts.map((d) => d.department).sort();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Scenario Comparison</h1>
          <p className="text-sm text-muted-foreground">Current baseline vs. two scenarios — updates live as you switch either one.</p>
        </div>
        <Link href="/planning" className="text-sm text-accent hover:underline">← Back to planning</Link>
      </div>

      <CompareWorkspace
        scenarios={scenarios.map((s) => ({ id: s.id, name: s.name, description: s.description ?? "", assumptions: s.assumptions }))}
        baseline={baseline}
        departments={departments}
      />
    </div>
  );
}
