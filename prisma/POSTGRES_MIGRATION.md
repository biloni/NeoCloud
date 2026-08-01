# Swapping local SQLite for Supabase Postgres

Local dev uses SQLite so the app runs with zero external accounts. When a
Supabase project exists, do this to move to Postgres for deployment:

1. In `prisma/schema.prisma`, change the datasource block:

   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")   // Supabase pooler (pgbouncer) URL
     directUrl = env("DIRECT_URL")     // Supabase direct connection, for migrations
   }
   ```

2. Convert the string-typed "enum" columns back to native Postgres enums
   (optional but recommended — the app works either way since all writes go
   through the zod schemas in `lib/enums.ts`). Fields to convert:
   `Worker.status`, `JobProfile.track`, `Position.status`, `WorkerEvent.type`,
   `BpStep.assigneeRule`, `BpInstance.status`, `BpStepInstance.action`.

3. Convert `String`-as-JSON columns to native `Json`: `WorkerEvent.payload`,
   `BpInstance.proposedChange`, `Scenario.assumptions`. Drop the
   `JSON.parse`/`JSON.stringify` calls in `lib/` once this is done (Prisma
   returns/accepts objects directly for `Json` columns).

4. Set `DATABASE_URL` and `DIRECT_URL` in Vercel's environment variables to
   the Supabase connection strings (Settings → Database → Connection string,
   both "Transaction" pooler and "Session"/direct variants).

5. Run `npx prisma migrate dev --name init` against the Supabase DB to create
   the migration history (SQLite dev used `db push`, which doesn't produce
   migration files — Postgres deployment should use real migrations).

6. Re-run the seed script (`npm run db:seed`) against the new database.

No application code outside `schema.prisma` and the two `JSON.parse`/
`JSON.stringify` call sites needs to change — `lib/snapshot.ts`,
`lib/payroll.ts`, and `lib/bp-engine.ts` are written against the Prisma
client's generated types either way.
