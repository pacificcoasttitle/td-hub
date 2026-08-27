# Orders that were never ingested, and why every check missed them

A sales rep emailed to ask why one of his files was on the old dashboard but not
the new one. Order `20020737-GLT`, 8214 Denbo St, Paramount. It was not stale, not
mis-scoped, and not mis-attributed. It had never been written to `orders` at all.

**Headline: 221 orders across 29 consecutive business days had never been
ingested, affecting 28 sales reps.** Nearly all of them were `in_process` — live
files missing from the reps' dashboards. The recovery is done and the trailing
window now verifies clean, but the reason nothing caught it for six weeks is the
part worth keeping.

## Root cause: a daily guillotine on the sync window

`handleSyncOrders` requested a single day — `dateFrom` and `dateTo` both defaulted
to today:

```ts
const now = new Date();
const dateFrom = payload.dateFrom ?? formatDateForSoftPro(now);
const dateTo = payload.dateTo ?? formatDateForSoftPro(now);
```

`formatDateForSoftPro` reads the **server's** calendar date via `getMonth`/
`getDate`, and on Vercel the server runs in UTC. SoftPro dates orders on Pacific
business time. Those two facts together are the whole bug.

The last hourly run whose UTC date is still `D` fires at 23:00 UTC on `D`, which
is 16:00 Pacific. From 00:00 UTC onward — 17:00 Pacific, with the business day
still going — every subsequent run asks for `D+1`. Nothing ever asks for `D`
again. Any order entered in SoftPro after that boundary was never requested by
any run, ever.

This is not sporadic loss under load. It is a fixed cutoff that fell every single
day, which is why every gap sat exactly on a day boundary.

The evidence is unambiguous. For orders opened 2026-08-06, split by whether we
held them:

| Cohort | Count | Avg hour of `opened_at` | Hour range |
| --- | --- | --- | --- |
| Synced normally | 10 | 0.6 | 0–1 |
| Missing, later recovered | 34 | 20.7 | 15–23 |

On that one day we held 10 of 44 orders. The 34 we lost were the back half of the
business day.

## Why both safety nets were structurally incapable of catching it

`softpro.lookback_sync` and `softpro.verify_sync` both existed to catch exactly
this class of problem. Neither could.

Both **start from `orders`**. The look-back sync selects local rows and re-fetches
them; the drift detector samples `where operational_status = 'in_process'` and
asks SoftPro for each one's current status. Both can find a stale row or a drifted
status. Neither can see a row that was never written.

A check that can only examine what exists cannot detect absence. Two independent
safety nets, both reading from the same side of the comparison, produce two green
checks and zero coverage of the failure that actually happened. This is the sixth
check found in a single day that could not fail in the way it needed to.

The recovery turned up two more of the same shape:

- **`import-orders` reports success while doing nothing.** It was the documented
  tool for a date-range backfill. Run for Aug 6–7 it returned
  `status: completed` and recovered zero orders, because it died at exactly 120s
  on the SoftPro client timeout and `importOrdersFromSoftPro` returns that failure
  inside an `errors` array rather than throwing. The runner does not persist
  handler return values, so the error vanished entirely. Two historical runs from
  2026-05-19 also took exactly 120s and are also marked completed. A repair tool
  that reports success while doing nothing is worse than a blind check.
- **A malformed request body silently becomes an empty payload.** The job route
  does `await req.json().catch(() => ({}))`. A POST with unparseable JSON does not
  400 — it runs the job with default arguments and reports success. During the
  recovery this quietly turned an explicit date range into "today" and produced a
  confident, wrong green.

## Why the gap detector is not built on file numbers

The obvious detector — look for holes in the `file_number` sequence — is a trap,
and measurably so.

File numbers carry branch suffixes (`-GLT`, `-OCT`, `-ONT`, `-PRV`, `-CSS`) and
run in parallel series. The recovery pulled in live orders numbered `99100995`
through `99101048`, an entirely separate series that a `2002xxxx` sequence scan
never looks at. So sequence scanning invents phantom gaps where numbering is
simply not contiguous, and misses real ones in ranges it does not know about.

It also **undercounts**. The sequence analysis predicted 201 missing orders. The
direct comparison recovered 221.

The detector added in `verify_sync` asks SoftPro for its order list over the
trailing window and does a set difference against ours. Direct comparison on the
vendor's own order numbers. No inference.

The one property that matters most: when the vendor call fails or returns an
empty list, `missingCount` is reported as **null, never 0**. A vendor outage
proves nothing about our completeness, and reporting zero there would recreate the
exact false green this detector exists to eliminate.

## Fixed

- **Sync window widened to a trailing 7 days** (`src/lib/jobs/sync-window.ts`).
  Every date is now requested by roughly seven consecutive runs at different UTC
  offsets, so the timezone boundary stops mattering without the two systems having
  to agree on a timezone. Upserts are idempotent, so re-requesting a date costs
  one lookup per already-known order. A `createDeadline` guard was added since the
  window fetches ~7x the rows; stopping early is safe because the window is
  trailing.
- **Ingest gap detector added to `softpro.verify_sync`**
  (`detectIngestGap`). Read-only, like the rest of that job — it reports what is
  missing and lets the sync ingest it. Conflating detect with fix is what makes a
  broken detector invisible. It shares the window constant with the sync, so the
  two cannot drift apart.
- **221 orders recovered** for 2026-07-16 through 2026-08-27. The `2002xxxx`
  sequence went from 201 missing (13.1%) to 0. A live detector run now reports 320
  vendor orders for the trailing window and 320 held, missing 0.

## Still open

- **23 recovered orders carry the wrong `opened_at`.** `GetOrders` returns no open
  date — the mapper sets `openedAt: null` and the insert defaults it to `now()`.
  `enrich_order_details` normally overwrites it from `ReceivedDate`, but for these
  23 SoftPro returned no `ReceivedDate` at all, and they are no longer eligible for
  re-enrichment. All 23 are `closed`, `canceled`, or `duplicate`, and all 23 are
  unattributed, so no rep's numbers are affected — but they will read as opened
  today in any global date-based count. Deciding between null, the vendor's own
  query date, and leaving them is a judgement call, not a cleanup.
- **`enrich_order_details` eligibility does not consider a wrong open date.** It
  gates on missing fields, so a row with a rep and a plausible-but-wrong
  `opened_at` is invisible to it. That is why the 23 above cannot self-heal.
- **30 recovered orders have no sales rep and 48 have no address.** SiteX reports
  no match for some; others have nothing to match on.
- **History before 2026-07-16 is unassessed.** The recovery was bounded by what a
  sequence scan could see, and `20020000` first appears on 2026-07-16 — but orders
  exist back to 2025-03-05 under different numbering, and the today-only window was
  in place for all of it. The loss almost certainly extends further back. Assessing
  it needs a date-range comparison against SoftPro, not a sequence scan.
- **A SiteX write failed on one order** (`20020749-OCT`) with a query error on
  `order_properties` while writing a mobile-home record whose `property_type` was
  `"Mobile/Manufactured Home (regardless of Land ownership)"` — likely a column
  length overflow. Unrelated to this incident but found by it.
