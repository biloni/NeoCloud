"use client";
import { useState, useTransition } from "react";
import { AlertTriangle, AlertCircle, Info, Check, RotateCcw } from "lucide-react";
import { acknowledgeAnomalyAction, unacknowledgeAnomalyAction } from "@/lib/actions";
import { Card, Badge, Button } from "@/components/ui";
import { formatDate, cn } from "@/lib/utils";
import type { AnomalySeverity, AnomalyType } from "@/lib/payroll";

export interface AnomalyItem {
  key: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  subjectLabel: string;
  workerId?: string;
  department?: string;
  explanation: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string; // ISO
}

const SEVERITY_STYLES: Record<AnomalySeverity, { badge: "destructive" | "warning" | "default"; border: string; icon: typeof AlertTriangle }> = {
  high: { badge: "destructive", border: "border-destructive/30 bg-destructive/5", icon: AlertTriangle },
  medium: { badge: "warning", border: "border-warning/30 bg-warning/5", icon: AlertCircle },
  low: { badge: "default", border: "border-border bg-muted/40", icon: Info },
};

function AnomalyRow({ item, actorId }: { item: AnomalyItem; actorId: string }) {
  const [acknowledged, setAcknowledged] = useState(item.acknowledged);
  const [ackBy, setAckBy] = useState(item.acknowledgedBy);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [pending, startTransition] = useTransition();
  const styles = SEVERITY_STYLES[item.severity];
  const Icon = styles.icon;

  function acknowledge() {
    startTransition(async () => {
      await acknowledgeAnomalyAction({ key: item.key, comment: comment || undefined });
      setAcknowledged(true);
      setAckBy(actorId);
      setShowComment(false);
    });
  }
  function unacknowledge() {
    startTransition(async () => {
      await unacknowledgeAnomalyAction(item.key);
      setAcknowledged(false);
      setAckBy(undefined);
    });
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-3 text-sm", styles.border, acknowledged && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={styles.badge}>{item.severity}</Badge>
              <span className="font-medium">{item.title}</span>
              <span className="text-muted-foreground">— {item.subjectLabel}</span>
              {acknowledged && <Badge variant="success">Acknowledged{ackBy ? ` by ${ackBy}` : ""}</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.explanation}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {!acknowledged && !showComment && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowComment(true)}>
              <Check size={12} /> Acknowledge
            </Button>
          )}
          {acknowledged && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={unacknowledge}>
              <RotateCcw size={12} /> Reopen
            </Button>
          )}
        </div>
      </div>
      {showComment && !acknowledged && (
        <div className="ml-6 flex items-center gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional note (e.g. 'confirmed with HR partner')"
            className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <Button size="sm" disabled={pending} onClick={acknowledge}>{pending ? "..." : "Confirm"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowComment(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export function AnomalyPanel({ items, actorId }: { items: AnomalyItem[]; actorId: string }) {
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const visible = showAcknowledged ? items : items.filter((i) => !i.acknowledged);
  const openCount = items.filter((i) => !i.acknowledged).length;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted-foreground">
          {openCount} open anomal{openCount === 1 ? "y" : "ies"} {items.length > openCount && `(${items.length - openCount} acknowledged)`}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showAcknowledged} onChange={(e) => setShowAcknowledged(e.target.checked)} />
          Show acknowledged
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {visible.length === 0 && <div className="text-sm text-muted-foreground">No open anomalies this period.</div>}
        {visible.map((item) => (
          <AnomalyRow key={item.key} item={item} actorId={actorId} />
        ))}
      </div>
    </Card>
  );
}
