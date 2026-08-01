"use client";
import { useProxy } from "@/security/ProxyContext";
import { LogOut } from "lucide-react";

/** "You are acting as Jane Smith" banner + Exit Proxy — only renders while a proxy session is active. */
export function ProxyBanner() {
  const { isProxying, proxyWorkerId, proxyWorkerName, exitProxy } = useProxy();
  if (!isProxying) return null;

  return (
    <div className="flex h-9 items-center justify-center gap-3 bg-warning/15 px-4 text-xs text-warning">
      <span>
        You are acting as <span className="font-semibold">{proxyWorkerName ?? proxyWorkerId}</span>
        {proxyWorkerName && <span className="text-warning/70"> ({proxyWorkerId})</span>}
      </span>
      <button onClick={() => exitProxy()} className="flex items-center gap-1 rounded-md border border-warning/40 px-2 py-0.5 font-medium hover:bg-warning/10">
        <LogOut size={12} /> Exit proxy
      </button>
    </div>
  );
}
