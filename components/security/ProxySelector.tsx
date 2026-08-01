"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { UserCog } from "lucide-react";
import { useProxy } from "@/security/ProxyContext";
import { searchEmployeesAction } from "@/lib/actions";
import type { EmployeeSearchResult } from "@/security/proxy";
import { cn } from "@/lib/utils";

/** Header "Act as..." control. Only rendered for proxy-eligible actual users (HR Ops, HR Partner, Super Admin) — see app layout, which passes `eligible` from a server-resolved AuthContext. */
export function ProxySelector({ eligible }: { eligible: boolean }) {
  const { startProxy } = useProxy();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const r = await searchEmployeesAction(query);
        setResults(r);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  if (!eligible) return null;

  async function pick(emp: EmployeeSearchResult) {
    setError(null);
    const err = await startProxy(emp.workerId, emp.legalName);
    if (err) {
      setError(err);
    } else {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
      >
        <UserCog size={14} /> Act as...
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-border bg-card p-2 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employee name or ID..."
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {error && <div className="mt-1 text-[11px] text-destructive">{error}</div>}
          <div className="mt-1 max-h-64 overflow-y-auto">
            {pending && <div className="px-2 py-2 text-xs text-muted-foreground">Searching...</div>}
            {!pending && results.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">{query ? "No matches." : "Type to search employees."}</div>
            )}
            {results.map((r) => (
              <button
                key={r.workerId}
                onClick={() => pick(r)}
                className={cn("flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted")}
              >
                <span className="font-medium">{r.legalName}</span>
                <span className="text-muted-foreground">{r.workerId} · {r.department} · {r.level}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
