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

**The 3,650 is withdrawn** (Gerard, 2026-09-15): it came from an earlier
measurement nobody can reproduce, and is not to be reconciled. The measured
figures above are what this design uses.

**Completed orders are in scope** (Gerard, 2026-09-15). Policies are delivered
after closing, so a completed order with a stale escrow contact sends a title
policy to the wrong firm — the Green Forest failure, on the document that
matters most. The cycle population is therefore **6,348**: open, in_process and
completed orders that enrich never re-reads.

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

**Every in-scope order re-read once every 7 days, oldest first.** 6,348 / 7 ≈
**907 orders a day**, +39% on the ~2,319 GetOrderContacts calls a day made now.

A weekly sweep narrows the window; it does not close it. An order swept on
Monday and delivered on Friday is four days stale at the moment that matters.
**The pre-send refresh below is what closes it, and is the more important half
of this design.**

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

- A new job, **`softpro.verify_order_contacts`, hourly, 45 orders a run** —
  1,080/day of capacity against 907 needed, so failures and slow days still keep
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
- **`contacts.updated_at` cannot be used as a change signal.** The company syncs
  restamp every row they match whether anything changed or not — 2,585 contact
  rows on 2026-09-15 alone (`COMPANY_SYNC_RESTAMPS_UPDATED_AT.md`), and they
  report those rows as `updated`. Drift is measured by comparing values, never
  timestamps, and the rate must not be derived from `updated_at` or from a
  sync's own `updated` count.
- **Per-run counts on the job's own row** (checked, unchecked, with drift, by
  kind, by age band), the way `verify_sync` does, so the Operations panel can
  trend the rate without querying the table.

## Refresh immediately before we send (Gerard, 2026-09-15)

**"One call, two seconds, right when it matters."** Before a send that goes to an
order's own contacts, re-read that order's contacts from SoftPro. A 2.0s median
call, against a document that cannot be unsent.

The sends that go to order contacts, and what a stale contact costs each:

| Send | Resolves recipients through | A stale contact sends to |
|---|---|---|
| Prelim delivery (auto and manual) | `resolvePrelimRecipients` — escrow officer FK, else the `escrow_company` party row | the wrong escrow firm |
| Order confirmation | `loadRecipientEmails` plus the client contact | the wrong client |
| `notification_types` dispatch — `order.closed`, document ready, and policy delivery when it ships | `resolveRecipients` over officer FKs and party rows | the wrong firm, on a policy |
| Party wizard invite | the same two-step escrow recipient | the wrong firm |

**One place, not four.** All four already funnel through a small number of
recipient helpers, and the refresh belongs in front of those: one function that
takes an order id, re-reads SoftPro, applies the comparison below, and returns
the recipients with any difference attached. Four copies of "refresh before
send" drift, and the direction they drift is a document sent to a stale address.

**THE DECISION THIS NEEDS.** When the pre-send read disagrees with us for the
role being sent to:

- **(a) Send to SoftPro's address**, record the drift. Best chance of reaching
  the right firm; an operator learns afterwards, and a malformed vendor row
  becomes a misdelivery.
- **(b) Hold the send and alert** the open order team with both addresses. No
  wrong delivery, at the cost of a delayed one. Fail-closed, and the same shape
  as the prelim gate, which refuses rather than guesses.
- **(c) Send to ours**, record the drift. Today's behaviour, made visible.

**Recommended: (b) for the prelim and the policy, (a) for the confirmation.**
The first two are the documents a wrong recipient actually harms. A confirmation
to a superseded contact is embarrassing rather than damaging, and holding every
confirmation on a vendor disagreement would stall order opening.

**If SoftPro cannot be reached in time,** send as we would today and record that
the refresh did not happen. A vendor timeout must not block a delivery — that is
the one failure worse than a stale address.

**This is the half to build first.** If only one of the two ships, it is this one.

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

1. ~~Which population is the 3,650?~~ **Answered 2026-09-15:** withdrawn, not to
   be reconciled; use the measured figures.
2. ~~Include completed orders?~~ **Answered: yes** — policies are delivered after
   closing.
3. ~~Is a 7-day cycle acceptable?~~ **Answered: yes**, with the pre-send refresh
   as the part that prevents the harm.
4. **OPEN — what happens when a pre-send read disagrees?** (a) send to SoftPro's
   address, (b) hold and alert, or (c) send to ours. Recommended: (b) for the
   prelim and the policy, (a) for the confirmation.

## How we will know it works

- Within 7 days of shipping, every in-scope order has
  `last_contacts_verified_at` inside the last 7 days.
- Every prelim, policy and confirmation send is preceded by a refresh for that
  order, or by a recorded reason it was skipped.
- `order_contact_drift` holds rows with a per-kind rate, and the job rows show it
  trending.
- No `order_parties` or `orders` write attributable to this job.
