"use client";
import { Menu } from "lucide-react";
import { PersonaSwitcher } from "@/components/security/PersonaSwitcher";
import { ProxySelector } from "@/components/security/ProxySelector";
import { usePersona } from "@/lib/persona";
import type { DemoPersonaOption } from "@/security/demoPersonas";

export function TopBar({
  onOpenMenu,
  currentWorkerId,
  roleLabel,
  demoOptions,
  proxyEligible,
}: {
  onOpenMenu?: () => void;
  currentWorkerId: string;
  roleLabel: string;
  demoOptions: DemoPersonaOption[];
  proxyEligible: boolean;
}) {
  const { workerId } = usePersona();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onOpenMenu}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-muted md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>
        <div className="hidden truncate text-sm text-muted-foreground sm:block">
          Signed in as <span className="font-medium text-foreground">{roleLabel}</span>
          <span className="ml-1 text-xs">({currentWorkerId})</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <PersonaSwitcher options={demoOptions} currentWorkerId={workerId || currentWorkerId} />
        <ProxySelector eligible={proxyEligible} />
      </div>
    </header>
  );
}
