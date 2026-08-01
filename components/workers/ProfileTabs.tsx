"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ProfileTab {
  key: string;
  label: string;
  count?: number;
  content: React.ReactNode;
}

export function ProfileTabs({ tabs, defaultTab }: { tabs: ProfileTab[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  active === t.key ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
}
