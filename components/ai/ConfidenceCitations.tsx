"use client";
import { useState } from "react";
import { ChevronDown, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

// Shared rendering for the structured provide_answer output (see
// lib/ai-tools.ts PROVIDE_ANSWER_TOOL) — every AI surface in this app that
// grounds an answer in tool calls (Ask People OS chat, the workforce
// narrative generator) renders confidence and citations the same way,
// instead of each feature reinventing its own "trust me" UI.
export interface Citation {
  tool: string;
  detail: string;
}

const CONFIDENCE_STYLE: Record<string, { label: string; variant: "success" | "warning" | "destructive"; icon: typeof ShieldCheck }> = {
  high: { label: "High confidence", variant: "success", icon: ShieldCheck },
  medium: { label: "Medium confidence", variant: "warning", icon: ShieldQuestion },
  low: { label: "Low confidence", variant: "destructive", icon: ShieldAlert },
};

export function ConfidenceBadge({ confidence, reason }: { confidence?: string; reason?: string }) {
  const style = confidence ? CONFIDENCE_STYLE[confidence] : undefined;
  if (!style) return null;
  const Icon = style.icon;
  return (
    <span className="group relative inline-flex">
      <Badge variant={style.variant} className="gap-1">
        <Icon size={12} /> {style.label}
      </Badge>
      {reason && (
        <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 w-56 rounded-md bg-foreground px-2 py-1.5 text-xs text-background opacity-0 shadow-popover transition-opacity group-hover:opacity-100">
          {reason}
        </span>
      )}
    </span>
  );
}

export function Citations({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
        {citations.length} source{citations.length === 1 ? "" : "s"}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 animate-fade-in">
          {citations.map((c, i) => (
            <li key={i} className="flex gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs">
              <Badge className="shrink-0">{c.tool}</Badge>
              <span className="text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
