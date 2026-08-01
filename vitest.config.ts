import { defineConfig } from "vitest/config";
import path from "path";

// Runs against the real seeded dev.db (prisma resolves this SQLite path
// relative to schema.prisma, not process.cwd(), so it's stable regardless
// of where `vitest` is invoked from). These are integration-style checks
// of the RBAC composition (security/authorization.ts) against real
// worker/org data from prisma/seed.ts — not mocked, since the whole point
// is verifying real reporting-chain and role-derivation behavior.
export default defineConfig({
  test: {
    environment: "node",
    env: { DATABASE_URL: "file:./dev.db" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
