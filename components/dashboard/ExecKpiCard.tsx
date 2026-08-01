import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan" | "indigo" | "teal";

const ACCENT_STYLES: Record<Accent, { icon: string; ring: string }> = {
  blue: { icon: "bg-blue-500/10 text-blue-600 dark:text-blue-400", ring: "hover:ring-blue-500/20" },
  emerald: { icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", ring: "hover:ring-emerald-500/20" },
  violet: { icon: "bg-violet-500/10 text-violet-600 dark:text-violet-400", ring: "hover:ring-violet-500/20" },
  amber: { icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400", ring: "hover:ring-amber-500/20" },
  rose: { icon: "bg-rose-500/10 text-rose-600 dark:text-rose-400", ring: "hover:ring-rose-500/20" },
  cyan: { icon: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", ring: "hover:ring-cyan-500/20" },
  indigo: { icon: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", ring: "hover:ring-indigo-500/20" },
  teal: { icon: "bg-teal-500/10 text-teal-600 dark:text-teal-400", ring: "hover:ring-teal-500/20" },
};

export interface ExecKpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  accent: Accent;
  delta?: { value: string; positiveIsGood?: boolean; direction: "up" | "down" | "flat" };
}

export function ExecKpiCard({ label, value, sub, icon: Icon, accent, delta }: ExecKpiCardProps) {
  const styles = ACCENT_STYLES[accent];
  const deltaGood = delta && (delta.positiveIsGood ?? true) === (delta.direction === "up");

  return (
    <div
      className={cn(
        "card flex flex-col gap-3 p-4 transition-shadow hover:shadow-md hover:ring-1 sm:p-5",
        styles.ring
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", styles.icon)}>
          <Icon size={18} strokeWidth={2} />
        </div>
        {delta && delta.direction !== "flat" && (
          <span
            className={cn(
              "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
              deltaGood ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            )}
          >
            {delta.direction === "up" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {delta.value}
          </span>
        )}
      </div>
      <div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</div>
        {sub && <div className="mt-1 text-[11px] text-muted-foreground/80">{sub}</div>}
      </div>
    </div>
  );
}
