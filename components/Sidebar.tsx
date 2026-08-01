"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON_MAP, type VisibleNavItem } from "@/security/menuVisibility";
import { HelpCircle } from "lucide-react";

// Navigation is generated entirely from the authorization engine — see
// security/menuVisibility.ts. This component renders whatever `menu` it's
// given; it holds no per-role knowledge of its own.
export function Sidebar({ menu }: { menu: VisibleNavItem[] }) {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card px-3 py-4">
      <div className="mb-6 px-2">
        <div className="text-sm font-semibold tracking-tight">NeoCloud</div>
        <div className="text-xs text-muted-foreground">People OS</div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {menu.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = NAV_ICON_MAP[item.key] ?? HelpCircle;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-muted"
              )}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-2 text-[11px] text-muted-foreground">
        Synthetic demo data · Take-home exercise
      </div>
    </aside>
  );
}
