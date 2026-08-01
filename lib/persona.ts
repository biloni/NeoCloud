// Mocked RBAC: a client-side persona switcher (see CLAUDE.md "no Supabase
// Auth / no RLS — we mock RBAC in the UI with a persona switcher instead").
// Persisted in a cookie so server components/route handlers can read it too.
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { PersonaKey } from "./enums";
import { PERSONA_COOKIE, WORKER_COOKIE } from "./persona-constants";

interface PersonaState {
  persona: PersonaKey;
  workerId: string;
  setPersona: (p: PersonaKey) => void;
  setWorkerId: (id: string) => void;
}

export const PersonaContext = createContext<PersonaState | null>(null);

export function usePersona(): PersonaState {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error("usePersona must be used within PersonaProvider");
  return ctx;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function usePersonaState(): PersonaState {
  const [persona, setPersonaState] = useState<PersonaKey>("MANAGER");
  const [workerId, setWorkerIdState] = useState<string>("E0001");

  useEffect(() => {
    const p = readCookie(PERSONA_COOKIE);
    const w = readCookie(WORKER_COOKIE);
    if (p) setPersonaState(p as PersonaKey);
    if (w) setWorkerIdState(w);
  }, []);

  const setPersona = (p: PersonaKey) => {
    setPersonaState(p);
    writeCookie(PERSONA_COOKIE, p);
  };
  const setWorkerId = (id: string) => {
    setWorkerIdState(id);
    writeCookie(WORKER_COOKIE, id);
  };

  return { persona, workerId, setPersona, setWorkerId };
}
