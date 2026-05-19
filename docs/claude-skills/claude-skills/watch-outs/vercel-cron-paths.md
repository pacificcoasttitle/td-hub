# Watch-Out: Vercel Cron Paths and Registration

## The Trap

A cron job in TD Hub requires THREE things to be wired correctly:

1. **Handler function** in `src/lib/jobs/handlers/<name>.ts`
2. **Job router registration** in `src/app/api/jobs/run/route.ts` mapping the job name string to the handler
3. **Vercel cron schedule** in `vercel.json`

If any one is missing, the cron silently doesn't run. There's no error — it just never fires.

## Real incidents

Multiple incidents during the May 2026 build:

- **import-orders cron** was registered in vercel.json but the handler had been failing silently for 21 hours. Looked like the cron didn't exist; actually it was running and timing out.
- **enrich_order_details** was the replacement — required new entries in all 3 places. Easy to forget any one.

## The setup, step by step

### 1. Handler

```typescript
// src/lib/jobs/handlers/enrich-order-details.ts

export const maxDuration = 300; // 5 minutes — note: this goes on the ROUTE entry, not the handler

export async function handleEnrichOrderDetails(): Promise<EnrichOrderDetailsResult> {
  // ...
}
```

`maxDuration` matters. Vercel's free/hobby tier caps at 10s. Pro tier caps at 300s (5 min). Without this export, the function dies at 10s.

### 2. Router registration

```typescript
// src/app/api/jobs/run/route.ts

const JOB_HANDLERS = {
  'softpro.sync_recent_orders': handleSyncOrders,
  'softpro.enrich_orders': handleEnrichOrders,
  'softpro.enrich_order_details': handleEnrichOrderDetails,  // ← MUST add this
  'softpro.fetch_prelims': handleFetchPrelims,
  // ...
};

export const maxDuration = 300;  // Must match the handler's maxDuration
```

The job name string MUST exactly match what's in vercel.json. Common bugs:
- Underscore vs dash (`enrich_order_details` vs `enrich-order-details`)
- Period vs slash (`softpro.enrich` vs `softpro/enrich`)
- Singular vs plural

### 3. Vercel schedule

```json
// vercel.json

{
  "crons": [
    {
      "path": "/api/jobs/run?name=softpro.enrich_order_details",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

`path` includes the query string with the job name. `schedule` is cron syntax.

### 4. Operations Command Center labels

```typescript
// src/app/api/admin/ops/crons/route.ts

const CRON_SCHEDULES = {
  'softpro.sync_recent_orders': 'Hourly',
  'softpro.enrich_order_details': 'Every 15min',  // ← ADD
  // ...
};
```

Without this, the Operations dashboard won't show the cron's schedule. Not strictly required for functionality, but expected for ops visibility.

## How to verify a cron is actually firing

In Supabase:

```sql
SELECT id, job_type, status, created_at, ended_at,
       EXTRACT(EPOCH FROM (ended_at - created_at))::int as duration_seconds
FROM jobs 
WHERE job_type = 'softpro.enrich_order_details'
ORDER BY created_at DESC 
LIMIT 10;
```

You should see:
- One row per scheduled tick (every 15 min, every hour, etc.)
- `status = 'completed'` (or 'failed' if it threw)
- `duration_seconds` > 0 (if 0, the handler is exiting too early)

Red flags:
- Zero rows since the cron was added → wiring problem
- All rows with `duration_seconds = 0` → handler is no-op'ing
- All rows with `status = 'failed'` → handler is throwing

## Cron schedule syntax

Vercel uses standard cron syntax:

| Pattern | Meaning |
|---------|---------|
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Hourly at :00 |
| `0 0 * * *` | Daily at midnight UTC |
| `0 6 * * *` | Daily at 6 AM UTC |
| `*/5 * * * *` | Every 5 minutes |
| `0 0 * * 1` | Weekly on Monday |

**Important:** All times are UTC. PCT is in Los Angeles (UTC-8 PST / UTC-7 PDT). A cron set for `0 13 * * *` runs at 5 AM PST / 6 AM PDT.

## When you remove a cron

Removing from `vercel.json` stops the schedule. The handler stays in the codebase if you might trigger it manually.

```typescript
// src/app/api/jobs/run/route.ts
// Keep the handler mapping even after removing the cron — allows POST to this 
// endpoint with name=X to trigger manually
const JOB_HANDLERS = {
  'import-orders': handleImportOrders,  // No longer scheduled, manual only
  // ...
};
```

Optional: add a comment marking it manual-only.

## Manual trigger

To run a cron manually (no schedule wait):

```bash
curl -X POST https://td-hub.vercel.app/api/jobs/run?name=softpro.enrich_order_details \
  -H "Authorization: Bearer $CRON_SECRET"
```

Or from the Operations Command Center UI if it has a "Run Now" button.

## Common bugs

### Bug 1: Schedule in vercel.json but no handler registered
Cron fires, hits `/api/jobs/run?name=X`, returns 404 or "unknown job."

### Bug 2: Handler exists but not in JOB_HANDLERS map
Same as above.

### Bug 3: Job name mismatch
Cron schedule says `enrich-order-details`, handler map says `enrich_order_details`. Cron fires, runner can't find the job.

### Bug 4: maxDuration not set
Function dies at 10s. Long-running enrichment jobs need 300s.

### Bug 5: Forgetting Operations Command Center label
Cron runs fine but doesn't show in the ops dashboard. The Director loses visibility.

## Detection (greps to find missing wiring)

```bash
# All cron-scheduled jobs
grep -A 2 '"crons"' vercel.json

# All registered handlers
grep -B 1 'JOB_HANDLERS' src/app/api/jobs/run/route.ts

# All labels in the Operations Command Center
grep -A 1 'CRON_SCHEDULES' src/app/api/admin/ops/crons/route.ts
```

These three lists should match.

## Cross-references

- `/docs/claude-skills/patterns/backlog-aware-crons.md`
- `/docs/claude-skills/agents/api-specialist.md`
- `/docs/claude-skills/agents/reviewer.md`
- `/docs/claude-skills/watch-outs/silent-job-failures.md`
