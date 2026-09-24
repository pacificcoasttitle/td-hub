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

**DECIDED (Gerard, 2026-09-16): send to SoftPro's address, always. No hold
queue.** SoftPro is the system of record, so when the two disagree its address
is the right answer, not the risky one.

| The pre-send read | What happens |
|---|---|
| Agrees with ours (the person's or the firm's email) | send to it; close any open drift row as `converged` |
| Differs | **send to SoftPro's address**; record the disagreement and alert, regardless |
| SoftPro holds no email for that recipient | **do not substitute ours.** The existing fail-closed path: unresolved, internal alert, no send |
| SoftPro cannot be reached | retry once, then send as today, and record that the refresh did not happen |

My recommendation was hold-and-alert for the prelim and the policy. It was
overruled: a hold queue depends on somebody working it, and SoftPro's address is
the correct one.

**Built and merged: #143, migration 0052, 2026-09-16.**

- `pre-send-refresh.ts`: one `GetOrderContacts` call per send, 15s cap, retried
  once. The decision is a pure function. Recording never blocks a send.
- **Prelim delivery**, automatic and manual, after the content gate. "Has none"
  becomes `blocked_no_recipient` on the automatic path and a 409 on the manual
  route.
- **Policy delivery**: escrow TO and lender CC for the lender's policy, the owner
  for the owner's policy, escrow for the supplement. "Has none" on a required
  role fails closed and names the role. Policy delivery is off in production.
- `order_contact_drift` (0052) and the internal `order.contacts.drift` alert.
- Unreachable: an `admin_activity_logs` row, action `pre_send_refresh_unavailable`.

**As built, the table is narrower than the sweep below needs.** It has `kind` =
`differs` | `softpro_has_none`, `source` = `pre_send`, and `send_kind`, but no
`is_primary` or `confirmed_locally`. The weekly sweep adds those columns and its
own kinds; the open-row index then widens to include `is_primary`.

**Measured before building.** The 39 orders that got a prelim in the 30 days to
2026-09-16, against SoftPro that day: 35 agree, 4 differ (three a different
escrow firm), 0 where SoftPro has no email. That compares SoftPro now with the
address used then, so it is about 10% drift, not four wrong sends.

**The order confirmation is not wired, and will not be (Gerard, 2026-09-16).** The 60
most recent confirmed orders, against SoftPro:

| Role | What the rule would do |
|---|---|
| Escrow | **53 of 60:** we hold no escrow recipient and SoftPro does, so the rule would **add** one. **2 of 60:** confirmed within two minutes of creation, before SoftPro had the escrow person, so the rule would **drop** ours. |
| Listing agent | 8 SoftPro-only (adds), 0 disagreements |
| Buyer's agent | never present |

On the confirmation the rule corrects no wrong addresses, so there is nothing
for it to prevent. What it would do is add a recipient to most confirmations and
hold two that send fine today. Who PCT copies on its confirmations is a business
decision to make deliberately, not a side effect of a drift guard.

**What the 53 actually are.** 58 of the 60 are Title only orders, where PCT has no
escrow officer; SoftPro's `EscrowCompanies` contact there is the *outside* escrow
firm. So this is not a missing PCT escrow officer. PCT's own escrow officer is
well covered: of 158 Title & Escrow / Escrow only orders in a 7-day
`GetOrderDetails` pull that we hold, 155 carry the same officer as SoftPro's
`EscrowOfficerContact`, 2 a different one, 1 none.

The gap the sample exposed is different and is tracked separately: 48 of the 58
had no `escrow_company` party row at all, because orders created in the hub
(`source = manual_entry`, the main creation path since 2026-08-31) are never
picked up by `softpro.enrich_orders`. Its selector only takes orders with no
parties, no client contact, or none of the four company FKs, and a hub-created
order is born with all three. 482 orders had never had their contacts read from
SoftPro as of 2026-09-16.

## Could `modifiedSince` replace the 7-day rotation? Deferred (2026-09-16)

`GetOrderDetails` now accepts `modifiedSince`, which would let the sweep re-read
only the orders SoftPro changed since the last run instead of cycling all of
them. **That only works if an order's `ModifiedDate` moves when its contacts
change, and that is not yet known.** Deferred by Gerard: it decides how efficient
the measurement job is, not whether a wrong send is prevented, and the pre-send
refresh already covers the harm. Build the sweep as designed above; revisit this
when someone can run the test slowly.

**The test, when it runs.** Snapshot `GetOrderContacts` for the active orders,
wait a business afternoon, snapshot again, and pull every order modified in
between. Any contact change on an order whose `ModifiedDate` did not move means
`modifiedSince` cannot replace the rotation. A first attempt on 2026-09-16 was
abandoned half-way: a firewall blocked the workstation after 523 of 1,143 reads
(AGENTS.md, "Bulk reads of a vendor"). Give it a stated rate and ceiling.

**Already measured about the endpoint, 2026-09-16** (so nobody re-derives it):

- The request needs the legacy parameters present and empty, or it returns 400:
  `?modifiedSince=YYYY-MM-DDTHH:MM:SS&DateFrom=&DateTo=&OrderNumber=&Page=1&pageSize=100`.
- `pageSize` is capped at 100. Pages took 23–30s each. The trailing 7 days were
  1,404 changed orders over 15 pages, about 200 a day.
- `ModifiedDate` is **UTC**, and `modifiedSince` is **inclusive, to the second**.
- Rows come back **oldest change first**. An order edited mid-pull moves to the
  end, and every later row shifts up a slot, so **page-number paging skips rows**:
  in one 7-day pull 4 orders came back twice and 2 orders modified before the pull
  started (20022151-GLT, 20022230-OCT) never came back at all. Page by keyset
  instead: always `Page=1`, with `modifiedSince` set to the last `ModifiedDate`
  seen, de-duplicating by order number.
- The response now carries `LoanAmount`, `PrimaryContact`, `TitleOfficerContact`,
  `SalesRepContact` and, on Title & Escrow and Escrow only orders,
  `EscrowOfficerContact` (with lookup code). `EscrowOfficer` and
  `EscrowOfficerContact` are omitted, not empty, when an order has no PCT escrow
  officer. It has no escrow company, lender, buyer or agent: those still need
  `GetOrderContacts`.
- It is also what the order sync needs: of 1,265 orders changed that week that
  we hold, 230 (18%) had moved status in SoftPro while we still showed the old
  one, 181 of them older than the sync's 7-day window. Not yet taken up.

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
4. ~~What happens when a pre-send read disagrees?~~ **Answered 2026-09-16:** send
   to SoftPro's address, always, with no hold queue. Record and alert regardless.
   SoftPro has none: do not substitute ours, fail closed. Unreachable: retry once,
   send as today, record it. Built in #143.
5. ~~Should the order confirmation get the same refresh?~~ **Answered 2026-09-16:
   no.** Zero wrong addresses corrected; adding the escrow contact to 53 of 60
   confirmations is a change to who PCT copies, which is decided on its own.

## How we will know it works

- Within 7 days of shipping, every in-scope order has
  `last_contacts_verified_at` inside the last 7 days.
- Every prelim and policy send is preceded by a refresh for that order, or by
  a `pre_send_refresh_unavailable` row saying it did not happen. The
  confirmation is out of scope (question 5).
- `order_contact_drift` holds rows with a per-kind rate, and the job rows show it
  trending.
- No `order_parties` or `orders` write attributable to this job.
