// Cookie name constants shared between the client persona switcher
// (lib/persona.ts, "use client") and server components/route handlers that
// read the acting persona (e.g. app/processes/page.tsx). Deliberately kept
// in a plain module with no "use client" directive: importing a named
// export from a client-directive file into a Server Component replaces it
// with an opaque client-reference object, not its real value — these two
// string constants must live outside that boundary to be usable server-side.
export const PERSONA_COOKIE = "peopleos_persona";
export const WORKER_COOKIE = "peopleos_worker";
// Proxy target ("acting as") — see security/proxy.ts and
// security/ProxyContext.tsx. Kept alongside the above for the same reason:
// a plain, non-"use client" module usable from both sides of the boundary.
export const PROXY_WORKER_COOKIE = "peopleos_proxy_worker";
