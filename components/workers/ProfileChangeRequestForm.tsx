"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startProfileChangeAction } from "@/lib/actions";
import { Card, CardTitle, Button } from "@/components/ui";

// Self-service (or manager-on-behalf-of) entry point for the "Profile
// Change Request" BP — the second definition running on the generic BP
// engine (lib/bp-engine.ts's startProfileChangeRequest). Routing (HR Ops vs.
// HR Partner) is resolved server-side from the initiator's role; this form
// only collects the free-text request.
export function ProfileChangeRequestForm({ subjectWorkerId, isSelf }: { subjectWorkerId: string; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [requestedChange, setRequestedChange] = useState("");
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
        setSuccess("Request submitted — routed to " + (isSelf ? "HR Ops" : "HR Partner") + ".");
        setRequestedChange("");
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
            Free-text request (e.g. legal name update, personal details) — this is not a comp or transfer
            change, which use the Worker Data Change process instead. Routes to {isSelf ? "HR Ops" : "HR Partner"}.
          </p>
          <textarea
            name="requestedChange"
            required
            value={requestedChange}
            onChange={(e) => setRequestedChange(e.target.value)}
            placeholder="Describe the change you're requesting..."
            className="min-h-[72px] rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          {error && <div className="text-xs text-destructive">{error}</div>}
          {success && <div className="text-xs text-success">{success}</div>}
          <Button type="submit" disabled={pending} className="w-fit">{pending ? "Submitting..." : "Submit request"}</Button>
        </form>
      )}
    </Card>
  );
}
