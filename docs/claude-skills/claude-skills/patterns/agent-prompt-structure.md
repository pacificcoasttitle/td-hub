# Pattern: Agent Prompt Structure

## Summary

When the Director fires a ticket to a Cursor agent, the prompt should follow a specific structure. This pattern produces higher-quality work, fewer false-completions, and faster execution.

## The Structure

```
ROLE / TASK
[Who the agent is, what they're doing]

STRICT RULES
[Non-negotiables — usually pointers to skill files]

LIVE FAILURE FACT WITH EVIDENCE
[The specific bug or gap, with data]

CURRENT BAD VALUE
[What's wrong RIGHT NOW]

ROOT CAUSE HYPOTHESIS
[Best diagnosis]

LEGACY TRUTH (where applicable)
[What the legacy code does]

SPECIFIC TASK
[Step-by-step what to do]

REQUIRED OUTPUT WITH NUMBERED DELIVERABLES
[What "done" looks like]

EXPLICIT DO-NOT LIST
[What NOT to touch]

SUCCESS CRITERION
[How to verify it worked]
```

## Why This Structure

The agent is stateless. Every ticket needs full context. Skipping any section above leaves the agent guessing.

Common failure modes when ticket structure is loose:
- Agent guesses at field names → ships wrong code
- Agent expands scope to "fix related issues" → creates regressions
- Agent skips verification → reports false completion
- Agent doesn't push commits → Director can't deploy

## Section-by-section guidance

### ROLE / TASK

```
You are the Builder agent for TD Hub vNext.

Your task: Apply canAccessOrder() to the remaining unguarded order detail routes.
```

One sentence. The agent reads `/docs/claude-skills/agents/builder.md` for the full role.

### STRICT RULES

```
Read first:
- /docs/claude-skills/agents/builder.md (your role)
- /docs/claude-skills/patterns/backlog-aware-crons.md (the pattern)

NEVER:
- Commit without pushing
- Improvise vendor field names
- Return error objects from job handlers (always throw)
```

Use skill file references. Keep inline rules to the truly ticket-specific.

### LIVE FAILURE FACT WITH EVIDENCE

```
Production state as of 2026-05-18 23:00:
- 69 orders from May 18 have no address
- 33 of 69 have no escrow officer
- vendor_api_logs shows 0 successful get_order_details calls in last 21 hours
- jobs table shows softpro.import_orders "completed" at 18:00 (last run)
- Job duration: 121 seconds (suspicious — timeout threshold)
```

Concrete numbers, table names, time stamps. No "we noticed some orders aren't enriched."

### CURRENT BAD VALUE

Show the actual broken state. Use code excerpts:

```typescript
// Currently in src/lib/jobs/handlers/import-orders.ts:67
const result = await getOrderDetails({ 
  dateFrom: formatTodayForImport(),
  dateTo: formatTodayForImport(),
});
// This date-range call times out at 120s.
```

### ROOT CAUSE HYPOTHESIS

State what you think is wrong. Be specific. If unsure, send to Investigator first.

```
Root cause hypothesis: SoftPro's GetOrderDetails times out on date-range queries 
larger than a few minutes' worth of orders. Per-order calls work reliably 
(escrow officer backfill proved this).
```

### LEGACY TRUTH

If applicable, what does the legacy code do?

```
Legacy (Cron::fetchSoftproOrders) calls GetOrderDetails with daily date range.
This pattern worked historically; SoftPro behavior has changed.
The legacy admin/backfill/escrow-officers route uses per-order calls 
and succeeds 100%. Follow that pattern.
```

### SPECIFIC TASK

Numbered steps. Each step is one concrete change.

```
1. Add column `last_details_fetch_at timestamp` to orders schema.
2. Create new handler `src/lib/jobs/handlers/enrich-order-details.ts`:
   - Uses backlog-aware pattern from patterns/backlog-aware-crons.md
   - Per-order GetOrderDetails calls
   - 6-hour cooldown
   - Throws on total failure
3. Extract `processOrderDetail()` from import-orders.ts into 
   src/lib/domain/orders/process-detail.ts so new handler can share.
4. Register new cron in vercel.json (every 15min) and jobs/run route.
5. Remove import-orders from cron schedule (keep handler for manual triggers).
```

### REQUIRED OUTPUT WITH NUMBERED DELIVERABLES

```
DELIVERABLES:

1. Schema column added (migration file in src/lib/db/migrations/)
2. Director SQL note: ALTER TABLE orders ADD COLUMN last_details_fetch_at timestamp;
3. New handler file at src/lib/jobs/handlers/enrich-order-details.ts
4. Shared service at src/lib/domain/orders/process-detail.ts
5. import-orders.ts refactored to use shared service
6. vercel.json updated: new cron, import-orders removed
7. Operations Command Center label map updated
8. Commit pushed to origin/main (verify with git log origin/main -1)
9. Typecheck status reported
```

### EXPLICIT DO-NOT LIST

```
DO NOT:
- Touch sync-orders.ts (separate concern)
- Modify the SoftPro client adapter (just call existing functions)
- Remove import-orders handler code (only its cron schedule)
- Apply this pattern to other crons in the same ticket (one thing at a time)
- Commit untracked dirty files in your working tree
```

### SUCCESS CRITERION

```
SUCCESS:
- After deploy + migration: softpro.enrich_order_details cron runs every 15 min
- Within 30 min of first run: at least 50 orders have last_details_fetch_at populated
- Within 6 hours: backlog of 145+ unenriched softpro_sync orders drops below 20
- jobs table shows enrich_order_details running with avg duration 60-200 seconds
- vendor_api_logs shows get_order_details calls with success: true
```

## Anti-patterns

### Anti-pattern: Vague tickets

```
❌ Fix the enrichment issue. The orders aren't being filled in.
```

Agent has no idea where to start. Will guess. Will probably be wrong.

### Anti-pattern: "Just do it the right way"

```
❌ Build this the way you usually build it. Use best practices.
```

Best practices aren't specified. Will use generic Next.js patterns that don't match TD Hub's conventions.

### Anti-pattern: Multi-concept tickets

```
❌ Fix enrichment AND update the Hub UI AND backfill the data 
   AND notify users when complete.
```

One ticket, one concept. File separate tickets for related work.

### Anti-pattern: No success criterion

Without a success criterion, agents can't tell if they're done. They tend to over-deliver (scope creep) or under-deliver (call it done when it's half-built).

## Cross-references

- `/docs/claude-skills/agents/director.md`
- All agent role files
