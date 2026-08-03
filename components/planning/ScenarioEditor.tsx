"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  computeProjection,
  emptyAssumptions,
  type ScenarioAssumptions,
  type HirePlanEntry,
  type TransferEntry,
  type PromotionEntry,
  type PlanningBaseline,
} from "@/lib/planning-engine";
import { createScenarioAction, updateScenarioAction, duplicateScenarioAction, deleteScenarioAction } from "@/lib/actions";
import { Card, CardTitle, Button, Badge } from "@/components/ui";
import { ProjectionChart } from "@/components/charts/ProjectionChart";
import { formatUSD, formatPct, cn } from "@/lib/utils";
import { LEVEL_ORDER, LOCATIONS } from "@/lib/reference-data";
import { Trash2 } from "lucide-react";

export interface EditableScenario {
  id: string;
  name: string;
  description: string;
  assumptions: ScenarioAssumptions;
}

const inputCls = "h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent";
const selectCls = inputCls;

function monthLabel(m: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function ScenarioEditor({
  scenario,
  baseline,
  departments,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  scenario: EditableScenario | null; // null = creating a new scenario
  baseline: PlanningBaseline;
  departments: string[];
  onSaved: (scenario: EditableScenario) => void;
  onDeleted?: () => void;
  onCancelNew?: () => void;
}) {
  const isNew = scenario === null;
  const [name, setName] = useState(scenario?.name ?? "New Scenario");
  const [description, setDescription] = useState(scenario?.description ?? "");
  const [assumptions, setAssumptions] = useState<ScenarioAssumptions>(scenario?.assumptions ?? emptyAssumptions(departments));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const router = useRouter();

  // Live projection — pure client-side recompute, no server round-trip, so this updates on every keystroke.
  const projection = useMemo(() => computeProjection(baseline, assumptions), [baseline, assumptions]);
  const ending = projection[projection.length - 1];
  const chartData = useMemo(() => projection.map((m) => ({ label: m.label, totalHeadcount: m.totalHeadcount, totalCostUsd: m.monthlyBurnUsd })), [projection]);
  const totalHiringCost = useMemo(() => projection.reduce((s, m) => s + m.oneTimeHiringCostUsd, 0), [projection]);
  const locationMixTotal = Object.values(assumptions.locationMix).reduce((a, b) => a + (Number(b) || 0), 0);

  function patch(fn: (a: ScenarioAssumptions) => ScenarioAssumptions) {
    setAssumptions((prev) => fn(prev));
    setSavedFlash(false);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const id = isNew ? await createScenarioAction({ name, description, assumptions }) : scenario.id;
        if (!isNew) await updateScenarioAction({ id: scenario.id, name, description, assumptions });
        onSaved({ id, name, description, assumptions });
        setSavedFlash(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save scenario");
      }
    });
  }

  function handleDuplicate() {
    if (!scenario) return;
    setError(null);
    const newName = `${scenario.name} (copy)`;
    startTransition(async () => {
      try {
        const id = await duplicateScenarioAction({ id: scenario.id, newName });
        onSaved({ id, name: newName, description: scenario.description, assumptions: scenario.assumptions });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to duplicate scenario");
      }
    });
  }

  function handleDelete() {
    if (!scenario) return;
    if (!confirm(`Delete "${scenario.name}"? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteScenarioAction(scenario.id);
        onDeleted?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete scenario");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-1 flex-col gap-2">
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setSavedFlash(false); }}
              className="w-full max-w-md rounded-md border border-border bg-background px-2 py-1 text-lg font-semibold tracking-tight focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Scenario name"
            />
            <input
              value={description}
              onChange={(e) => { setDescription(e.target.value); setSavedFlash(false); }}
              className="w-full max-w-lg rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Description (optional)"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {savedFlash && <Badge variant="success">Saved</Badge>}
            {!isNew && <Button size="sm" variant="outline" disabled={pending} onClick={handleDuplicate}>Duplicate</Button>}
            {!isNew && <Button size="sm" variant="destructive" disabled={pending} onClick={handleDelete}>Delete</Button>}
            {isNew && onCancelNew && <Button size="sm" variant="ghost" onClick={onCancelNew}>Cancel</Button>}
            <Button size="sm" disabled={pending} onClick={handleSave}>{pending ? "Saving..." : "Save"}</Button>
          </div>
        </div>
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Ending headcount" value={ending ? ending.totalHeadcount.toFixed(0) : "—"} />
          <MiniStat label="Ending annual cost" value={ending ? formatUSD(ending.totalCostUsd * 12) : "—"} />
          <MiniStat label="Ending international %" value={ending ? formatPct(ending.internationalPct) : "—"} />
          <MiniStat label="12mo hiring cost" value={formatUSD(totalHiringCost)} />
        </div>

        <div className="mt-4">
          <ProjectionChart data={chartData} />
          <p className="mt-1 text-[11px] text-muted-foreground">Bars show monthly burn (ongoing payroll + one-time hiring cost); line shows headcount. Updates live as you edit assumptions below.</p>
        </div>
      </Card>

      {/* Hiring */}
      <Card>
        <CardTitle>Hiring</CardTitle>
        <div className="mt-3 flex flex-col gap-2">
          {assumptions.hirePlan.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={selectCls} value={row.department} onChange={(e) => patch((a) => ({ ...a, hirePlan: replaceAt(a.hirePlan, i, { ...row, department: e.target.value }) }))}>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className={selectCls} value={row.targetLevel} onChange={(e) => patch((a) => ({ ...a, hirePlan: replaceAt(a.hirePlan, i, { ...row, targetLevel: e.target.value }) }))}>
                {LEVEL_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <NumInput value={row.count} onChange={(v) => patch((a) => ({ ...a, hirePlan: replaceAt(a.hirePlan, i, { ...row, count: v }) }))} suffix="hires" />
              <select
                className={selectCls}
                value={row.targetLocation ?? ""}
                title="Target location — leave as Mix to apportion via the Location mix card below"
                onChange={(e) => patch((a) => ({ ...a, hirePlan: replaceAt(a.hirePlan, i, { ...row, targetLocation: e.target.value }) }))}
              >
                <option value="">Location: Mix</option>
                {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <MonthPicker value={row.startMonth} onChange={(v) => patch((a) => ({ ...a, hirePlan: replaceAt(a.hirePlan, i, { ...row, startMonth: v }) }))} />
              <RemoveBtn onClick={() => patch((a) => ({ ...a, hirePlan: a.hirePlan.filter((_, idx) => idx !== i) }))} />
            </div>
          ))}
          <AddRowBtn label="Add hiring wave" onClick={() => patch((a) => ({ ...a, hirePlan: [...a.hirePlan, defaultHire(departments)] }))} />
        </div>
      </Card>

      {/* Transfers */}
      <Card>
        <CardTitle>Transfers</CardTitle>
        <div className="mt-3 flex flex-col gap-2">
          {assumptions.transfers.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">From</span>
              <select className={selectCls} value={row.fromDepartment} onChange={(e) => patch((a) => ({ ...a, transfers: replaceAt(a.transfers, i, { ...row, fromDepartment: e.target.value }) }))}>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">to</span>
              <select className={selectCls} value={row.toDepartment} onChange={(e) => patch((a) => ({ ...a, transfers: replaceAt(a.transfers, i, { ...row, toDepartment: e.target.value }) }))}>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <NumInput value={row.count} onChange={(v) => patch((a) => ({ ...a, transfers: replaceAt(a.transfers, i, { ...row, count: v }) }))} suffix="people" />
              <MonthPicker value={row.month} onChange={(v) => patch((a) => ({ ...a, transfers: replaceAt(a.transfers, i, { ...row, month: v }) }))} />
              <RemoveBtn onClick={() => patch((a) => ({ ...a, transfers: a.transfers.filter((_, idx) => idx !== i) }))} />
            </div>
          ))}
          <AddRowBtn label="Add transfer" onClick={() => patch((a) => ({ ...a, transfers: [...a.transfers, defaultTransfer(departments)] }))} />
          {assumptions.transfers.length === 0 && <p className="text-xs text-muted-foreground">No transfers planned.</p>}
        </div>
      </Card>

      {/* Promotions */}
      <Card>
        <CardTitle>Promotions</CardTitle>
        <div className="mt-3 flex flex-col gap-2">
          {assumptions.promotions.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={selectCls} value={row.department} onChange={(e) => patch((a) => ({ ...a, promotions: replaceAt(a.promotions, i, { ...row, department: e.target.value }) }))}>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className={selectCls} value={row.fromLevel} onChange={(e) => patch((a) => ({ ...a, promotions: replaceAt(a.promotions, i, { ...row, fromLevel: e.target.value }) }))}>
                {LEVEL_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">→</span>
              <select className={selectCls} value={row.toLevel} onChange={(e) => patch((a) => ({ ...a, promotions: replaceAt(a.promotions, i, { ...row, toLevel: e.target.value }) }))}>
                {LEVEL_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <NumInput value={row.count} onChange={(v) => patch((a) => ({ ...a, promotions: replaceAt(a.promotions, i, { ...row, count: v }) }))} suffix="people" />
              <MonthPicker value={row.month} onChange={(v) => patch((a) => ({ ...a, promotions: replaceAt(a.promotions, i, { ...row, month: v }) }))} />
              <RemoveBtn onClick={() => patch((a) => ({ ...a, promotions: a.promotions.filter((_, idx) => idx !== i) }))} />
            </div>
          ))}
          <AddRowBtn label="Add promotion wave" onClick={() => patch((a) => ({ ...a, promotions: [...a.promotions, defaultPromotion(departments)] }))} />
          {assumptions.promotions.length === 0 && <p className="text-xs text-muted-foreground">No promotions planned.</p>}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Attrition % (annualized)</CardTitle>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {departments.map((d) => (
              <label key={d} className="flex items-center justify-between gap-2 text-xs">
                {d}
                <NumInput
                  value={assumptions.attritionByDept[d] ?? 0}
                  onChange={(v) => patch((a) => ({ ...a, attritionByDept: { ...a.attritionByDept, [d]: v } }))}
                  suffix="%"
                  step={0.5}
                />
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Merit % (annualized)</CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">Effective date:</p>
          <input
            type="date"
            className={cn(inputCls, "mt-1 w-full")}
            value={assumptions.meritEffectiveDate.slice(0, 10)}
            onChange={(e) => patch((a) => ({ ...a, meritEffectiveDate: new Date(e.target.value).toISOString() }))}
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {LEVEL_ORDER.map((l) => (
              <label key={l} className="flex items-center justify-between gap-1 text-xs">
                {l}
                <NumInput
                  value={assumptions.meritByLevel[l] ?? 0}
                  onChange={(v) => patch((a) => ({ ...a, meritByLevel: { ...a.meritByLevel, [l]: v } }))}
                  suffix="%"
                  step={0.5}
                  narrow
                />
              </label>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Hiring cost</CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">Flat blended recruiting/onboarding cost, charged once per hire in the month they start.</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <NumInput value={assumptions.hiringCostPerHireUsd} onChange={(v) => patch((a) => ({ ...a, hiringCostPerHireUsd: v }))} suffix="per hire" step={500} wide />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Location mix</CardTitle>
            <Badge variant={Math.abs(locationMixTotal - 100) < 1 ? "success" : "warning"}>{locationMixTotal.toFixed(0)}% total</Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Fallback split for hiring waves left on &quot;Location: Mix&quot; above — drives the projected International % trend for those hires.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {LOCATIONS.map((loc) => (
              <label key={loc.id} className="flex items-center justify-between gap-2 text-xs">
                {loc.name}
                <NumInput
                  value={assumptions.locationMix[loc.id] ?? 0}
                  onChange={(v) => patch((a) => ({ ...a, locationMix: { ...a.locationMix, [loc.id]: v } }))}
                  suffix="%"
                />
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function NumInput({ value, onChange, suffix, step = 1, narrow, wide }: { value: number; onChange: (v: number) => void; suffix?: string; step?: number; narrow?: boolean; wide?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(inputCls, narrow ? "w-14" : wide ? "w-24" : "w-16")}
      />
      {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
    </span>
  );
}

function MonthPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
        <option key={m} value={m}>{monthLabel(m)}</option>
      ))}
    </select>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
      <Trash2 size={14} />
    </button>
  );
}

function AddRowBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-fit rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-accent hover:text-accent">
      + {label}
    </button>
  );
}

function replaceAt<T>(arr: T[], i: number, value: T): T[] {
  const next = [...arr];
  next[i] = value;
  return next;
}
function defaultHire(departments: string[]): HirePlanEntry {
  return { department: departments[0] ?? "", targetLevel: "IC3", count: 5, startMonth: 1, targetLocation: "" };
}
function defaultTransfer(departments: string[]): TransferEntry {
  return { fromDepartment: departments[0] ?? "", toDepartment: departments[1] ?? departments[0] ?? "", count: 1, month: 1 };
}
function defaultPromotion(departments: string[]): PromotionEntry {
  return { department: departments[0] ?? "", fromLevel: "IC3", toLevel: "IC4", count: 1, month: 1 };
}
