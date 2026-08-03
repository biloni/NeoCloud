"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startProfileChangeAction } from "@/lib/actions";
import { Card, CardTitle, Button, Select } from "@/components/ui";

// Self-service (or manager-on-behalf-of) entry point for the "Profile
// Change Request" BP — the second definition running on the generic BP
// engine (lib/bp-engine.ts's startProfileChangeRequest). The field/newValue
// pair is structured (not free text) specifically so that an approval can
// actually apply the change to the Worker record — see executeCompletion's
// PROFILE_CHANGE branch. Routing (HR Ops vs. HR Partner) is resolved
// server-side from the initiator's role.
const FIELD_OPTIONS = [
  { value: "legalName", label: "Legal name" },
  { value: "preferredName", label: "Preferred name" },
] as const;

export function ProfileChangeRequestForm({ subjectWorkerId, isSelf }: { subjectWorkerId: string; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<(typeof FIELD_OPTIONS)[number]["value"]>("legalName");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await startProfileChangeAction(fd);
        setSuccess("Request submitted — routed to " + (isSelf ? "HR Ops" : "HR Partner") + ". It updates your record automatically once approved.");
        setNewValue("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit request");
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Request a profile change</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "+ Request change"}
        </Button>
      </div>
      {open && (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="subjectWorkerId" value={subjectWorkerId} />
          <p className="text-xs text-muted-foreground">
            Legal name or preferred name corrections only — this is not a comp or transfer change, which use
            the Worker Data Change process instead. Routes to {isSelf ? "HR Ops" : "HR Partner"}; the record
            updates automatically the moment it's approved.
          </p>
          <div className="flex gap-2">
            <Select name="field" value={field} onChange={(e) => setField(e.target.value as typeof field)} className="w-40">
              {FIELD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <input
              name="newValue"
              required
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="New value"
              className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm"
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          {success && <div className="text-xs text-success">{success}</div>}
          <Button type="submit" disabled={pending} className="w-fit">{pending ? "Submitting..." : "Submit request"}</Button>
        </form>
      )}
    </Card>
  );
}
