# Refreshing contacts on orders nothing re-reads

**Design. No code yet.** Opened 2026-09-15.

## The population

`softpro.enrich_orders` (every 15 minutes, 25 orders a run) only selects an
order while something is *missing* — no lender/listing agent/title
company/underwriter at all, no client, or no party rows. Once an order has
those, enrich never reads it again. Whatever SoftPro changes on it afterwards —
a new lender, a replaced escrow officer, a corrected buyer — never reaches us.

Measured 2026-09-15:

```
orders                                          8,737
active (open, in_process)                       4,775
active and never re-selected by enrich          4,069   <- this design's population
active, contacts not read in 7 days             4,041
active, contacts not read in 30 days            3,239
completed (not in scope, see open questions)    2,339
```

**The 3,650 could not be reproduced** under any of these definitions. This design
uses 4,069 and states it so the number can be argued with.

## What already exists, and is reused

- **`softpro.verify_sync`** (daily 06:00) is a *read-only status* drift detector:
  it samples 40 `in_process` orders, calls SoftPro three at a time with a 30s
  per-call cap and 250ms spacing, and records counts on its own `jobs` row. It
  writes no order data, deliberately — "conflating detect with fix is what makes
  a broken detector invisible". This design is that pattern, for contacts.
- **`verifySingleOrder` / `reconcileParties`** is the on-demand party reconciler
  behind the verify-sync button. It **overwrites** (through
  `protectConfirmedPartyFields`). Its comparison surface — buyer/seller primary
  and secondary, lender, escrow company, title and escrow officer — is the one
  this design compares, so "differs" means the same thing in both places.
- **`protectConfirmedPartyFields`**: a field a named human confirmed through the
  party wizard is frozen against every parser. That invariant decides how a
  difference on a confirmed field is classified (below).
- **No drift table exists.**

## How often

**Every active order re-read once every 7 days, oldest first.** 4,069 / 7 ≈
**580 orders a day**, +25% on the ~2,319 GetOrderContacts calls a day made now.

This is a starting cadence, not a conclusion. The first two weeks exist to
measure how often contacts actually change, by order age band (0-7, 8-30, 31-90,
90+ days open); if young orders drift and old ones do not, the cycle splits by
age rather than getting faster for everyone.

## How it is paced

**Not against 67 seconds a page.** That is `GetLookuptable`, the contact
directory. This reads `GetOrderContacts`, one call per order. Measured over the
last 7 days (16,234 calls):

```
p50 2.0s   p95 3.7s   p99 32.5s   max 60.0s (the client timeout)   failed 280 (1.7%)
```

- A new job, **`softpro.verify_order_contacts`, hourly, 30 orders a run** —
  720/day of capacity against 580 needed, so failures and slow days still keep
  up with the cycle.
- Same safeguards as `verify_sync`: **concurrency 3, 250ms launch spacing, 30s
  per-call cap** (8x normal p95), plus a `createDeadline` budget sized on that
  31s unit, so one hung call cannot take a run past the 300s ceiling.
- **Its own timestamp, `orders.last_contacts_verified_at`**, so it does not move
  enrich's staleness gate, and enrich does not move it.
- **Skips an order enrich read in the last hour**, so the two never call SoftPro
  for the same order back to back.
- **Single flight** on its own job type, like enrich.

## When SoftPro differs from us

**Phase 1 records and never writes.** No update to `order_parties`, no update to
`orders`. A test asserts it.

**`order_contact_drift`**, one row per open difference:

```
order_id, role, is_primary, field
kind          party_added | party_removed | party_changed | officer_differs | lender_differs
ours, softpro
confirmed_locally   the field is latched by party_confirmed_at
first_seen_at, last_seen_at, times_seen
resolved_at, resolution   (filled when a later read agrees, or a human acts)
```

- **One open row per (order, role, is_primary, field).** A difference seen every
  week updates `last_seen_at` and `times_seen`; it does not create 52 rows a year.
- **A later read that agrees closes the row** (`resolution = 'converged'`) — so
  SoftPro catching up to us, or us to SoftPro through some other path, is
  visible as a resolution rather than as a disappearance.
- **Normalised before comparing**, or the rate is noise: trim and collapse
  whitespace; case-insensitive for names, companies and emails; digits only for
  phones.
- **A blank SoftPro value is not a difference.** SoftPro omitting a field means
  "not provided", which is how every writer already treats it (`omitEmptyForUpdate`).
- **A difference on a confirmed field is recorded with `confirmed_locally = true`
  and kept out of the headline rate.** The human's word wins by invariant; what
  is worth seeing is how often SoftPro disagrees with it, not a proposal to
  overwrite it.
- **Per-run counts on the job's own row** (checked, unchecked, with drift, by
  kind, by age band), the way `verify_sync` does, so the Operations panel can
  trend the rate without querying the table.

## Phase 2 — decided from the data, not built now

After two weeks, per `kind`: apply automatically, propose to an operator, or
ignore. The expectation to test, not assume: `party_added` (SoftPro has a
lender we lack) is safe to apply; `party_changed` on a confirmed field never is;
an officer change should apply but keep the previous value.

## What this does not do

- Does not change enrich, `verifySingleOrder`, or any existing writer.
- Does not read the contact directory, and is unaffected by the lookup-table
  latency the resumable sync handles.
- Does not backfill anything or write party data in phase 1.

## Open questions for Gerard

1. **Which population is the 3,650?** If it is narrower than 4,069 — say, active
   orders with a delivery still ahead — the cycle can be faster for the same
   call budget.
2. **Include completed orders (2,339)?** Some still have policies and recording
   ahead of them; contacts on those matter for delivery.
3. **Is a 7-day starting cycle acceptable**, knowing it adds ~25% to
   GetOrderContacts volume?

## How we will know it works

- Within 7 days of shipping, every active order has `last_contacts_verified_at`
  inside the last 7 days.
- `order_contact_drift` holds rows with a per-kind rate, and the job rows show it
  trending.
- No `order_parties` or `orders` write attributable to this job.
