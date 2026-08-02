"use client";
import { useState, useTransition } from "react";
import { startChangeAction } from "@/lib/actions";
import { Card, CardTitle, Button, Select } from "@/components/ui";

export function StartChangeForm({ initiatorId }: { initiatorId: string }) {
  const [changeType, setChangeType] = useState<"COMP_CHANGE" | "TRANSFER">("COMP_CHANGE");
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
        await startChangeAction(fd);
        setSuccess(true);
        (e.target as HTMLFormElement).reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start process");
      }
    });
  }

  return (
    <Card>
      <CardTitle>Start a worker data change</CardTitle>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Initiated as {initiatorId}. Comp changes over 10% automatically route through Comp Partner
        review before HR Partner approval — try a small and a large change to see the routing differ.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input name="subjectWorkerId" required placeholder="Subject worker ID (e.g. E0004)" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
          <Select value={changeType} onChange={(e) => setChangeType(e.target.value as any)} name="changeType">
            <option value="COMP_CHANGE">Comp change</option>
            <option value="TRANSFER">Transfer</option>
          </Select>
        </div>
        {changeType === "COMP_CHANGE" ? (
          <div className="flex gap-2">
            <input name="newSalary" type="number" required placeholder="New annual salary" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
            <Select name="currency" defaultValue="USD">
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="INR">INR</option>
            </Select>
          </div>
        ) : (
          <div className="flex gap-2">
            <input name="newManagerId" required placeholder="New manager ID (e.g. E0007)" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
            <input name="newLocationId" placeholder="New location (optional, e.g. SF)" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
          </div>
        )}
        {error && <div className="text-xs text-destructive">{error}</div>}
        {success && <div className="text-xs text-success">Started. Check the process list below.</div>}
        <Button type="submit" disabled={pending} className="w-fit">{pending ? "Starting..." : "Start process"}</Button>
      </form>
    </Card>
  );
}
