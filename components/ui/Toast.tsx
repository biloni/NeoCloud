"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  leaving?: boolean;
}

type ToastInput = string | { title: string; description?: string; durationMs?: number };

interface ToastApi {
  success: (input: ToastInput) => void;
  error: (input: ToastInput) => void;
  warning: (input: ToastInput) => void;
  info: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof CheckCircle2; border: string; iconColor: string }> = {
  success: { icon: CheckCircle2, border: "border-l-success", iconColor: "text-success" },
  error: { icon: XCircle, border: "border-l-destructive", iconColor: "text-destructive" },
  warning: { icon: AlertTriangle, border: "border-l-warning", iconColor: "text-warning" },
  info: { icon: Info, border: "border-l-accent", iconColor: "text-accent" },
};

const DEFAULT_DURATION_MS = 5000;
const EXIT_ANIMATION_MS = 180;

/**
 * App-wide toast notifications. A single provider owns the stack (no
 * per-feature toast state); components call useToast() and never touch
 * timers or DOM positioning themselves. Errors default to a longer
 * on-screen time since they're more likely to need reading twice.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), EXIT_ANIMATION_MS);
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (variant: ToastVariant, input: ToastInput) => {
      const normalized = typeof input === "string" ? { title: input } : input;
      const id = nextId.current++;
      const duration = normalized.durationMs ?? (variant === "error" ? DEFAULT_DURATION_MS * 1.6 : DEFAULT_DURATION_MS);
      setToasts((t) => [...t, { id, variant, title: normalized.title, description: normalized.description }]);
      timers.current.set(id, setTimeout(() => remove(id), duration));
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (input) => push("success", input),
      error: (input) => push("error", input),
      warning: (input) => push("warning", input),
      info: (input) => push("info", input),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => {
          const style = VARIANT_STYLE[t.variant];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              role={t.variant === "error" ? "alert" : "status"}
              className={cn(
                "card pointer-events-auto flex items-start gap-2.5 border-l-4 p-3 shadow-popover",
                style.border,
                t.leaving ? "animate-fade-in opacity-0 transition-opacity duration-150" : "animate-slide-in-right"
              )}
            >
              <Icon size={18} className={cn("mt-0.5 shrink-0", style.iconColor)} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                {t.description && <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>}
              </div>
              <button
                onClick={() => remove(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within <ToastProvider>");
  return ctx;
}
