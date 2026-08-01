"use client";
import { ProxyContext, useProxyState } from "@/security/ProxyContext";

export function ProxyProvider({ children }: { children: React.ReactNode }) {
  const state = useProxyState();
  return <ProxyContext.Provider value={state}>{children}</ProxyContext.Provider>;
}
