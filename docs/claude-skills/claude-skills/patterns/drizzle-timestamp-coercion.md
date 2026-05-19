# Pattern: Drizzle Timestamp Coercion

## Summary

When using Drizzle's raw `sql` template for subqueries that return timestamps, the value comes back as a STRING at runtime even though TypeScript types declare it as `Date`. Always coerce to a proper Date with a helper before any operation that requires Date methods.

## The Incident (May 19, 2026)

The `/api/escrow/tasks` endpoint crashed in production with:

```
TypeError: t.getTime is not a function
```

Root cause: `loadEscrowTaskOrderRows()` used raw SQL subqueries for three timestamp fields:

```typescript
// In a Drizzle select
{
  lastDocActivity: sql<Date | null>`(SELECT MAX(...) FROM ...)`,
  lastStatusChange: sql<Date | null>`(SELECT MAX(...) FROM ...)`,
  latestTessaCompleteAt: sql<Date | null>`(SELECT MAX(...) FROM ...)`,
}
```

TypeScript said `Date | null`. Runtime returned `"2026-03-11 20:35:15.337705"` (string).

Then this code crashed:

```typescript
if (order.lastStatusChange && hoursSince(now, order.lastStatusChange) <= 24) {
  // hoursSince calls value.getTime() — fails on string
}
```

## Why It Happens

Drizzle's typed helpers (`gte()`, `lte()`, table columns) parse PostgreSQL responses back to JavaScript types. But raw `sql` template literals are pass-through — they trust your type annotation but don't parse the value.

PostgreSQL returns timestamps as ISO strings over the wire. Drizzle's typed columns convert; raw SQL doesn't.

## The Pattern

### Step 1: Coercion helper

Place this near the boundary where raw SQL results enter your domain code:

```typescript
/**
 * Coerce a value that may be Date | string | null into Date | null.
 * Raw SQL subqueries can return ISO strings even when TypeScript 
 * declares them as Date.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}
```

### Step 2: Widen the type to match runtime reality

```typescript
type RawOrderRow = {
  id: number;
  // ... other fields ...
  // Mark raw SQL timestamps as potentially string
  lastDocActivity: Date | string | null;
  lastStatusChange: Date | string | null;
  latestTessaCompleteAt: Date | string | null;
};
```

### Step 3: Coerce at the boundary

After fetching, before passing to downstream code:

```typescript
const rawRows = await db.select({...}).from(orders).where(...);

return rawRows.map(row => ({
  ...row,
  lastDocActivity: toDate(row.lastDocActivity),
  lastStatusChange: toDate(row.lastStatusChange),
  latestTessaCompleteAt: toDate(row.latestTessaCompleteAt),
}));
```

The downstream consumer's type can stay `Date | null` — coercion handles the runtime gap.

## Where This Bug Hides

Any time you see this pattern in Drizzle code:

```typescript
.select({
  someTimestamp: sql<Date>`(SELECT MAX(some_timestamp) FROM ...)`,
})
```

Or:

```typescript
.select({
  lastSeen: sql<Date | null>`...`,
})
```

The value MIGHT come back as a string. If anything later calls `.getTime()`, `.toISOString()`, or compares timestamps with `<`/`>`, it can crash.

## Detection (greps to find at-risk code)

```bash
# Find raw SQL with Date type annotation
grep -rn "sql<Date" src/

# Find raw SQL subqueries with timestamp columns
grep -rn "MAX.*timestamp\|MAX.*_at" src/ | grep "sql"

# Find getTime() calls in domain code
grep -rn "\.getTime()" src/lib/domain/
```

## When NOT to apply this

Typed Drizzle column references DO coerce correctly:

```typescript
// ✓ This works without coercion
.select({
  createdAt: orders.createdAt,  // typed column, parsed by Drizzle
})
```

The problem is only with raw `sql` template literals.

## Long-term fix (not yet implemented)

A type-safe wrapper around `sql<Date>` that automatically applies coercion would prevent this category of bug entirely. Something like:

```typescript
function sqlDate(query: SQL): SQL<Date | null> {
  // Wrap with coercion at the result-mapping layer
}
```

Until that exists, manual coercion at boundaries is the rule.

## Real incidents

- **2026-05-19 escrow tasks endpoint crash** — TypeError: t.getTime is not a function. Fixed by adding toDate() helper in escrow-tasks-derivation.ts.

## Cross-references

- `/docs/claude-skills/agents/builder.md`
- `/docs/claude-skills/agents/reviewer.md`
