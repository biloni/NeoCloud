"use client";
import { useRouter } from "next/navigation";
import { usePersona } from "@/lib/persona";
import { Select } from "@/components/ui";
import type { DemoPersonaOption } from "@/security/demoPersonas";

/**
 * Development-only persona switcher. Selecting an option sets the acting
 * worker id (the existing WORKER_COOKIE, via lib/persona.ts) to that role's
 * representative worker — the role itself is then DERIVED server-side from
 * that worker (security/roles.ts resolveRolesForWorker), never stored as a
 * separate "chosen role" value. This means switching personas here is
 * exactly equivalent to "logging in as" a different real employee.
 */
export function PersonaSwitcher({ options, currentWorkerId }: { options: DemoPersonaOption[]; currentWorkerId: string }) {
  const { setWorkerId } = usePersona();
  const router = useRouter();

  const current = options.find((o) => o.workerId === currentWorkerId);

  function handleChange(workerId: string) {
    setWorkerId(workerId);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <label className="hidden text-xs text-muted-foreground sm:inline">Persona</label>
      <Select value={current?.workerId ?? ""} onChange={(e) => handleChange(e.target.value)} className="w-32 sm:w-auto">
        {!current && <option value="">Custom ({currentWorkerId})</option>}
        {options.map((o) => (
          <option key={o.role} value={o.workerId}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
