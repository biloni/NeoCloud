"use client";
import { useState, useTransition } from "react";
import { actOnStepAction } from "@/lib/actions";
import { Card, CardTitle, Badge, Button } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export interface InboxItem {
  stepInstanceId: string;
  stepName: string;
  instanceId: string;
  subjectWorkerId: string;
  subjectName: string;
  initiatorName: string;
  proposedChange: Record<string, any>;
}

function ChangeSummary({ change }: { change: Record<string, any> }) {
  if (change.changeType === "COMP_CHANGE") {
    return (
      <span>
        {formatMoney(change.oldSalary, change.oldCurrency)} → {formatMoney(change.newSalary, change.currency)}
        {" "}
        <Badge variant={Math.abs(change.compChangePct) > 10 ? "warning" : "default"}>{change.compChangePct > 0 ? "+" : ""}{change.compChangePct}%</Badge>
      </span>
    );
  }
  return <span>Transfer to manager {change.newManagerId} · {change.newLocationId}</span>;
}

function ActionRow({ item, actorWorkerId }: { item: InboxItem; actorWorkerId: string }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(action: "APPROVED" | "DENIED" | "SENT_BACK") {
    setError(null);
    if ((action === "DENIED" || action === "SENT_BACK") && !comment.trim()) {
      setError("A comment is required to deny or send back.");
      return;
    }
    const fd = new FormData();
    fd.set("stepInstanceId", item.stepInstanceId);
    fd.set("actorWorkerId", actorWorkerId);
    fd.set("action", action);
    fd.set("comment", comment);
    startTransition(async () => {
      try {
        await actOnStepAction(fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to act on step");
      }
    });
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{item.stepName}</div>
          <div className="text-xs text-muted-foreground">
            {item.subjectName} ({item.subjectWorkerId}) · initiated by {item.initiatorName}
          </div>
        </div>
        <Badge variant="accent">Pending your action</Badge>
      </div>
      <div className="text-sm">
        <ChangeSummary change={item.proposedChange} />
      </div>
      <input
        className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        placeholder="Comment (required for deny / send back)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => act("APPROVED")}>Approve</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("SENT_BACK")}>Send back</Button>
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => act("DENIED")}>Deny</Button>
      </div>
    </Card>
  );
}

export function Inbox({ items, actorWorkerId }: { items: InboxItem[]; actorWorkerId: string }) {
  return (
    <Card>
      <CardTitle>Your inbox ({items.length})</CardTitle>
      <div className="mt-3 flex flex-col gap-3">
        {items.length === 0 && <div className="text-sm text-muted-foreground">Nothing pending for {actorWorkerId} right now.</div>}
        {items.map((item) => (
          <ActionRow key={item.stepInstanceId} item={item} actorWorkerId={actorWorkerId} />
        ))}
      </div>
    </Card>
  );
}
