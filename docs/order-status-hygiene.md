# Order status hygiene — why 60% of orders sit in `in_process`

**Spike, August 3 2026.** Read-only. No schema, no migrations, no writes, no sync-logic
or RLS changes. Branch `spike/order-status-hygiene`. Findings only — nothing to merge.

SoftPro comparisons were made with raw `fetch` rather than through
`src/lib/integrations/softpro/client.ts`, so this spike wrote **no `vendor_api_logs` rows**.

---

## Severity verdict

> **URGENT, not cosmetic.** About **980 of the 4,010 `in_process` rows (24%) are stale** —
> SoftPro has already moved them to Closed, Completed or Canceled and we never found out.
> That is ~15% of all 6,612 orders. Worse, the only thing that has ever corrected this at
> scale was a **one-off manual re-fetch on July 29**; in every other week of the last two
> months, the number of aged orders that transitioned status was **zero**. Left alone,
> this does not stay at 24% — it grows.

**Do not build gone-quiet, momentum, or any workload/pipeline metric on
`operational_status` until the look-back sync in §7 lands.** Recency and count metrics
keyed on `opened_at` are unaffected and safe to build on now.

---

## The four findings

1. **The 60% headline is mostly innocent.** 95% of `in_process` is under 180 days old and
   none is over two years. Monthly volume grew ~8x (131 orders in Dec → ~1,000/month since
   April) and the median file takes 58–63 days, so a large in-flight pile is expected.

2. **But ~24% of that pile is wrong**, and the mechanism is confirmed by experiment:
   `GetOrders` is an **open-date** window and the hourly cron only ever asks for *today*,
   so an order that closes months after it opens is never returned by any call we make.

3. **The cohort "drain" in our own data is not a working refresh loop** — it is one manual
   backfill on July 29 plus incidental refreshes of orders that were still incomplete. See
   §4, which is the direct answer to "shouldn't cohorts not drain if status is frozen?"

4. **`closingRatio` is fully insulated** — external API, never reads `orders`. The figures
   reps are judged on are not exposed to any of this.

**Correction to something I said earlier.** During the health-snapshot work I called
`in_process` "a catch-all files never leave," generalising from a single CRM client. That
was wrong in its reasoning: files *do* leave on a normal curve, median 58–63 days.
Withholding the tile was still correct, but the real reason is staleness (24% wrong), not
meaninglessness.

---

## 1. The shape of the data

| status | n | share |
|---|---|---|
| `in_process` | 4,010 | 60.6% |
| `completed` | 1,513 | 22.9% |
| `closed` | 986 | 14.9% |
| `canceled` | 83 | 1.3% |
| `hold` | 11 | 0.2% |
| `duplicate` | 7 | 0.1% |
| `open` | 2 | 0.0% |

### Age of the `in_process` pile

| age since `opened_at` | n | share |
|---|---|---|
| < 30 days | 917 | 22.9% |
| 30–90 days | 1,759 | 43.9% |
| 90–180 days | 1,132 | 28.2% |
| 180–365 days | 168 | 4.2% |
| 1–2 years | 34 | 0.8% |
| > 2 years | 0 | 0% |

Orders opened in the last four months account for 3,541 of the 4,010 (88%). Volume by
month: Dec 131 → Jan 258 → Feb 469 → Mar 668 → Apr 1,232 → May 1,041 → Jun 1,097 →
Jul 1,018. Median time-to-finish 58–63 days, p90 264–298 days.

---

## 2. The drift table — how much is actually stale

Stratified random sample of the `in_process` population, each order's **current** status
fetched live from SoftPro via `GetOrderDetails`. "Drift" = we say `in_process`, SoftPro
says something terminal.

| age stratum | population | checked | drift | drift rate | SoftPro now says |
|---|---|---|---|---|---|
| < 30 days | 917 | 18 | 2 | 11.1% | Closed ×2 |
| 30–90 days | 1,759 | 22 | 8 | **36.4%** | Completed ×6, Closed ×2 |
| 90–180 days | 1,132 | 17 | 3 | 17.6% | Completed ×2, Closed ×1 |
| 180–365 days | 168 | 9 | 2 | 22.2% | Completed ×2 |
| > 365 days | 34 | 10 | 1 | 10.0% | Canceled ×1 |
| **total** | **4,010** | **76** | **16** | | |

**Weighting each stratum by its true population size: ~980 stale rows, 24% of
`in_process`, ~15% of all orders.**

**Drift is worst at 30–90 days, not in the old tail.** That is the most important line in
this document and it makes mechanical sense: the median file closes at 58–63 days, and the
moment it closes we lose the ability to see it. Orders freeze precisely when they would
have transitioned. The old tail is comparatively clean because files still sitting there
after a year are genuinely stalled on SoftPro's side too.

An independently drawn earlier sample of 34 orders agrees: 6 of 28 aged `in_process`
orders had drifted (21%), while 6/6 orders opened today and 6/6 already-closed orders
matched exactly — which also confirms the comparison method itself is sound.

**Confidence.** Per-stratum samples are small (9–22 checked) and the estimate is dominated
by the 30–90 day band (8 of 22). Taking the 95% interval on that proportion alone moves
the total to roughly **700–1,350 stale rows**. Direction and magnitude are solid; the
precise figure is not. A further 18 calls timed out at 15s and are excluded — all were
timeouts, not "order not found", so they cost sample size without biasing the rate.

To get an exact number, run the look-back sync in §7 and count the rows it changes — that
measures and fixes in one pass.

---

## 3. The 4,010 split

| group | n | share | whose problem |
|---|---|---|---|
| **Stale — SoftPro says closed/completed/cancelled** | **~980** | **24%** | **ours (bug)** |
| Genuine in-flight, opened < 180 days | ~2,870 | 72% | nobody — normal work |
| Genuinely stalled, opened > 180 days, SoftPro agrees | ~160 | 4% | ops, in SoftPro |

The middle group is the real answer to "why 60%": a business that quadrupled monthly
volume with a two-month cycle time. The bottom group is the never-cancelled long tail —
real deals that died without anyone formally closing them. Neither is a code problem.
The top group is.

---

## 4. Why do cohorts drain if status is frozen?

This was the open tension, and it is worth answering precisely because the answer changes
the severity.

**Our cohorts drain because of a one-off manual re-fetch, not an ongoing refresh path.**

Status transitions (`closed`/`completed`/`canceled`) recorded per week, and how many were
for orders more than 90 days old at the time:

| week of | transitions | of which for orders > 90d old |
|---|---|---|
| 2026-06-08 | 10 | **0** |
| 2026-06-15 | 9 | **0** |
| 2026-06-22 | 18 | **0** |
| 2026-06-29 | 7 | **0** |
| 2026-07-06 | 10 | **0** |
| 2026-07-13 | 9 | **0** |
| 2026-07-20 | 11 | **0** |
| **2026-07-27** | **684** | **375** |
| 2026-08-03 | 2 | **0** |

Every ordinary week: 7–18 transitions, and **zero** for aged orders. One week: 684, with
375 for aged orders. Drilling into that week, it is a single day — **July 29** — with 676
transitions, against 1–3 on every neighbouring day. `get_order_details` call volume that
day was **2,732** versus a 476–763 baseline.

No distinct job type appears in the `jobs` table for that spike, and the routine crons ran
at their normal cadence. The most likely trigger is one of the in-request admin backfill
routes (e.g. `/api/admin/backfill/order-details`), which do the work inside the HTTP
request and so never create a `jobs` row. I could not confirm the trigger conclusively —
what is certain is that it was a one-off bulk event, not a scheduled path.

**So: our DB is stale against SoftPro's reality.** The drain visible in our own cohort
table is (a) orders that happened to close while still incomplete enough to be picked up by
`enrich_order_details`, and (b) that single July 29 catch-up. There is no routine mechanism
that revisits an aged order.

This also sharpens the severity. The ~980 stale rows measured today exist **five days
after** a bulk re-fetch — and that re-fetch was itself partial (2,732 detail calls against
a 4,000-row `in_process` population plus everything else competing for the same job).
The mechanism analysis in §5 is confirmed, not contradicted.

### Supporting evidence: 38% of the pile has dropped out of the only refresh path

`enrich_order_details` is the one scheduled job that writes `operational_status`
(via `processOrderDetail`, `src/lib/domain/orders/process-detail.ts:193`), but its
candidate query selects on **missing data**, not stale status. Once an order has an
address, a zip and all three officers, it is never selected again.

| age bucket | in_process | fully enriched → ineligible | frozen % |
|---|---|---|---|
| < 30 days | 917 | 78 | 8.5% |
| 30–90 days | 1,756 | 302 | 17.2% |
| 90–180 days | 1,135 | 963 | **84.8%** |
| > 180 days | 202 | 182 | **90.1%** |
| **total** | **4,010** | **1,525** | **38.0%** |

The older an order gets, the more certain it is to have completed enrichment and dropped
out. Note this is eligibility, not delivery — an order can be eligible and still rarely
reached, since the job runs a batch of 50 with a 6-hour per-order cooldown. So 38% is a
floor on the frozen population, not the whole of it.

---

## 5. The mechanism (confirmed by experiment)

`handleSyncOrders` (`src/lib/jobs/handlers/sync-orders.ts:44`) defaults both ends of its
window to today, and the hourly cron `softpro.sync_recent_orders` passes no payload:

```ts
const dateFrom = payload.dateFrom ?? formatDateForSoftPro(now);
const dateTo   = payload.dateTo   ?? formatDateForSoftPro(now);
const adapterResult = await getOrders({ dateFrom, dateTo });
```

**I tested what that window means rather than assuming.** `GetOrders` for today returned
40 orders; all 39 that exist in our database were **opened** today, and zero were
previously-opened orders that had merely changed status. Yesterday's window returned 0.

```
GetOrders 08-03-2026..08-03-2026 -> 40 orders
  status mix: {"InProcess":39,"Canceled":1}
  opened today/yesterday=39   opened EARLIER=0   not in our DB=1
  -> open-date window, NOT a modified-date window
```

An order that closes months after it opens is never returned by any call this system
makes. The comment in `sync-orders.ts` — "Existing orders only get status + date updates" —
is true but only ever applies within that one-day window.

### It is not a mapping bug

`mapStatus` (`src/lib/domain/orders/status-map.ts`) correctly handles `closed`,
`completed`, `canceled`, `inprocess`, `hold`, `duplicate`, and returns `null` for unknown
values so the upsert preserves rather than guesses. In the database, `softpro_status`
matches `operational_status` **1:1 on every row** — 4,010 `inprocess` → 4,010 `in_process`,
zero exceptions. We store faithfully what SoftPro last told us. We just stop asking.

---

## 6. Blast radius

### Degraded by the stale share

| surface | what it does | file |
|---|---|---|
| Admin ops dashboard — "In Process" card | counts `= 'in_process'` | `src/app/api/admin/dashboard/metrics/route.ts:35` |
| Manager dashboard — branch open orders | `in ('open','in_process')` | `src/app/api/dashboard/manager/branch-stats/route.ts:37` |
| Manager dashboard — team stats / pipeline | `in ('open','in_process')` | `src/app/api/dashboard/manager/team-stats/route.ts` |
| Manager dashboard — rep performance | `in ('open','in_process')` | `src/app/api/dashboard/manager/rep-performance/route.ts` |
| Escrow officer workload | `in ('open','in_process')` | `src/app/api/escrow/officers/route.ts` |
| Escrow task list | reads status | `src/app/api/escrow/tasks/route.ts` |
| **Client portal "active orders"** | `open` or `in_process` | `src/app/client/dashboard/page.tsx:48` |
| CRM health snapshot | `counts.open` — computed, deliberately **not rendered** | `src/lib/domain/crm/client-metrics.ts` |

Across the whole table, 4,012 orders are currently counted as "active" by the
`in ('open','in_process')` definition. On the 24% estimate, roughly **1,000 of those are
not active at all**. The client portal is the only externally-facing surface in the list,
so that inflation is visible to customers.

### Wasted work, not wrong numbers

`fetch_prelims`, `enrich_order_details`, `enrich_orders`, `sitex.backfill_property` and
the TitlePoint completion checker all gate on
`operational_status in ('open','in_process','completed')`. Orders that are really closed
stay eligible forever. The `fetch_prelims` eligible pool is 1,105 orders, of which 45 are
`in_process` files opened more than 180 days ago that it re-polls every 6 hours. Small
against 29,720 `get_attached_documents` calls a week, but pure waste.

### Insulated

- **`closingRatio`** — see §7.
- Anything keyed on `closed_at` / `completed_at`. All 986 `closed` rows have `closed_at`
  set and all 1,513 `completed` rows have `completed_at` set, so date-driven metrics rest
  on firmer ground than status-driven ones.

---

## 7. Does `closingRatio` depend on this field? — No.

`getRepFigures` (`src/lib/integrations/managers-report/client.ts:81`) issues an HTTP
request to `MANAGERS_REPORT_API_URL` (`/api/td/rep/{repName}`) and returns `closingRatio`
straight from that response. The Managers Report module touches our database only to write
`vendor_api_logs` rows for observability — it never reads `orders` and never reads
`operational_status`.

Closing ratio, openings, closings and the leaderboard on the sales and manager dashboards
are computed by an external system from its own data. **Nothing we already trust on those
dashboards is exposed to this.** The exposure is limited to the in-house pipeline and
workload tiles in §6.

---

## 8. The `open` status is vestigial — three bugs follow from it

Only **2 orders** in the whole table have `operational_status = 'open'`, and only 19 have
ever had it in `order_status_history`. SoftPro's lifecycle starts at `InProcess`. Three
pieces of code assume otherwise:

| place | consequence |
|---|---|
| Admin metrics "Open" card (`metrics/route.ts:34`) | renders **0 every month** |
| `handleVerifyOrderSync` (`verify-order-sync.ts:23`) — `where operational_status = 'open'` | scheduled daily at 06:00 via `softpro.verify_sync`; processes at most 2 orders. **A daily job that verifies nothing.** |
| `/api/dashboard` `openOrders` (`dashboard/route.ts:25`) | computed on every call; the only consumer reads just `systemHealth` and `webhooks` — never rendered |

What the admin cards actually render:

| month | "Open" card | "In Process" card | orders created |
|---|---|---|---|
| 2026-08 | **0** | 49 | 50 |
| 2026-07 | **0** | 968 | 1,018 |
| 2026-06 | **0** | 1,019 | 1,096 |
| 2026-05 | **0** | 812 | 1,524 |
| 2026-04 | **0** | 1,133 | 2,879 |

The `verify_sync` one is the most dangerous of the three, because it looks like coverage.
A daily "verify order sync" job that reports success while examining 2 of 6,612 orders is
worse than no job at all — it is a coverage gap wearing a green check.

---

## 9. Recommendations

**Fix — urgent:**

1. **Give the sync a look-back window.** `handleSyncOrders` already accepts
   `dateFrom`/`dateTo`; the cron simply never passes them. A second daily cron calling it
   over a trailing 90–180 days would cover exactly where the drift lives, using code that
   already exists. No schema change. **Measure `GetOrders` over a wide range first** — my
   bulk `GetOrderDetails` pull over 3–4 month windows aborted at 180s on all four windows
   tried, so the wide-window call needs its own timing check before anyone schedules it.
   Counting the rows it changes on first run also gives the exact staleness number.
2. **Fix or delete `handleVerifyOrderSync`.** Pointing it at `in_process` instead of `open`
   would turn a daily no-op into the drift detector this spike had to do by hand.

**Fix — cheap:**

3. **The "Open" card.** Drop it or fold it into "In Process". It is structurally always 0.

**Do not fix:**

4. The ~160-order never-cancelled tail is real business data. Cancelling those files is an
   ops decision inside SoftPro, not a code change.

**Which metrics should avoid this field until (1) lands:**

- Anything claiming to count **active work right now** — pipeline tiles, workload counts,
  the client portal's "active orders". Inflated by roughly 1,000 orders.
- Prefer `closed_at` / `completed_at`-driven definitions; those columns are fully populated
  for terminal rows and are not subject to the refresh gap.
- The CRM health snapshot already withholds its open-order count. On this evidence that
  remains right — and the count should stay unrendered until the look-back sync ships.
- **Gone-quiet and momentum are safe to build**: both key on `opened_at` recency and order
  counts, neither of which depends on `operational_status`.

---

## Appendix — method

- All figures from production, read-only.
- SoftPro comparisons use raw `fetch`, not our client wrapper, so no `vendor_api_logs`
  rows were written.
- The bulk approach (pull whole date ranges, diff wholesale) was tried first and abandoned:
  `GetOrderDetails` over 3–4 month windows aborted at 180s on all four windows. The
  stratified per-order sample is the fallback.
- One sampling run wedged after ~150 rapid sequential calls, consistent with SoftPro-side
  throttling; the rerun used a 15s timeout, a 400ms delay between calls, and incremental
  writes so partial results survive.
