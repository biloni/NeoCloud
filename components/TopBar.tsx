"use client";
import { usePersona } from "@/lib/persona";
import { PERSONAS } from "@/lib/enums";
import { Select } from "./ui";

export function TopBar() {
  const { persona, setPersona, workerId, setWorkerId } = usePersona();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="text-sm text-muted-foreground">
        Acting as <span className="font-medium text-foreground">{PERSONAS.find((p) => p.key === persona)?.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Persona</label>
        <Select value={persona} onChange={(e) => setPersona(e.target.value as any)}>
          {PERSONAS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        <label className="ml-2 text-xs text-muted-foreground">As worker</label>
        <input
          className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value.toUpperCase())}
          placeholder="E0001"
        />
      </div>
    </header>
  );
}
