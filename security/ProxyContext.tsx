/**
 * React Context for proxy ("act as") state — the client-side half of the
 * proxy feature. Server eligibility/audit logic lives in proxy.ts; this
 * file only tracks "who am I currently proxying, if anyone" and persists
 * it to a cookie so Server Components can read it too (same pattern as
 * lib/persona.ts's existing PersonaContext).
 */
"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PROXY_WORKER_COOKIE } from "@/lib/persona-constants";
import { startProxyAction, endProxyAction } from "@/lib/actions";

interface ProxyState {
  proxyWorkerId: string | null;
  proxyWorkerName: string | null;
  isProxying: boolean;
  /** Attempts to start a proxy session; returns an error message on failure, or null on success. */
  startProxy: (workerId: string, workerName: string) => Promise<string | null>;
  exitProxy: () => Promise<void>;
}

export const ProxyContext = createContext<ProxyState | null>(null);

export function useProxy(): ProxyState {
  const ctx = useContext(ProxyContext);
  if (!ctx) throw new Error("useProxy must be used within ProxyProvider");
  return ctx;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=86400; samesite=lax`;
}
function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

export function useProxyState(): ProxyState {
  const [proxyWorkerId, setProxyWorkerId] = useState<string | null>(null);
  const [proxyWorkerName, setProxyWorkerName] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const id = readCookie(PROXY_WORKER_COOKIE);
    if (id) setProxyWorkerId(id);
    // Name isn't persisted in the cookie (keep it small); re-derive on reload via a fresh proxy start is
    // overkill for a page refresh, so we fall back to showing the id until the user picks again.
  }, []);

  const startProxy = useCallback(async (workerId: string, workerName: string): Promise<string | null> => {
    const result = await startProxyAction(workerId);
    if (!result.allowed) return result.reason ?? "Proxy request denied";
    setProxyWorkerId(workerId);
    setProxyWorkerName(workerName);
    writeCookie(PROXY_WORKER_COOKIE, workerId);
    router.refresh();
    return null;
  }, [router]);

  const exitProxy = useCallback(async () => {
    if (!proxyWorkerId) return;
    await endProxyAction(proxyWorkerId);
    setProxyWorkerId(null);
    setProxyWorkerName(null);
    clearCookie(PROXY_WORKER_COOKIE);
    router.refresh();
  }, [proxyWorkerId, router]);

  return { proxyWorkerId, proxyWorkerName, isProxying: proxyWorkerId !== null, startProxy, exitProxy };
}
