# Watch-Out: Enum Migrations Need Manual SQL

## The Trap

Postgres `ALTER TYPE ADD VALUE` cannot run inside a transaction. Most migration runners (including Drizzle's) wrap migrations in transactions. So enum value additions silently DON'T get applied.

You commit the migration file. The migration runner says "success." The enum is unchanged in production. Any code that tries to use the new value fails with `invalid input value for enum`.

## Real Incident

On 2026-05-19 we tried to seed an `escrow_assistant` test user:

```sql
INSERT INTO profiles (id, email, role, ...)
VALUES (..., 'escrow_assistant', ...);
```

Result: 

```
ERROR: invalid input value for enum profile_role: "escrow_assistant"
```

We checked production:

```sql
SELECT unnest(enum_range(NULL::profile_role));
```

Returns: super_admin, admin, cs_admin, sales_manager, sales_rep, title_officer, escrow_officer, open_order_team, client, title_production.

No `escrow_assistant`.

But the migration file `0008_swift_dust.sql` had been committed weeks earlier with:

```sql
ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
```

The migration runner had reported success. But the enum value wasn't there. Postgres silently fails this operation when wrapped in a transaction.

Meanwhile, all the escrow_assistant code we'd been shipping:
- Hub role-gated UI for escrow_assistant
- canAccessOrder for escrow_assistant orders
- /api/escrow/tasks scoped for escrow_assistant
- DetailModal tabs for escrow_assistant

...had been technically deployed but never actually exercisable, because no profile row could have that role.

## The Fix

For ANY `ALTER TYPE ... ADD VALUE` migration, the Director must run it MANUALLY in Supabase SQL editor (outside any transaction):

```sql
ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
```

Then verify:

```sql
SELECT unnest(enum_range(NULL::profile_role)) AS role;
```

The new value should appear in the list.

## What Postgres Documentation Says

From the Postgres docs:

> ALTER TYPE ... ADD VALUE (the form that adds a new value to an enum type) cannot be executed inside a transaction block.

This is a fundamental Postgres constraint. No migration runner can work around it without manually committing the transaction first — which most migration runners don't do.

## Detection Patterns

When writing a migration that includes `ALTER TYPE ADD VALUE`, the Builder must:

1. **Generate the migration file** as normal
2. **Add a comment at the top of the migration file**:

```sql
-- WARNING: ALTER TYPE ADD VALUE cannot run in a transaction.
-- This migration WILL fail silently in automated runners.
-- Director must run the ALTER TYPE statement MANUALLY in 
-- Supabase SQL editor.

ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
```

3. **In the agent report**, explicitly list this as a "Director SQL action required":

```
Director SQL action (CRITICAL):
Run this in Supabase SQL editor BEFORE the next deploy completes:
  ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';

Verify with:
  SELECT unnest(enum_range(NULL::profile_role));
```

4. **The Director** must run the SQL before testing any code that depends on the new enum value.

## Detection Audit

If you suspect an enum migration didn't apply, run:

```sql
-- List all enum types and their values
SELECT 
  t.typname as enum_name,
  array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
GROUP BY t.typname
ORDER BY t.typname;
```

Compare to what the schema files declare. Discrepancies indicate missed manual migrations.

## Other Operations With This Constraint

`ALTER TYPE ADD VALUE` is the most common case, but Postgres has other operations that don't allow transactions:

- `CREATE INDEX CONCURRENTLY`
- `ALTER TYPE ... RENAME VALUE` (in some Postgres versions)
- `VACUUM` (rarely in migrations, but possible)

For any of these, follow the same pattern: flag as manual, document for the Director, verify after running.

## The Process

Standard workflow when an enum value needs to be added:

1. **Builder** updates the Drizzle schema:
   ```typescript
   export const profileRoleEnum = pgEnum('profile_role', [
     'super_admin', 'admin', 'cs_admin', 'sales_manager', 'sales_rep',
     'title_officer', 'escrow_officer', 'escrow_assistant',  // NEW
     'open_order_team', 'client', 'title_production',
   ]);
   ```

2. **Builder** generates the migration:
   ```sql
   ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
   ```

3. **Builder** adds the warning comment and reports to Director:
   > "Director must run this manually in Supabase SQL editor before the new enum value is usable."

4. **Director** runs the SQL in Supabase:
   ```sql
   ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
   ```

5. **Director** verifies:
   ```sql
   SELECT unnest(enum_range(NULL::profile_role));
   ```

6. **Director** confirms enum value present, then deploys code.

## When To Catch This Early

If code references an enum value that doesn't exist in production, the first failure surfaces as:

- INSERT with the value → `invalid input value for enum X: "..."`
- UPDATE setting the value → same error
- Function expecting the value → same error
- Type check at runtime → same error

If you see this error pattern after a deploy, immediately suspect the migration was skipped. Check production enum values before assuming a code bug.

## Historical Incident Summary

**Discovered:** 2026-05-19 when seeding the first `escrow_assistant` test user  
**Migration:** `0008_swift_dust.sql` (committed weeks earlier)  
**Symptom:** `INSERT INTO profiles ... 'escrow_assistant' ...` returned enum invalid error  
**Root cause:** `ALTER TYPE ADD VALUE` had been silently failing in the migration runner since the migration was first committed  
**Fix:** Director ran the ALTER TYPE manually in Supabase SQL editor  
**Lesson:** Every enum migration needs explicit manual handling

## Reference Files

- `src/lib/db/migrations/0008_swift_dust.sql` — the migration that needed manual application
- Postgres docs: https://www.postgresql.org/docs/current/sql-altertype.html
