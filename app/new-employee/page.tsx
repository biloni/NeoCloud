import { NewEmployeeForm } from "@/components/workers/NewEmployeeForm";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/new-employee", "/home");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New Employee</h1>
        <p className="text-sm text-muted-foreground">Hire a new worker directly — no approval process, unlike a data change on an existing employee.</p>
      </div>
      <NewEmployeeForm />
    </div>
  );
}
