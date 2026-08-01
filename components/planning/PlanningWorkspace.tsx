"use client";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScenarioEditor, type EditableScenario } from "./ScenarioEditor";
import type { PlanningBaseline } from "@/lib/planning-engine";

export function PlanningWorkspace({
  scenarios,
  baseline,
  departments,
}: {
  scenarios: EditableScenario[];
  baseline: PlanningBaseline;
  departments: string[];
}) {
  const [list, setList] = useState(scenarios);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(scenarios[0]?.id ?? "new");

  // Re-sync from the server once router.refresh() lands (e.g. after a save/delete elsewhere).
  useEffect(() => {
    setList(scenarios);
  }, [scenarios]);

  const selected = selectedId === "new" ? null : list.find((s) => s.id === selectedId) ?? null;

  function upsert(scenario: EditableScenario) {
    setList((prev) => {
      const exists = prev.some((s) => s.id === scenario.id);
      return exists ? prev.map((s) => (s.id === scenario.id ? scenario : s)) : [...prev, scenario];
    });
    setSelectedId(scenario.id);
  }

  function handleDeleted() {
    const remaining = list.filter((s) => s.id !== selected?.id);
    setList(remaining);
    setSelectedId(remaining[0]?.id ?? "new");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              selectedId === s.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={() => setSelectedId("new")}
          className={cn(
            "flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm",
            selectedId === "new" ? "border-accent bg-accent/10 text-accent" : "border-dashed border-border text-muted-foreground hover:bg-muted"
          )}
        >
          <Plus size={14} /> New scenario
        </button>
      </div>

      <ScenarioEditor
        key={selected ? selected.id : "new"}
        scenario={selected}
        baseline={baseline}
        departments={departments}
        onSaved={upsert}
        onDeleted={handleDeleted}
        onCancelNew={list[0] ? () => setSelectedId(list[0].id) : undefined}
      />
    </div>
  );
}
