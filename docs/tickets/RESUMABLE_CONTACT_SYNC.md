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
