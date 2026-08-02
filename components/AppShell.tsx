"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ProxyBanner } from "./security/ProxyBanner";
import { cn } from "@/lib/utils";
import type { VisibleNavItem } from "@/security/menuVisibility";
import type { DemoPersonaOption } from "@/security/demoPersonas";

export function AppShell({
  children,
  menu,
  currentWorkerId,
  roleLabel,
  demoOptions,
  proxyEligible,
}: {
  children: React.ReactNode;
  menu: VisibleNavItem[];
  currentWorkerId: string;
  roleLabel: string;
  demoOptions: DemoPersonaOption[];
  proxyEligible: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes (e.g. tapping a nav link).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 md:static md:translate-x-0",
          mobileOpen && "translate-x-0"
        )}
      >
        <Sidebar menu={menu} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          onOpenMenu={() => setMobileOpen(true)}
          currentWorkerId={currentWorkerId}
          roleLabel={roleLabel}
          demoOptions={demoOptions}
          proxyEligible={proxyEligible}
        />
        <ProxyBanner />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-6 outline-none">
          <div key={pathname} className="animate-fade-in-up">{children}</div>
        </main>
      </div>
    </div>
  );
}
