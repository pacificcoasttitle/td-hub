# Watch-Out: SoftPro Data Latency

## The Trap

When a new order is created in SoftPro, there's a delay before all fields are available via `GetOrderDetails`. The order EXISTS, but querying for it returns partial or empty data for hours.

Our enrichment cron correctly calls SoftPro, SoftPro returns HTTP 200, but the response data lacks address, escrow officer, or other fields. We stamp `last_details_fetch_at` and move on. The order looks "enriched" but isn't.

This is NOT our bug. It's data latency on SoftPro's side.

## Real Incident

On 2026-05-19, after fixing the cooldown column bug, we ran the new enrichment cron against May 18 orders. The vendor_api_logs showed:

```
OrderNumber: 20017812-GLT
http_status: 200
success: true
response_meta: {
  "status": 200,
  "message": "Success",
  "resultCount": 1,
  "escrowOfficerCount": 0,
  "sampleEscrowOfficers": []
}
```

HTTP 200. Result count 1 (SoftPro confirms the order exists). But `escrowOfficerCount: 0` — no escrow officer data in their response.

The order was created in SoftPro just hours earlier. Their internal reporting/detail tables hadn't fully populated yet. By the next day, the same order returns full data.

## How To Recognize This

When investigating "why isn't this order enriched":

1. Check vendor_api_logs for the order — was it called?
2. If yes, check the response_meta — does it show `resultCount: 1`?
3. If yes, does the response show fields like `escrowOfficerCount: 0` or empty arrays?
4. If yes, it's data latency on SoftPro's side, not our bug.

The cron's 6-hour cooldown handles this gracefully. On the next attempt (6+ hours later), SoftPro will likely have the data and our cron will succeed.

## Why This Pattern Works With Our Architecture

The backlog-aware cron pattern (see `patterns/backlog-aware-crons.md`) is designed for this:

1. Cron tries order at T=0 → SoftPro returns partial data → minimal fields written, cooldown stamped
2. 6 hours later (T+6h), cooldown expires, eligibility check picks it up again
3. Cron tries again → SoftPro now has full data → all fields written
4. Order no longer matches eligibility (all fields populated) → cron stops trying

The pattern is RESILIENT to vendor data latency. You don't need to do anything special.

## What NOT To Do

### Don't write retry logic inside the handler

```typescript
// WRONG: tight retry loop
for (let attempt = 0; attempt < 5; attempt++) {
  const result = await getOrderDetails(orderNumber);
  if (result.data?.escrowOfficer) break;
  await sleep(60_000);  // wait 1 minute
}
```

This blocks the handler, eats Vercel function time, and hammers SoftPro for data that may take HOURS to appear.

The cron's 6-hour cooldown IS the retry mechanism. Trust it.

### Don't shorten the cooldown

```typescript
// WRONG: trying to retry sooner
// 6 hours → 30 minutes
sql`${orders.lastDetailsFetchAt} < NOW() - INTERVAL '30 minutes'`
```

Tempting when you see orders waiting. But:

- SoftPro data latency can be 4-8+ hours
- Retrying every 30 min × 200 orders = 400 SoftPro calls/hour
- They might rate-limit or block us
- Doesn't actually get data faster

6 hours is the right cooldown. Don't tune it down.

### Don't mark the order "failed"

```typescript
// WRONG: treating empty response as a failure
if (!result.data?.escrowOfficer) {
  throw new Error('Missing escrow officer');
}
```

This throws inside the per-order try/catch, accumulates in stats.errors, and potentially triggers the total-failure throw at the end. Cron gets marked failed in Operations Command Center. Director investigates. Finds nothing actionable.

Instead, just write whatever fields are present. Empty fields stay null. Next cycle picks it up.

## What TO Do

### Write what's there, log what's missing

```typescript
const result = await getOrderDetails(orderNumber);

if (result.success && result.data?.length > 0) {
  const orderDetail = result.data[0];
  
  // Write whatever fields are present
  await processOrderDetail(orderDetail);
  
  // Log if data was incomplete (helpful for debugging)
  if (!orderDetail.EscrowOfficer || !orderDetail.Address) {
    console.log(`[enrich-order-details] Partial data for ${orderNumber}:`, {
      hasAddress: !!orderDetail.Address,
      hasEscrowOfficer: !!orderDetail.EscrowOfficer,
      hasSalesRep: !!orderDetail.MarketingRep,
    });
  }
  
  stats.enriched++;  // It IS enriched — partially
}
```

### Set realistic expectations with stakeholders

If Jerry asks "why isn't this order showing an address?" and it was created today:

> "SoftPro has data latency on new orders. Their detail tables can take 4-12 hours to fully populate after order creation. The cron will retry every 6 hours until all fields are present. For orders created today, expect full enrichment by tomorrow morning."

### Monitor backlog over days, not hours

The right metric isn't "are we enriched within 15 minutes" — it's "are we enriched within 24 hours."

Query for stale orders:

```sql
SELECT count(*) as stale_unenriched
FROM orders o
WHERE o.source = 'softpro_sync'
  AND o.operational_status IN ('open', 'in_process', 'completed')
  AND o.created_at < NOW() - INTERVAL '24 hours'
  AND (
    NOT EXISTS (SELECT 1 FROM order_properties WHERE order_id = o.id AND address IS NOT NULL)
    OR o.sales_rep_id IS NULL
  );
```

If this number stays high day over day, that's a real problem. If it's small and changes daily, that's just SoftPro latency churning normally.

## Other Vendors That Have This Pattern

This isn't unique to SoftPro. Common pattern across vendor APIs:

- **TitlePoint:** New properties may not have full title records for 24-48 hours
- **SiteX:** Property data is usually instant but APN matching can lag
- **FNF/Westcor:** CPL data is usually instant once generated

Build cron patterns to handle latency gracefully for any vendor.

## When To Escalate To The Vendor Team

If you see consistent latency patterns over WEEKS (not hours), escalate:

> "SoftPro is consistently returning empty escrowOfficer fields for orders 6+ hours after creation. Is there a way to expedite their detail-table population, or an alternative endpoint that returns fuller data sooner?"

But don't escalate for normal latency. New orders are EXPECTED to have empty fields for hours.

## Historical Context

This pattern was discovered while debugging the May 18 enrichment problem. After fixing the cooldown column bug (commits `1ff7050`), we noticed:

- Cron was running correctly
- SoftPro was being called correctly  
- vendor_api_logs showed HTTP 200 responses
- BUT response data was sparse for very recent orders

Initially we thought this was another bug. Closer inspection showed it was SoftPro returning sparse data for orders created hours earlier. The architecture handles this — we just had to recognize the pattern.

## Reference Files

- `patterns/backlog-aware-crons.md` — the cron pattern that handles latency
- `patterns/softpro-integration-rules.md` — SoftPro-specific gotchas
- `src/lib/jobs/handlers/enrich-order-details.ts` — handler that gracefully handles partial responses
