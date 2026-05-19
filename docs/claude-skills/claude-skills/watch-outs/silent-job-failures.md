# Watch-Out: Silent Job Failures

## The Trap

A cron job handler returns an error object instead of throwing. The job runner sees a "successful" return and marks the job COMPLETED. Production dashboards show all green while the actual work is failing silently.

This is the root cause behind weeks of unenriched orders going unnoticed.

## Real Incident

Before 2026-05-19, the `import-orders` cron was running every 6 hours. Every run, it called `GetOrderDetails` with a date range. SoftPro consistently timed out at 120s on date-range queries.

The handler code looked like this (paraphrased):

```typescript
// BROKEN PATTERN
export async function importOrdersFromSoftPro({ dateFrom, dateTo }) {
  try {
    const result = await getOrderDetails({ dateFrom, dateTo });
    if (!result.success) {
      return { 
        success: false, 
        error: result.error?.message ?? 'Unknown'
      };
    }
    // ... process orders ...
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown'
    };
  }
}
```

The job runner:

```typescript
// Job execution loop (simplified)
try {
  await handler(payload);
  await markJobCompleted(jobId);  // <-- this ran even on returned errors
} catch (err) {
  await markJobFailed(jobId, err);
}
```

Because the handler RETURNED an error object instead of THROWING, the try/catch never fired. The job was marked COMPLETED. Dashboards showed all green.

Meanwhile:
- The Operations Command Center showed `import-orders` running every 6 hours, all completing successfully
- vendor_api_logs showed timeouts and 0 successful calls
- 161 orders accumulated unenriched
- No alerts fired
- Nobody noticed for weeks

## The Fix

**Throw on failure. Don't return errors.**

```typescript
// CORRECT PATTERN
export async function importOrdersFromSoftPro({ dateFrom, dateTo }) {
  const result = await getOrderDetails({ dateFrom, dateTo });
  
  if (!result.success) {
    throw new Error(
      `import_orders: SoftPro returned error: ${result.error?.message}`
    );
  }
  
  // ... process orders ...
  
  // After the loop, if everything failed:
  if (stats.attempted > 0 && stats.processed === 0) {
    throw new Error(
      `import_orders: ${stats.attempted} attempts, 0 successes`
    );
  }
  
  return stats;
}
```

## When To Throw

### Always throw

- Vendor unreachable (network error, timeout)
- All vendor calls in the batch failed
- Database write fails
- Required input is missing
- Schema mismatch detected at runtime

### Never throw (handle gracefully)

- Individual record had bad data — log and continue
- Vendor returned empty result for one specific record — log and continue
- Time budget exceeded — break out of loop, return stats with `timedOut: true`

The principle: a cron should THROW when it can't make ANY progress, but should HANDLE individual record failures within a batch.

## The "Total Failure" Throw

For batch handlers, this is the canonical check at the end of the loop:

```typescript
// Inside handler, after the loop:
if (stats.attempted > 0 && stats.enriched === 0 && stats.errors.length === stats.attempted) {
  throw new Error(
    `enrich_order_details: ${stats.attempted} attempts, 0 successes — vendor likely unreachable`
  );
}
```

This catches the silent-failure case while still allowing individual record errors to accumulate in `stats.errors`.

## Detection

Grep pattern to find this anti-pattern in the codebase:

```bash
# Find handlers that return success: false
grep -rn "return.*success.*false\|return.*{.*error" src/lib/jobs/handlers/

# Find handlers wrapping the entire body in try/catch that swallow errors
grep -B 2 -A 10 "} catch" src/lib/jobs/handlers/
```

For each match, ask:

1. Does this catch return an error object instead of rethrowing?
2. If yes, is the job runner expecting it to throw?
3. If yes, this is the silent-failure pattern.

## Operations Command Center Visibility

The Operations Command Center at `/admin/ops` shows jobs by status. A silent-failure job shows as "completed" with `null` in the error column.

To detect silent failures, also check:

- **Job duration:** If a job that should take 2 minutes finished in 0 seconds, suspicious
- **Vendor API logs:** If the job ran but vendor_api_logs shows 0 calls, suspicious
- **Output stats:** If `processed: 0` after `attempted: 50`, the job should have thrown

Reviewer should look for these patterns when investigating "things look fine but data isn't moving."

## How To Audit Existing Crons

Run through every cron handler in `src/lib/jobs/handlers/` and verify:

- [ ] Does the catch block re-throw, or return an error object?
- [ ] Does the handler check for "0 successes after N attempts" and throw?
- [ ] Are individual record errors accumulated (not thrown)?
- [ ] Are batch-wide errors thrown (so the runner marks failed)?

If any handler swallows errors instead of throwing, fix it. The cost of one occasional false-positive failure (job marked failed when something recoverable happened) is much less than the cost of weeks of silent failures.

## Historical Incident Summary

**Discovered:** 2026-05-19 during enrichment investigation  
**Affected job:** `import-orders` (decommissioned as scheduled cron after this incident)  
**Duration of silent failure:** Multiple weeks before discovery  
**Scope:** ~161 orders went unenriched without any failed-job alert  
**Root cause:** Handler returned `{ success: false }` instead of throwing on SoftPro timeout  
**Fix:** New `softpro.enrich_order_details` cron throws on total failure. Old `import-orders` removed from cron schedule (handler retained for manual date-range runs).  
**Lesson:** Every cron handler should be auditable for this pattern.

## Reference Files

- `src/lib/jobs/handlers/enrich-order-details.ts` — correct pattern (throws on total failure)
- `src/lib/jobs/handlers/fetch-prelims.ts` — also throws correctly
- `src/lib/jobs/handlers/enrich-orders.ts` — uses pattern after split

## Related Patterns

- `patterns/backlog-aware-crons.md` — the broader cron architecture
- `patterns/cooldown-column-per-endpoint.md` — what we'd discovered IF the failures had been loud
