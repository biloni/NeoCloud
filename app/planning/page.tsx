import Link from "next/link";
import { listScenarios, getPlanningBaseline } from "@/lib/planning";
import { PlanningWorkspace } from "@/components/planning/PlanningWorkspace";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/planning", "/home");

  const [scenarios, baseline] = await Promise.all([listScenarios(), getPlanningBaseline()]);
  const departments = baseline.depts.map((d) => d.department).sort();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Workforce Planning</h1>
          <p className="text-sm text-muted-foreground">Model hires, transfers, promotions, merit, and attrition over the next 12 months — charts update live as you edit.</p>
        </div>
        <Link href="/planning/compare" className="text-sm text-accent hover:underline">Compare scenarios →</Link>
      </div>

      <PlanningWorkspace
        scenarios={scenarios.map((s) => ({ id: s.id, name: s.name, description: s.description ?? "", assumptions: s.assumptions }))}
        baseline={baseline}
        departments={departments}
      />
    </div>
  );
}
