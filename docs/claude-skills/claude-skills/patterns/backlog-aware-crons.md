# Pattern: Backlog-Aware Crons

## Summary

For any cron that calls an external vendor API:
- **Per-order calls** (not date-range)
- **ORDER BY a `last_X_fetch_at` column** with NULLS FIRST (never-attempted prioritized)
- **6-hour cooldown** after a failed attempt
- **BATCH_SIZE 50** unless there's a reason for different
- **TIME_BUDGET_MS = 240_000** in-loop guard with `maxDuration = 300` on the route
- **Stamp the column BEFORE the vendor call** (failure-tolerant)
- **Throw if 100% of attempts failed** (so the job runner marks the job failed)

## When to use this pattern

Every cron that processes data via vendor API calls.

Examples in TD Hub:
- `softpro.fetch_prelims` (GetAttachedDocumentsPrelim)
- `softpro.enrich_order_details` (GetOrderDetails per-order)
- `softpro.enrich_orders` (GetOrderContacts per-order — uses last_contacts_fetch_at)
- Admin backfill routes (same logic, manual trigger)

## Why this pattern

We learned the hard way (May 18, 2026 enrichment incident) that:

1. **Date-range vendor calls time out at 120s and silently fail.** The legacy PHP system used date-range calls; it stopped working without anyone noticing because the dashboard said "completed."
2. **Per-order calls are reliable.** The escrow officer backfill route proved this — per-order calls succeeded 100% of the time while date-range timed out.
3. **Without cooldown, the same orders get retried every 15 minutes** wasting vendor API budget and never catching new orders.
4. **Without ORDER BY NULLS FIRST, brand-new orders never get processed** because they sit at the back of the queue indefinitely.
5. **Without "stamp before call" and "throw on total failure," failures are invisible.**

## The pattern — step by step

### Step 1: Schema column per endpoint

```sql
ALTER TABLE orders ADD COLUMN last_X_fetch_at timestamp;
```

Replace `X` with the endpoint name: `details`, `contacts`, `prelim`, `fees`, etc.

**Every endpoint gets its own column.** See `cooldown-column-per-endpoint.md`.

### Step 2: Drizzle schema

```typescript
// src/lib/db/schema/orders.ts
lastDetailsFetchAt: timestamp('last_details_fetch_at'),
```

### Step 3: The handler

```typescript
// src/lib/jobs/handlers/enrich-order-details.ts

export const maxDuration = 300; // 5 min on the route entry

const BATCH_SIZE = 50;
const TIME_BUDGET_MS = 240_000; // 4 min in-loop budget
const COOLDOWN_HOURS = 6;

export async function handleEnrichOrderDetails(): Promise<EnrichOrderDetailsResult> {
  const startTime = Date.now();
  const stats = {
    eligible: 0,
    attempted: 0,
    enriched: 0,
    errors: [] as Array<{orderId: number; error: string}>,
    timedOut: false,
  };

  // Find candidates with eligibility AND cooldown
  const candidates = await db
    .selectDistinct({
      id: orders.id,
      fileNumber: orders.fileNumber,
    })
    .from(orders)
    .leftJoin(orderProperties, eq(orderProperties.orderId, orders.id))
    .where(and(
      eq(orders.source, 'softpro_sync'),
      sql`${orders.operationalStatus} in ('open', 'in_process', 'completed')`,
      // Eligibility: missing some required field
      or(
        isNull(orderProperties.address),
        isNull(orders.salesRepId),
        isNull(orders.titleOfficerId),
      ),
      // Cooldown: never attempted OR > 6 hours since last attempt
      or(
        isNull(orders.lastDetailsFetchAt),
        sql`${orders.lastDetailsFetchAt} < NOW() - INTERVAL '6 hours'`,
      ),
    ))
    .orderBy(asc(orders.lastDetailsFetchAt))  // NULLS FIRST is default for asc
    .limit(BATCH_SIZE);

  stats.eligible = candidates.length;

  for (const order of candidates) {
    // Time budget check
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      stats.timedOut = true;
      break;
    }

    stats.attempted++;

    // Stamp BEFORE the call — failure-tolerant cooldown
    await db.update(orders)
      .set({ lastDetailsFetchAt: sql`NOW()` })
      .where(eq(orders.id, order.id));

    try {
      const result = await getOrderDetails({ orderNumber: order.fileNumber });

      if (!result.success || !result.data || result.data.length === 0) {
        stats.errors.push({
          orderId: order.id,
          error: result.error?.message ?? 'No data returned',
        });
        continue;
      }

      await processOrderDetail(result.data[0]);
      stats.enriched++;
    } catch (err) {
      stats.errors.push({
        orderId: order.id,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // Throw on total failure — surfaces in Operations Command Center
  if (stats.attempted > 0 && stats.enriched === 0 && stats.errors.length === stats.attempted) {
    throw new Error(
      `enrich_order_details: ${stats.attempted} attempts, 0 successes — vendor likely unreachable`
    );
  }

  return stats;
}
```

### Step 4: Register the cron

```json
// vercel.json
{
  "path": "/api/jobs/run?name=softpro.enrich_order_details",
  "schedule": "*/15 * * * *"
}
```

```typescript
// src/app/api/jobs/run/route.ts
const JOB_HANDLERS = {
  'softpro.enrich_order_details': handleEnrichOrderDetails,
  // ... others
};
```

```typescript
// src/app/api/admin/ops/crons/route.ts (for Operations Command Center labels)
'softpro.enrich_order_details': 'Every 15min',
```

### Step 5: Companion admin backfill route

Always pair the cron with an admin route for manual draining:

```typescript
// src/app/api/admin/backfill/order-details/route.ts
// Same logic, but:
// - Manual trigger only (POST)
// - Ignores cooldown (it's a one-time push)
// - Auth: super_admin, admin, cs_admin
// - Time budget guard same
// - Returns { eligible, attempted, enriched, errors, timedOut }
```

The Director runs the backfill from the browser console:

```javascript
async function drain() {
  let total = 0;
  while (true) {
    const r = await fetch('/api/admin/backfill/order-details?limit=50', { method: 'POST' });
    const data = await r.json();
    console.log(data);
    total += data.enriched ?? 0;
    if ((data.eligible ?? 0) < 50) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`Done: ${total} enriched`);
}
drain();
```

## Anti-patterns (what NOT to do)

### Anti-pattern 1: Date-range calls

```typescript
// ❌ DON'T — times out at 120s, fails silently
const result = await getOrderDetails({ 
  dateFrom: '2026-05-19', 
  dateTo: '2026-05-19' 
});
```

### Anti-pattern 2: No ORDER BY

```typescript
// ❌ DON'T — same orders get processed repeatedly, new ones never reached
.limit(50)
// No orderBy
```

### Anti-pattern 3: Cooldown only on success

```typescript
// ❌ DON'T — failed attempts immediately retry every 15 min
if (success) {
  await db.update(orders).set({ lastFetchAt: sql`NOW()` })...
}
```

The cooldown must stamp on EVERY attempt (success or failure). Otherwise stuck files re-poll every tick.

### Anti-pattern 4: Returning errors instead of throwing

```typescript
// ❌ DON'T — job runner marks it "completed" even though nothing worked
if (allFailed) {
  return { error: 'all failed' };
}
```

```typescript
// ✓ DO — job runner correctly marks "failed"
if (stats.attempted > 0 && stats.enriched === 0) {
  throw new Error('total failure');
}
```

### Anti-pattern 5: Sharing cooldown columns

See `cooldown-column-per-endpoint.md`. Every vendor endpoint gets its own column.

## Detection (greps to find anti-patterns)

```bash
# Find date-range vendor calls (likely broken)
grep -rn "dateFrom.*dateTo" src/lib/jobs/handlers/

# Find jobs without time budget guards
grep -L "TIME_BUDGET_MS" src/lib/jobs/handlers/

# Find vendor handlers that don't throw on total failure
grep -L "throw new Error" src/lib/jobs/handlers/
```

## Real incidents this pattern fixed

- **2026-05-18 enrichment outage** — 69 orders unenriched for 21 hours because import-orders date-range cron timed out silently. Replaced with softpro.enrich_order_details using this pattern.
- **fetch-prelims initial implementation** — first usage of this pattern. Proven reliable since.
- **Escrow officer backfill** — admin route version of this pattern. 285 orders assigned, 0 unmatched.

## Cross-references

- `/docs/claude-skills/patterns/cooldown-column-per-endpoint.md`
- `/docs/claude-skills/patterns/softpro-integration-rules.md`
- `/docs/claude-skills/watch-outs/silent-job-failures.md`
- `/docs/claude-skills/watch-outs/softpro-data-latency.md`
