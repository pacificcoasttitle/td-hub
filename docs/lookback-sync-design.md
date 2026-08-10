# Order look-back sync — design

**Status:** design only, nothing built. Approve before implementation.
**Date:** Aug 10, 2026 · **Branch:** `spike/lookback-sync-design`

One job that re-fetches `GetOrderDetails` for existing orders, fixing status drift
and picking up `LoanAmount` on the same trip.

---

## 0. THE GATING QUESTION — side effects of writing an order update

**Verdict: a bulk order update cannot send any email, notification, or webhook.
The suppression is structural — it is not a setting we configure and not
something we have to build. Nothing in the write path can reach a notification.**

That is a strong claim, so here is the whole trace.

### 0.1 There are no database triggers

No `CREATE TRIGGER` or `CREATE OR REPLACE FUNCTION` in any migration. Nothing
fires at the database level on an `orders` UPDATE.

### 0.2 The write path imports nothing that can notify

`processOrderDetail` (`src/lib/domain/orders/process-detail.ts`) is the function a
look-back would reuse. Its **complete** import list:

```ts
import { db } from '@/lib/db/client';
import { orders, orderProperties, orderStatusHistory, contacts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseSoftProDate } from '@/lib/integrations/softpro/types';
import type { SoftProOrderDetailItem, SoftProResolvedPerson } from '@/lib/integrations/softpro/types';
import { mapStatus, mapTransactionType, ... } from './status-map';
```

No notification module, no outbox, no email client, no delivery service. Its
writes touch exactly four tables — `orders`, `order_properties`,
`order_status_history`, `contacts` — and there is **no `event_outbox` insert**.

### 0.3 Every outbox writer is unreachable from this path

There are exactly seven `db.insert(eventOutbox)` sites. None is in the order
detail path:

| Site | Fires on |
|---|---|
| `api/orders/[id]/document-requests/route.ts:96` | a user requesting a document |
| `domain/documents/service.ts:297` | a document upload |
| `domain/orders/create-order.ts:210` | order **creation** via the wizard |
| `domain/titlepoint/completion-checker.ts:185` | `maybeEnqueueConfirmation` |
| `domain/webhooks/softpro-handler.ts` ×3 | inbound SoftPro webhooks |

`notifications.process_outbox` runs every minute, but it drains what is enqueued.
Nothing enqueues, so it drains nothing.

### 0.4 The two things that actually send to clients

- **Confirmation emails** — `maybeEnqueueConfirmation` is called from
  TitlePoint paths only (`pre-initiate`, `process-work`, `service`,
  `completion-checker`). Never from an order-detail update.
- **Prelim deliveries** — `maybeAutoDeliverPrelim` has exactly **one** caller:
  `ingest-prelim-from-softpro.ts`, i.e. the moment a prelim **document** is
  ingested. It is not reachable from a status change. It also carries its own
  `hasExistingPrelimDelivery` idempotency guard, so even a hypothetical
  re-trigger would not re-send.

### 0.5 Nothing polls for status transitions

No cron reacts to a status *change*. Three jobs reference
`operational_status`, all as an **inclusion filter**:

```sql
operational_status in ('open', 'in_process', 'completed')
```

— `fetch_prelims`, `enrich_orders`, `backfill_sitex_property`. Marking an order
`closed` therefore **removes** it from their scope. The effect of this job is
strictly less downstream activity, not more.

`order_status_history` has only read consumers (the dashboard activity feed and
the milestones API).

### 0.6 Two real consequences that ARE worth designing for

Neither sends anything, but both are visible.

**(a) The admin activity feed will be flooded.** `/api/dashboard/activity`
selects from `order_status_history` `ORDER BY changed_at DESC LIMIT n` with **no
filter**. ~763 corrections would bury days of genuine activity under one bulk
event. It already selects the `source` column but does not filter on it.

> **The one thing to build:** write `source: 'lookback_sync'` (not
> `'softpro_sync'`) on the history rows, and exclude that source from the
> activity feed — or collapse it to a single summary row. Small, but it must
> land with the job, not after.

**(b) Orders leaving `in_process` leave other jobs' scope.** Correct and
desirable — a closed order should not be polled for prelims — but it means
`fetch_prelims` candidate counts will drop after the first run. Expected, not a
regression.

**(c) A file number we do not have would be created, not updated.**
`processOrderDetail` inserts when no order matches. Restricting input to
file numbers already in our table avoids surprise order creation. Recommended
(§3.4).

---

## 1. Real drift readings — the detector's own numbers

The `softpro.verify_sync` detector has produced **five valid readings**
(`jobs.payload.statusDrift`):

| Run | Checked | Drifted | Drift % | Drifted to |
|---|---|---|---|---|
| Aug 10 | 39 | 8 | **20.5%** | Completed 6, Closed 2 |
| Aug 9 | 40 | 8 | **20.0%** | Completed 6, Closed 2 |
| Aug 8 | 39 | 6 | **15.4%** | Completed 4, Closed 2 |
| Aug 5 | 40 | 9 | **22.5%** | Completed 4, Closed 4, Canceled 1 |
| Aug 4 | 37 | 4 | **10.8%** | Completed 3, Closed 1 |
| **Pooled** | **195** | **35** | **17.9%** | |

**The headline number should be ~18%, not 24%.** The 24% came from the 76-order
spike sample; the detector's pooled 195 checks put it at 17.9%.

Two runs produced **no reading at all** — Aug 7 (0 checked, 40 unchecked) and
Aug 6 (0 checked, 27 unchecked, stopped early). Those are the pre-timeout-fix
days. Worth knowing the detector has blind days; it is not yet a 7/7 instrument.

### 1.1 The band breakdown is the finding that shapes the window

Aggregating `byBand` across the five valid runs:

| Age band | Checked | Drifted | **Drift rate** |
|---|---|---|---|
| < 30d | 45 | **0** | **0.0%** |
| 30–90d | 85 | 26 | **30.6%** |
| 90–180d | 58 | 9 | **15.5%** |
| > 180d | 7 | 0 | 0.0% *(too few to trust)* |

**Zero drift in 45 samples under 30 days.** The hourly `GetOrders(today, today)`
sync catches recent orders correctly — the open-date window only fails once an
order outlives it. Drift then peaks at **30–90 days** (30.6%), which is exactly
where the 58–63 day median close lands, and decays after.

---

## 2. Window + scope

### 2.1 Population

`in_process` orders by age (total **4,225**):

| Band | Orders |
|---|---|
| 0–30d | 900 |
| 30–60d | 930 |
| 60–90d | 937 |
| 90–180d | 1,239 |
| 180–365d | 183 |
| 365d+ | 36 |

### 2.2 Recommendation: **30–180 days, `in_process` only → 3,106 orders**

| Window | Orders | Rationale |
|---|---|---|
| 0–180d | 4,006 | includes 900 orders with 0/45 measured drift — wasted calls |
| **30–180d** | **3,106** | **covers both bands where drift is real** |
| 30–90d | 1,867 | the hot band only — good Phase 1 |
| 0–365d | 4,189 | adds 219 orders with no evidence of drift |

Skipping 0–30d is the deliberate call: 45 consecutive samples with zero drift,
and those orders are already covered by the hourly sync. It removes 22% of the
work for no measured loss. Skipping 180d+ removes another 219 for the same
reason, with the caveat that our evidence there is only 7 samples — if you want
those, they are cheap to add later.

**Expected corrections**, applying measured band rates to population:

| Band | Orders | Rate | Expected |
|---|---|---|---|
| 30–90d | 1,867 | 30.6% | ~571 |
| 90–180d | 1,239 | 15.5% | ~192 |
| **Total** | **3,106** | | **~763** |

Cross-check: 763 / 4,225 = **18.1%** of all `in_process`, which agrees with the
pooled 17.9%. Two independent routes to the same number.

---

## 3. Bulk vs per-order

### 3.1 The bulk date-range path is NOT live today — measured, not assumed

The ticket says the adapter now supports `DateFrom`/`DateTo` with pagination
(~50/page). **It does not work today.** Every variant I tried timed out:

| Request | Result |
|---|---|
| `DateFrom=07/01/2026&DateTo=07/01/2026` (single day) | **timeout at 90s** |
| `DateFrom=08/03/2026&DateTo=08/03/2026` (single day) | **timeout at 90s** |
| + `&PageNumber=1&PageSize=50` | **timeout at 90s** |
| + `&Page=1&PageSize=50` | **timeout at 90s** |
| + `&Skip=0&Take=50` | **timeout at 90s** |
| + `&pageSize=50&pageNumber=1` | **timeout at 90s** |
| `DateFrom=07/01/2026&DateTo=07/07/2026` (7 days) | **timeout at 90s** |
| `OrderNumber=20020625-OCT` (single order, control) | **HTTP 200, 930 bytes** |

I cannot tell from outside whether the adapter ignores the date parameters and
attempts an unbounded query, or whether the range query is simply unindexed.
Either way it is unusable now, and a single-order call succeeds against the same
endpoint in the same session.

**Design for per-order. Do not build against the bulk path.** Worth re-testing
when Aashima's team ships `LoanAmount` — if it becomes live it is a genuine
order-of-magnitude saving (14 calls vs ~3,100) and the job's fetch layer should
be written so that swapping it in is a contained change (§4.4).

### 3.2 Cost of the per-order approach

3,106 calls at measured latency. See §5 for throughput and §6 for scheduling.

---

## 4. What it writes

### 4.1 Reuse `processOrderDetail` with `preserveExistingOnEmpty: true`

The protection against clobbering good local data **already exists** and does not
need building. With the flag set, `emptyField` becomes `undefined`, and Drizzle's
`mapUpdateSet` drops undefined keys — so a blank vendor field omits the column
entirely and preserves what we have. Without it, blanks write `null`.

**This flag is mandatory for a look-back.** A stale or partial vendor record must
never blank a field we already populated correctly.

### 4.2 Fields it updates

`operational_status`, `softpro_status`, `transaction_type`, `product_type`,
`order_type`, `sales_price`, `marketing_source`, `sales_rep_id`,
`title_officer_id`, `escrow_officer_id`, `opened_at`, `completed_at`,
`closed_at`, `softpro_last_synced_at`, plus `order_properties` (address/city/
state/zip) — and `loan_amount` once the field ships.

### 4.3 Fields it must NOT touch

- **Anything SoftPro returns blank** — covered by `preserveExistingOnEmpty`.
- **`operational_status` when `mapStatus` returns `null`.** An unrecognised
  SoftPro status already preserves the existing value rather than guessing. Keep
  that; a look-back must not downgrade an order because of an unknown string.
- **`order_parties`.** Deliberately out of scope. Party reconciliation belongs to
  `enrich_orders`/`sync_contacts`, and touching it here would drag in the
  seller/lender questions from the `20020625-OCT` investigation for no benefit.
- **Local-only columns:** `client_contact_id`, `dup_override`, `email_status`,
  the `*_policy_sent` / `*_confirmation_sent` flags, and every `last_*_fetch_at`
  cursor belonging to another job.

### 4.4 Structure

Put the fetch behind a small interface (`fetchDetails(fileNumbers) => items[]`)
with a per-order implementation now, so a future bulk implementation is a swap
rather than a rewrite.

---

## 5. Runtime safety and rate limiting

### 5.1 Measured latency — the tail is the problem

`get_order_details`, 4,330 calls over 7 days:

| p50 | avg | p95 | p99 | max |
|---|---|---|---|---|
| **2,165ms** | 4,675ms | **21,024ms** | **42,090ms** | 64,684ms |

A 2.2s median with a 21s p95 and 42s p99. Sizing on the median would be a
mistake.

**I also reproduced the degradation while writing this doc.** After seven
90-second range requests, a single-order call that normally runs at p50 2.2s took
**10,532ms**. This is the same behaviour as the earlier p50 2.4s → 19s incident.
The adapter is load-sensitive, and our own job is capable of causing it.

### 5.2 Controls (all proven in `verify_sync`)

- **Per-call timeout 30s, enforced by racing** — not by trusting the client.
  Makes the worst case a known number instead of an observed one.
- **Concurrency 3.** Sequential sampling checked 6/40 in the same budget;
  concurrency 3 reached 37/40.
- **Inter-call delay 250ms** between dispatches.
- **Timeouts count as `unchecked`, never as failures.** They do not mark an
  order corrected, do not retry within the run, and are simply revisited next
  run.

### 5.3 Time budget — reuse the PR #12 guard

Add to `UNIT_P99_MS`:

```ts
/** One order: a get_order_details call this job caps at 30s itself, plus the
 *  250ms inter-call delay. Enforced, not observed — same rationale as
 *  verify_sync. */
'softpro.lookback_sync': 31_000,
```

giving `budget = 300 − 31 − 30 = 239s`. Call `deadline.exceeded()` at the **top**
of each loop iteration, before claiming the next order — never mid-unit.

### 5.4 Cursor, resumability, idempotency

- **Dedicated cursor column** (e.g. `last_lookback_sync_at`) rather than reusing
  `last_details_fetch_at`, so the look-back and `enrich_order_details` do not
  fight over the same ordering. *This is the design's only schema change — it
  needs a migration, so flag it at approval time.* A cursor table or a job-payload
  cursor would avoid that if you would rather not touch `orders`.
- Order by cursor ascending, nulls first — same shape as the existing jobs.
- **Idempotent by construction:** `processOrderDetail` is an upsert, and a second
  pass over an already-corrected order simply writes the same values and records
  no change.
- **No half-done units:** one order = one `processOrderDetail` call. The budget
  check happens between orders, so a run either completes an order or has not
  started it.

### 5.5 Throughput

At concurrency 3 with 250ms spacing and a p50 of 2.2s, the optimistic rate is
~1.3 orders/sec → ~310 orders per 239s run. The p95 tail will pull that down; a
planning figure of **150–250 orders per run** is realistic.

**3,106 orders ÷ ~200 = ~16 runs.** At every 15 minutes that is ~4 hours; hourly,
~16 hours. Either is acceptable for a backfill. I would run it every 15 minutes
until the backlog drains, then drop the cadence or retire it.

---

## 6. Measurement

The pass should *measure* drift while fixing it — a census of its window rather
than a 40-order sample.

Record per run, persisted to `jobs.payload` via the existing `recordRunCounts`
pattern:

- `examined`, `checked`, `unchecked` (timeouts)
- `corrected` — status actually changed
- `correctedTo: { Closed, Completed, Canceled, … }`
- `byBand: { '30-90d': {checked, corrected}, '90-180d': {…} }`
- `fieldsChanged` — a count per field, which is how we will see `loan_amount`
  start landing
- `stoppedEarly`, `remaining`

Two things this gives us:

1. **The true drift rate** for the covered window, replacing both the 24% spike
   estimate and the 17.9% sample.
2. **A falsifiable prediction:** `verify_sync`'s daily `driftPct` should fall
   toward zero for the 30–180d bands after the backlog drains. If it does not,
   the look-back is not working and we will see it within a day. That is the
   acceptance test.

---

## 7. Rollout

| Phase | Scope | Purpose | Gate to next |
|---|---|---|---|
| **0. Dry run** | 30–180d, **no writes** | Count what *would* change. Validates the ~763 estimate and proves the fetch layer before any mutation. | Corrections land in 15–25%; no unexpected field churn |
| **1. Hot band** | 30–90d, writing (1,867 orders) | Highest-value, smallest blast radius. ~571 corrections. | `verify_sync` 30–90d drift falls materially |
| **2. Full window** | 30–180d (3,106) | Adds ~192 more. | Drift flat across both bands |
| **3. Steady state** | reduce cadence or retire | Backlog is drained; the hourly sync plus the detector hold the line. | — |

**Phase 0 is not optional.** It costs one run and it is the only step that
verifies the write set before anything is written.

### 7.1 On `LoanAmount`

Build now for status; the same job picks up `loan_amount` automatically once
Aashima's field ships, because `processOrderDetail` will map it and the look-back
simply re-fetches. Do **not** wait for the field — status drift is the live
problem, and re-running the same job later is free. Re-test the bulk endpoint
(§3.1) at that point.

---

## 8. Recommendation

Build it, in this order: **Phase 0 dry run → Phase 1 (30–90d) → Phase 2
(30–180d)**, per-order (the bulk endpoint is not usable), reusing
`processOrderDetail` with `preserveExistingOnEmpty: true`, the PR #12 deadline
guard at a 239s budget, and `verify_sync`'s proven 30s/×3/250ms call discipline.

The gating risk is answered: **no client-facing message can fire from this job.**
The only thing that genuinely needs building alongside it is the
`source: 'lookback_sync'` tag plus an activity-feed filter, so ~763 corrections
do not bury the dashboard.

Open question for you: the dedicated cursor column implies a migration (§5.4).
If you would rather keep this migration-free, say so and I will design the cursor
into the job payload instead.
