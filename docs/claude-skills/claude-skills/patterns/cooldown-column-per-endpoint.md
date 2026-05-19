# Pattern: One Cooldown Column Per Vendor Endpoint

## Summary

**Every vendor endpoint gets its own `last_X_fetch_at` column. Never share cooldown columns across crons.**

A column named `last_details_fetch_at` tracks ONE thing: the last time we attempted `GetOrderDetails` for this order. It does not also mean "the last time we tried any vendor call." If you want to track another endpoint's attempts, add `last_contacts_fetch_at`, `last_prelim_fetch_at`, etc.

## When this applies

Anytime two different cron jobs call two different vendor endpoints and need to track per-record attempt times.

## The Incident (May 19, 2026)

We hit this bug in production:

1. We built `softpro.enrich_order_details` cron — uses `last_details_fetch_at` to track GetOrderDetails attempts
2. We later added client resolution to `softpro.enrich_orders` cron, which calls GetOrderContacts. Builder reused the same `last_details_fetch_at` column for cooldown.
3. The two crons run within seconds of each other. enrich_orders stamps `last_details_fetch_at` at 18:15:40. enrich_order_details runs at 18:15:49, sees the order already has a recent stamp, and skips it.
4. The order's address never gets populated because `enrich_order_details` never gets to actually call SoftPro for it.
5. From the outside, this looked like: `last_details_fetch_at` is populated, so we tried — but no vendor_api_log entries existed for those order numbers.

The Director caught it by querying for orders where `last_details_fetch_at` was stamped but no corresponding `get_order_details` log row existed.

## The Fix

Split the column. Each endpoint gets its own:

```sql
ALTER TABLE orders ADD COLUMN last_contacts_fetch_at timestamp;

-- Preserve historical data
UPDATE orders
SET last_contacts_fetch_at = last_details_fetch_at
WHERE source = 'softpro_sync'
  AND last_details_fetch_at IS NOT NULL;

-- Reset orders that should still get enrich_order_details
UPDATE orders
SET last_details_fetch_at = NULL
WHERE source = 'softpro_sync'
  AND operational_status IN ('open', 'in_process', 'completed')
  AND (
    NOT EXISTS (SELECT 1 FROM order_properties WHERE order_id = orders.id AND address IS NOT NULL)
    OR sales_rep_id IS NULL
  );
```

Then update the handlers:
- `enrich-orders.ts` (GetOrderContacts) → uses `last_contacts_fetch_at`
- `enrich-order-details.ts` (GetOrderDetails) → uses `last_details_fetch_at`

## The Naming Convention

```
last_<endpoint>_fetch_at
```

Where `<endpoint>` is the SoftPro/vendor method name in snake_case:

| Cron | Endpoint | Column |
|------|----------|--------|
| softpro.enrich_order_details | GetOrderDetails | last_details_fetch_at |
| softpro.enrich_orders | GetOrderContacts | last_contacts_fetch_at |
| softpro.fetch_prelims | GetAttachedDocumentsPrelim | last_prelim_fetch_at |
| (future) fetch_fees | GetFees | last_fees_fetch_at |
| (future) fetch_policies | GetAttachedDocumentsPolicy | last_policy_fetch_at |

## Why This Matters

Two reasons:

1. **Independence.** Each endpoint has its own reliability characteristics. GetOrderDetails might be flaky while GetOrderContacts works fine. Their cooldowns shouldn't influence each other.

2. **Forensic debugging.** When something goes wrong, the Director needs to know "did the GetOrderDetails cron actually try this order?" If both crons share a column, you can't tell from the data alone.

## Detection (greps to find anti-patterns)

When reviewing a new cron handler, check whether it stamps a column already used by another cron:

```bash
# Find all the last_*_fetch_at writes
grep -rn "lastDetailsFetchAt\|lastContactsFetchAt\|lastPrelimFetchAt" \
  src/lib/jobs/handlers/

# If a single column is written by multiple handlers — that's the bug.
```

## Anti-patterns

### Anti-pattern: One column for "any vendor attempt"

```typescript
// ❌ DON'T — every cron stamps this, no way to tell which attempted what
lastVendorFetchAt: timestamp('last_vendor_fetch_at'),
```

### Anti-pattern: Reusing an existing column for a new endpoint

```typescript
// ❌ DON'T — this overloaded last_details_fetch_at and caused the May 19 bug
// enrich-orders.ts (the GetOrderContacts handler) — WRONG
await db.update(orders).set({ 
  lastDetailsFetchAt: sql`NOW()` 
}).where(...);
```

### Anti-pattern: One column for "any sync attempt"

```typescript
// ❌ DON'T — even tighter overloading
syncAttemptedAt: timestamp('sync_attempted_at'),
```

## Pattern Recap

```typescript
// ✓ DO — each cron has its own column
// enrich-orders.ts (GetOrderContacts)
.set({ lastContactsFetchAt: sql`NOW()` })

// enrich-order-details.ts (GetOrderDetails)
.set({ lastDetailsFetchAt: sql`NOW()` })

// fetch-prelims.ts (GetAttachedDocumentsPrelim)
.set({ lastPrelimFetchAt: sql`NOW()` })
```

## Cross-references

- `/docs/claude-skills/patterns/backlog-aware-crons.md`
- `/docs/claude-skills/agents/api-specialist.md`
- `/docs/claude-skills/agents/reviewer.md`
