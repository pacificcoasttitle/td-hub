# The contact sync has to resume across runs

**Design. No code yet.**

## The number that forces this

SoftPro takes **~67 seconds to return one page**, measured with no processing of
any kind — no parsing beyond JSON, no database, no writes:

```
page 1  73.4s     page 2  71.8s     page 3  64.2s
page 8  59.8s     page 16 65.9s     average 67.0s
```

`Order Contact - Person` is 16 pages, so a full sweep is **~17.9 minutes**
against a **10-minute** job watchdog. The job cannot finish, and no amount of
work removed from our side changes that.

**Batching was worth doing and does not fix this.** #102 removed ~31,000
database round trips from the loop; a sweep would otherwise be 18 minutes *plus*
that. But the merge should not stand as the fix, and this ticket exists because
it was reported as one before the vendor latency was isolated.

**Smaller pages are worse.** Cost is per-request, not per-row:

```
pageSize  100  ->  81.3s for  100 rows
pageSize 1000  ->  67.0s for 1000 rows
```

`pageSize=5000` returns nothing. So 16 requests is the floor, and the only lever
is how many of them happen per run.

**`modifiedSince` would remove the problem and is ignored.** The endpoint accepts
it and returns the same full page regardless — raised with the vendor in
`docs/vendor-reports/SOFTPRO_LOOKUP_CODE_LENGTH_AND_ORPHANED_ALLOCATION.md`
defect 3. If it is ever honoured, this design becomes unnecessary and should be
removed rather than kept.

## What not finishing costs — measured 2026-09-10

A sync that never completes leaves people SoftPro holds and the hub does not:
**1,476** of them on 2026-09-09. On 2026-09-10 one of them cost four records.

Erika Valencia was in SoftPro as `EriValEscr`, and not in our table — so
there was nothing for Aileen to find. She created her. CreateUser rejected the
code as a duplicate key; the retry minted `EriValEscr1`, eleven characters,
which failed the first order naming her; a second attempt minted `EriValEscr2`.
Two permanent SoftPro records that can never go on an order, cleaned up by hand.

**The contact backfill would have prevented this entirely.** Had this sync
completed, Erika would have been in the hub, Aileen would have picked her, and
none of it would have happened. That is what the gap costs.

Stated precisely, because the same day produced three more duplicates the
backfill would *not* have prevented. Chris Newcomer and Ali Darian were already
in our table, hidden from the picker by their type flags (#123). Sandra Ruiz was
created twice by the hub itself, 46 seconds apart. Those are fixed by #122 and
#123, not by this ticket.

Since #122 the Erika case no longer mints a duplicate: the hub refuses and tells
the operator SoftPro already has the code. That stops the damage. It does not
let the operator pick the person — only a completed sync does.

## The design

**A page budget of six per run.** 6 x 67s ~= 6.7 minutes, leaving ~3 minutes of
headroom inside the watchdog for our processing and for the variance measured
(59-73s). Eight pages would be ~9 minutes and too close to the edge.

**A cursor**, persisted per entity type:

```
sync_cursor
  entity_type      'Order Contact - Person'
  sweep_started_at  when the current sweep began
  next_page         the page the next run should start at
  last_page_seen    the page just completed
  boundary_code     the last lookup code on that page  (see drift, below)
  total_pages       as reported by Pagination.TotalPages on the sweep's first run
```

**A run**: read `next_page` through `next_page + 5`, process each, advance the
cursor after **each page** rather than at the end — so a failure costs one page,
not the run. When `next_page > total_pages`, the sweep is complete: record the
finish, reset `next_page` to 1 and start a new sweep on the next run.

**Cadence.** 16 pages at 6 per run is 3 runs. Hourly, that is a **full refresh
every three hours**, with every run finishing inside its window.

## Page drift, and why it is survivable

A sweep spanning three hours reads page 1 and page 16 two hours apart. If rows
are inserted meanwhile, can a contact shift across a boundary and be skipped?

**Measured, rather than assumed.** Reading page 1, then page 2, then page 1
again:

```
page 1 re-read      identical order: true   same set: true
rows on both pages  0
page 1 sorted by lookup code?  true
page1.last <= page2.first?     true    (AngMofEscr < AngMonTheA)
```

So paging is **offset over a deterministic sort by lookup code** — stable,
non-overlapping, ordered. Not an unsorted offset scan, which would have been
much worse.

**The residual risk is bounded.** A row inserted with a code sorting *before*
the cursor shifts everything after it right by one, so the row sitting on a page
boundary moves back into a page already read and is missed **for that sweep**. A
row inserted after the cursor is picked up normally.

**Repeated full sweeps heal it.** A row missed in one sweep is read in the next,
three hours later, unless another insertion shifts it again at exactly the wrong
moment. Nothing is lost permanently; a contact is at worst a few hours late.
Contact data tolerates that — this is a directory, not a ledger.

**And drift is detectable, cheaply.** Store `boundary_code` — the last lookup
code of each completed page. On the next run, before processing page N+1, check
that its first code still sorts after the stored boundary. If it does not, rows
shifted; re-read the previous page. One string comparison per page, and it turns
a silent miss into a corrected one.

## What this must not do

- **Not raise the watchdog.** 18 minutes does not fit in 10, and a longer limit
  would hide the vendor latency rather than accommodate it. The watchdog is the
  thing that made this visible.
- **Not shrink pageSize.** Measured: smaller pages cost more.
- **Not skip pages to fit.** A sweep that never reads pages 13-16 silently holds
  a stale tail forever.

## How we will know it works

Not "CI passes" and not "a job says completed" — the runs that report completed
today take 0.0s and fetch nothing, which is how this went unnoticed for five
days. The check is:

```
a run that fetched 6 pages, finished inside the watchdog, and advanced
the cursor — followed by two more that complete the sweep
```

Three consecutive runs, cursor reaching total_pages, and the row count in
`contacts` for that type reconciling against `Pagination.TotalRows`.

---

## Built — 2026-09-15, with four corrections to this design

**1. The ceiling is 300 seconds, not ten minutes.** The job route has
`maxDuration = 300`, and Vercel kills the function there; the ten-minute
watchdog only reaps the row afterwards. Six pages at 67s is 402s. The page
budget is therefore the clock, via `createDeadline('softpro.sync_contacts_page')`:
a page is allowed 125s (the 120s fetch timeout plus processing), which leaves a
145s budget, so a run normally starts **three** pages. Six remains a hard cap.
A full person sweep is about six hourly runs, roughly six hours, not three.

**2. The client aborted every page at 60 seconds.** `getLookupTable` had
`AbortSignal.timeout(60_000)`; pages take 65-95s (all 16 person pages read on
2026-09-15: average 70.8s, max 95.4s). That, not only the sweep length, is why
the person sync last completed on 2026-09-03 — and why lender, title officer,
escrow officer and underwriter were failing too. Raised to 120s
(`LOOKUP_PAGE_TIMEOUT_MS`).

**3. The page-drift note had the direction backwards.** An *insertion* before
the cursor shifts rows right: the previous page's last row reappears first on
the next page — a harmless re-read, which the boundary comparison detects and
counts (`boundaryShifts`). A *deletion* before the cursor shifts rows left: one
row moves back into a page already read and is skipped for that sweep, and no
comparison of codes can see it. What can be seen is `Pagination.TotalRows`
falling during the sweep, so that is recorded (`drift_suspected`) rather than
re-read. The next sweep reads the skipped row.

**4. The gap this ticket quoted was not 1,476.** Read in full on 2026-09-15 and
matched the way the sync matches (exact `lookup_code`, rows with an email):
**70** SoftPro people are missing, all 70 have an email, none collide by case.
On 2026-09-09, by the same key, the gap was **91**. The 1,476 could not be
reproduced against `lookup_code`, `softpro_lookup_code` or both, and the scan
that produced it did not record its key. A completed sweep inserts all 70, so
**no backfill is needed.**

Also found and fixed: 3 SoftPro person codes existed here only as inactive
rows, and the sync compared every field except `is_active`, so it counted them
unchanged and never reactivated them. `isActive` is now a compared field.

**What shipped.** Migration 0050 adds `next_page`, `total_pages`,
`sweep_started_at`, `sweep_total_rows`, `last_sweep_completed_at` and
`drift_suspected` to `contact_sync_state`; `cursor_lookup_code` is the boundary
code. The cursor is saved after every page. A failed page puts no cooldown on
the retry. A run that started within the function ceiling owns its entity type
(the per-type cron and `softpro.sync_all_contacts` can both reach one). Sales
Rep stays a single request — it is not paged, and the deactivate guard needs the
whole roster at once.

**How we will know it works — unchanged, and not yet met:** runs that each read
pages and advance `next_page`, reaching `total_pages`, `last_sweep_completed_at`
stamped, and `contacts` for that type reconciling against TotalRows — plus
PLML5446 arriving from the lender sweep and the 70 missing people arriving from
the person sweep.
