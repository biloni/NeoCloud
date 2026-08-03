import { Card, CardTitle, Badge, Table, Th, Td } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/utils";

export interface InstanceRow {
  id: string;
  definitionName: string;
  subjectName: string;
  subjectWorkerId: string;
  initiatorName: string;
  status: string;
  createdAt: Date;
  proposedChange: Record<string, any>;
  steps: { id: string; order: number; stepName: string; assigneeName: string; action: string; comment: string | null; actedAt: Date | null }[];
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "default" | "accent"> = {
  IN_PROGRESS: "accent",
  COMPLETED: "success",
  DENIED: "destructive",
  CANCELED: "warning",
};
const STEP_VARIANT: Record<string, "success" | "warning" | "destructive" | "default"> = {
  PENDING: "warning",
  APPROVED: "success",
  DENIED: "destructive",
  SKIPPED_BY_RULE: "default",
  SENT_BACK: "destructive",
};

function ChangeSummary({ change }: { change: Record<string, any> }) {
  if (change.changeType === "COMP_CHANGE") {
    return <span>{formatMoney(change.oldSalary, change.oldCurrency)} → {formatMoney(change.newSalary, change.currency)} ({change.compChangePct > 0 ? "+" : ""}{change.compChangePct}%)</span>;
  }
  if (change.changeType === "TRANSFER") {
    return <span>Transfer to {change.newManagerId} · {change.newLocationId}</span>;
  }
  if (change.changeType === "PROFILE_CHANGE") {
    return <span>{change.requestedChange}</span>;
  }
  return <span className="text-muted-foreground">{JSON.stringify(change)}</span>;
}

export function InstanceList({ instances }: { instances: InstanceRow[] }) {
  return (
    <Card>
      <CardTitle>Process history ({instances.length})</CardTitle>
      <div className="mt-3 flex flex-col gap-2">
        {instances.map((inst) => (
          <details key={inst.id} className="rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center justify-between gap-2 p-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{inst.subjectName}</span>
                <span className="text-muted-foreground">({inst.subjectWorkerId})</span>
                <span className="text-muted-foreground">·</span>
                <ChangeSummary change={inst.proposedChange} />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatDate(inst.createdAt)}</span>
                <Badge variant={STATUS_VARIANT[inst.status] ?? "default"}>{inst.status.replace(/_/g, " ")}</Badge>
              </span>
            </summary>
            <div className="border-t border-border p-3">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Step</Th>
                    <Th>Assignee</Th>
                    <Th>Action</Th>
                    <Th>Comment</Th>
                    <Th>Acted at</Th>
                  </tr>
                </thead>
                <tbody>
                  {inst.steps.map((s) => (
                    <tr key={s.id}>
                      <Td>{s.order}</Td>
                      <Td>{s.stepName}</Td>
                      <Td>{s.assigneeName}</Td>
                      <Td><Badge variant={STEP_VARIANT[s.action] ?? "default"}>{s.action.replace(/_/g, " ")}</Badge></Td>
                      <Td className="max-w-xs text-xs text-muted-foreground">{s.comment ?? "—"}</Td>
                      <Td className="text-xs">{s.actedAt ? formatDate(s.actedAt) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}
