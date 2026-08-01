"use client";
import { useState, useTransition } from "react";
import { createScenarioAction } from "@/lib/actions";
import { Card, CardTitle, Button } from "@/components/ui";

const TEMPLATE = JSON.stringify(
  {
    hirePlan: [{ department: "Engineering", quarter: "Q1", count: 5, targetLevel: "IC3", targetLocation: "SF", startMonth: 1 }],
    attritionByDept: { "GPU Cloud": 12, "On-Prem": 10, "Engineering": 12, "G&A": 9 },
    meritByLevel: { IC1: 3, IC2: 3.5, IC3: 4, IC4: 4, IC5: 4.5, IC6: 5, IC7: 5, M3: 4, M4: 4.5, M5: 5, M6: 5 },
    meritEffectiveDate: new Date(new Date().getFullYear(), new Date().getMonth() + 6, 1).toISOString(),
  },
  null,
  2
);

export function CreateScenarioForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createScenarioAction(fd);
        setSuccess(true);
        (e.target as HTMLFormElement).reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create scenario");
      }
    });
  }

  return (
    <Card>
      <CardTitle>Create a new scenario</CardTitle>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">Assumptions are edited as JSON for this exercise — same shape as the two pre-built scenarios.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input name="name" required placeholder="Scenario name" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
        <input name="description" placeholder="Description (optional)" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
        <textarea name="assumptions" defaultValue={TEMPLATE} rows={10} className="rounded-md border border-border bg-background p-2 font-mono text-xs" />
        {error && <div className="text-xs text-destructive">{error}</div>}
        {success && <div className="text-xs text-success">Scenario created.</div>}
        <Button type="submit" disabled={pending} className="w-fit">{pending ? "Saving..." : "Save scenario"}</Button>
      </form>
    </Card>
  );
}
