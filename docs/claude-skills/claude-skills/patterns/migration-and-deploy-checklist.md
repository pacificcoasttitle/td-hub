# Pattern: Migration and Deploy Checklist

## Summary

Schema changes require a specific sequence. Skipping or reordering breaks production.

## The sequence

1. **Code change with schema update**
2. **Code commit and push**
3. **Verify Vercel deploys successfully**
4. **Run production SQL migration manually (Director, in Supabase)**
5. **Verify schema state**
6. **Trigger / wait for code paths that use the new schema**
7. **Verify expected outcome**

## Why manual SQL (not auto-migration)

Some migrations CANNOT be auto-applied by Drizzle/migration runners:

### Enum value additions
```sql
ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
```
**Postgres requires this OUTSIDE a transaction.** Migration runners wrap everything in transactions. The Director must run this manually in Supabase SQL editor.

### Adding NOT NULL columns without defaults
Will fail on tables with existing rows. Must add as nullable first, backfill, then alter to NOT NULL.

### Renaming or dropping columns with active code references
Code must be deployed BEFORE the column drop, or queries crash mid-deploy.

## The Director's checklist for every schema change

### Before committing code

- [ ] Schema TypeScript file updated (`src/lib/db/schema/**`)
- [ ] Migration file generated (Drizzle generates this, OR Builder writes it manually for cases like enum ADD VALUE)
- [ ] Production SQL documented in the ticket completion report

### After commit and push

- [ ] Vercel deploy status: Ready
- [ ] No build errors in Vercel logs
- [ ] Test the code path that uses the new column WITHOUT the column existing — should fail gracefully or skip, not crash

### Run production SQL (in Supabase SQL editor)

For each change, run separately and verify:

```sql
-- Add column
ALTER TABLE orders ADD COLUMN last_X_fetch_at timestamp;

-- Verify
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' AND column_name = 'last_X_fetch_at';
```

### After SQL runs

- [ ] Schema verified
- [ ] Wait for next cron tick OR trigger backfill manually
- [ ] Verify expected behavior (rows being populated, queries returning data, etc.)
- [ ] Check vendor_api_logs and jobs table for errors

## Migration types and their gotchas

### Adding a nullable column
Safest. No data backfill required. Can be done anytime.

```sql
ALTER TABLE orders ADD COLUMN last_X_fetch_at timestamp;
```

### Adding a NOT NULL column with default
Safe if default is valid for all existing rows.

```sql
ALTER TABLE orders ADD COLUMN sync_attempts integer NOT NULL DEFAULT 0;
```

### Adding a NOT NULL column without default
**Will fail** if table has existing rows. Three-step process:
1. Add nullable
2. Backfill with UPDATE
3. ALTER to NOT NULL

### Adding a foreign key
Safe if all existing values are valid foreign keys, or column is nullable.

```sql
ALTER TABLE orders ADD COLUMN client_contact_id integer REFERENCES contacts(id);
```

### Adding an enum value
**Postgres-specific gotcha.** Must run OUTSIDE a transaction:

```sql
-- This is what Drizzle migration files contain
ALTER TYPE "public"."profile_role" ADD VALUE 'escrow_assistant' BEFORE 'title_production';
```

**The Director must run this manually in Supabase SQL editor.** Drizzle's migration runner wraps every migration in a transaction, which causes this statement to fail.

If you see code that depends on a new enum value and the database hasn't been updated, queries will fail with:

```
invalid input value for enum profile_role: 'escrow_assistant'
```

### Dropping a column
**Most dangerous.** Two-step deploy:
1. Deploy code that doesn't reference the column
2. Verify no errors
3. Then drop the column

### Renaming a column
**Equivalent to drop + add.** Add new column, backfill, deploy code reading new, then drop old. Don't rename directly.

## The incident (May 19, 2026)

We shipped `escrow_assistant` role code weeks before the production enum was updated. Every code path checking `role === 'escrow_assistant'` was technically deployed but never executable. When we finally tried to insert the test profile, it failed:

```
ERROR: invalid input value for enum profile_role: "escrow_assistant"
```

We had to apply the enum ALTER manually before the test user could be created.

**Lesson:** When a schema change requires manual SQL (enum additions, multi-step migrations), the agent ticket should call this out explicitly. The Reviewer should verify before sign-off.

## What to put in completion reports

When a ticket includes a schema change:

```
DIRECTOR ACTION REQUIRED:

Run in Supabase SQL editor:

  ALTER TABLE orders ADD COLUMN last_details_fetch_at timestamp;

Verify with:

  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'orders' AND column_name = 'last_details_fetch_at';
```

Make it copy-paste ready. The Director shouldn't have to re-read the ticket to find the SQL.

## Anti-patterns

### Anti-pattern: Code merge before schema

Deploying code that uses a new column before the column exists. Causes 500 errors immediately on deploy.

### Anti-pattern: Schema before code

Adding a column to a table without code that uses it. Not actively harmful, but creates "stale schema" which makes future investigations confusing.

### Anti-pattern: Multiple migrations bundled

Combining schema changes that should deploy at different times. Each schema change should be its own ticket so each can have its own deploy sequence.

### Anti-pattern: "Migration ran" without verification

Always verify schema state in the SQL editor after running the migration. Don't trust "Query completed."

## Cross-references

- `/docs/claude-skills/agents/director.md`
- `/docs/claude-skills/agents/gopher.md`
- `/docs/claude-skills/agents/reviewer.md`
- `/docs/claude-skills/watch-outs/enum-migrations-need-manual-sql.md`
