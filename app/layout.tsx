import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PersonaProvider } from "@/components/PersonaProvider";
import { ProxyProvider } from "@/components/ProxyProvider";
import { getAuthContext } from "@/lib/auth-context";
import { getVisibleMenu } from "@/security/menuVisibility";
import { getDemoPersonaOptions } from "@/security/demoPersonas";
import { canProxy, effectiveWorkerId, effectiveRoles } from "@/security/authorization";
import { ROLE_METADATA } from "@/security/roles";

export const metadata: Metadata = {
  title: "NeoCloud People OS",
  description: "People operations & workforce planning — take-home exercise",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  const menu = getVisibleMenu(ctx);
  const demoOptions = await getDemoPersonaOptions();
  const roles = effectiveRoles(ctx);
  const roleLabel = roles.map((r) => ROLE_METADATA[r].label).join(" + ") || "Employee";

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <PersonaProvider>
          <ProxyProvider>
            <AppShell
              menu={menu}
              currentWorkerId={effectiveWorkerId(ctx)}
              roleLabel={roleLabel}
              demoOptions={demoOptions}
              proxyEligible={canProxy(ctx)}
            >
              {children}
            </AppShell>
          </ProxyProvider>
        </PersonaProvider>
      </body>
    </html>
  );
}
