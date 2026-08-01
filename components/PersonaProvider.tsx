"use client";
import { PersonaContext, usePersonaState } from "@/lib/persona";

export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const state = usePersonaState();
  return <PersonaContext.Provider value={state}>{children}</PersonaContext.Provider>;
}
