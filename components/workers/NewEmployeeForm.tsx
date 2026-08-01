"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePersona } from "@/lib/persona";
import { createHireAction } from "@/lib/actions";
import { Card, CardTitle, Button, Select } from "@/components/ui";
import { LOCATIONS, LEVEL_ORDER, LEVEL_INFO } from "@/lib/reference-data";

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
];

export function NewEmployeeForm() {
  // Authorization for this form is enforced by the page it's rendered on
  // (guardRoute(ctx, "/new-employee", Permission.ADD_EMPLOYEE) — see
  // app/new-employee/page.tsx) and, server-side again, by createHireAction
  // itself. This component no longer self-gates on a raw persona string.
  const { workerId } = usePersona();
  const [open, setOpen] = useState(false);
  const [countryCode, setCountryCode] = useState("US");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const locationsForCountry = LOCATIONS.filter((l) => l.countryCode === countryCode);
  const today = new Date().toISOString().slice(0, 10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      try {
        const newId = await createHireAction(fd);
        setSuccess(`Created ${newId}.`);
        form.reset();
        setCountryCode("US");
        router.push(`/workers/${newId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create employee");
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>New employee</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "+ New Employee"}
        </Button>
      </div>
      {open && (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Creating as HR Partner ({workerId}). This hires the worker directly — no approval BP, unlike a data change.</p>
          <div className="flex gap-2">
            <input name="legalName" required placeholder="Legal name" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
            <input name="managerId" required placeholder="Manager ID (e.g. E0001)" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <Select name="countryCode" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </Select>
            <Select name="locationId" required defaultValue="">
              <option value="" disabled>Location...</option>
              {locationsForCountry.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
            <Select name="level" defaultValue="IC2">
              {LEVEL_ORDER.map((lvl) => (
                <option key={lvl} value={lvl}>{lvl} — {LEVEL_INFO[lvl].title}</option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <input name="annualSalary" type="number" required placeholder="Annual salary (local currency)" className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
            <input name="hireDate" type="date" defaultValue={today} className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          {success && <div className="text-xs text-success">{success}</div>}
          <Button type="submit" disabled={pending} className="w-fit">{pending ? "Creating..." : "Create employee"}</Button>
        </form>
      )}
    </Card>
  );
}
