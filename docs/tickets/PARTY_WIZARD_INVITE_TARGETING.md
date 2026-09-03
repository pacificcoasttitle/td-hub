# The party wizard invite asks about a party that cannot exist

Ticket. Investigation only — nothing implemented, nothing enabled, nothing sent.

All numbers below are read-only measurements against production on 2026-08-26.
`party_wizard_invite_enabled` is unset, `notification_logs` holds 0
`party_wizard.invite` rows, and `party_wizard_submissions` is empty. Nothing in
this document changed that.

**The candidate query does not filter on `transaction_type`.** It asks for a
listing agent on every order it can reach, and on a refinance there is no listing
agent to name. Production agrees with that structurally: across 3,575 refinance
orders there are 25 `listing_agent` party rows and 10 `seller` rows.

## How to re-derive any number here

Every figure below comes from replaying the shipped `loadCandidates` predicate in
SQL rather than running the job. The replay generates one "run" per day over a
`generate_series` of the last 41 days, applies the same four predicates
(`operational_status in ('open','in_process')`, `opened_at` between `t - 3 days`
and `t - 7 days`, no usable `listing_agent`, no prior `party_wizard.invite`
notification), then reproduces `planSends` in window functions: property key =
`upper()` with `[^A-Z0-9]+` collapsed to spaces and a length floor of 6,
deduplicated by `row_number() over (partition by pkey order by order_id)`, then
capped at 2 per recipient email in the same order.

The replay is exact for any historical date because production has never sent an
invite — `notification_logs` holds 0 `party_wizard.invite` rows, so the per-order
suppression and the 60-day property lookback are both no-ops. The only drift is
in the underlying order and party rows, which change as SoftPro syncs.

## The number that matters is not the one in the audit

The prior audit reported 61.4% refinances over ~4,611 candidates. That is the
right direction and the wrong denominator — it counted orders in *enrichable*
statuses with no listing agent, not the set this job actually scans. Replaying
the real `loadCandidates` predicate once per day for the last 41 days:

| Stage | Rows over 41 simulated runs | Refinance share |
| --- | --- | --- |
| Candidates returned by `loadCandidates` | 4,197 | 53.8% |
| Reachable (escrow officer with an email) | 482 | **83.0%** |
| `would_send` after dedupe + cap | 222 | — |

The raw candidate set is roughly balanced (53.8% refi / 44.8% purchase). The
*send* list is 83% refinance. The transaction-type miss and a second, separate
problem compound: **Purchase orders are 5.6% reachable, refinances 19.8%** (active
orders opened 3–30 days ago, n=847). Filtering to Purchase alone therefore does
not merely trim the list — it lands on the cohort where escrow-officer resolution
is worst.

## The corrected funnel

Successive filters, as of 2026-08-26:

| # | Filter | Count |
| --- | --- | --- |
| 1 | All orders | 7,414 |
| 2 | Purchase only | 3,553 |
| 3 | …no usable `listing_agent` row | 1,795 |
| 4 | …still active (`open`/`in_process`) | 1,123 |
| 5 | …opened 3–30 days ago | 311 |
| 6 | …escrow officer with a real email | **18** |
| 7 | …after property dedupe | 15 |
| 8 | …after the 2-per-recipient cap | **6**, to 3 recipients, 9 held for later runs |

At the shipped 7-day window (`PARTY_INVITE_MAX_AGE_DAYS = 7`) step 5 is 25 and
step 6 is 2. The 30-day figure is the defensible target set; the 7-day figure is
what the job would actually do today.

## The vetted 22 does not survive

The approved dry run showed 22 sendable candidates resolving to internal PCT
escrow officers. That is the *reachable* count — replaying the pipeline for
2026-08-25 and 2026-08-26 reproduces exactly 22 both days.

| | Reachable | Refi | Purchase | Sends after dedupe + cap |
| --- | --- | --- | --- | --- |
| 2026-08-25 | 22 | 18 | 4 | 8 → **3** corrected |
| 2026-08-26 | 22 | 18 | 4 | 8 → **3** corrected |

**18 of the 22 are refinances.** Corrected targeting leaves 4 candidates and 3
actual sends. Over 41 simulated runs the whole-period totals are 222 sends under
current targeting versus 70 corrected — a 68% cut. The pilot as approved is
mostly a pilot of the wrong question.

## Where the filter goes

```232:237:src/lib/jobs/handlers/party-wizard-invite.ts
    .where(and(
      sql`${orders.operationalStatus} in (${sql.raw(statusSqlList(PARTY_INVITE_STATUSES))})`,
      sql`${orders.openedAt} <= NOW() - INTERVAL '${sql.raw(String(PARTY_INVITE_DELAY_DAYS))} days'`,
      sql`${orders.openedAt} >= NOW() - INTERVAL '${sql.raw(String(PARTY_INVITE_MAX_AGE_DAYS))} days'`,
      // No listing agent with anything usable on it.
      sql`NOT EXISTS (
```

One predicate, alongside the status filter — `transaction_type = 'Purchase'`.
`mapTransactionType` in `status-map.ts` already normalises the SoftPro values to
the four-member enum, and 130 orders carry a null `transaction_type`, so the
filter must be positive (`= 'Purchase'`) rather than `<> 'Refinance'`.

### Two other things the query is doing badly by accident

**`.limit(PARTY_INVITE_BATCH)` has no `ORDER BY`.** On 20 of the last 41
simulated run-days the candidate count exceeded 100 (peak 163). Which 100 rows
come back is whatever the planner returns, so the set scanned — and therefore the
dedupe and cap decisions built on it — is not reproducible between the dry run an
operator approves and the live run that follows it.

**The header comment's reachability figure is stale by roughly a factor of five.**
The file says "Only ~54% of orders have an escrow officer email by day 3."
Measured over the same 41 runs, `reachablePct` is **11.5%**. And the split is not
what the counters assume: of 3,715 unreachable candidate rows, **3,715 had no
`escrow_officer_id` at all and 0 had an officer without an email**. The
`escrowOfficerNoEmail` counter has never been able to fire.

## The mirror-image check came back mostly clean

Bounded scan of `src/lib/jobs/handlers/`. Only two handlers send mail:
`party-wizard-invite.ts` and `ops-daily-report.ts` (internal ops digest, no party
role). No other job or resolver targets a party role for outbound contact, so the
targeting flaw is confined to this one file.

Two structural notes fell out of the scan:

- `buyer_agent` and `borrower` are `party_role` enum members with **zero rows in
  the entire table**. `enrich-orders.ts:725–734` is the only writer and it never
  emits either. They are dead enum values, not a data gap — nothing targets them,
  so nothing is currently broken by them.
- `buyer` (5,387 rows) and `seller` (3,431 rows) carry names and **zero email
  addresses**. Any future job that tries to contact a buyer or seller directly
  from `order_parties` will be unreachable 100% of the time.

Separately, `verify-order-sync.ts:254–262` checks buyer, seller, lender and
escrow_company for drift and does not check `listing_agent` or `lender_contact` —
the two roles this feature depends on. Out of scope here, noted so it is not lost.

## The refi ask is real, and it is the lender contact

Refinances are not empty files — they are differently shaped. On the 2,066 active
refinance orders:

| Role present | Orders | Share |
| --- | --- | --- |
| `lender` row | 678 | 32.8% |
| `lender` with an email | 351 | 17.0% |
| `lender_contact` row (mortgage broker / loan officer) | 654 | 31.7% |
| `lender_contact` with an email | 453 | 21.9% |
| **No lender-side email of any kind** | **1,285** | **62.2%** |
| `borrower` row | 0 | 0% |
| `buyer` row (the borrower in practice) | 1,344 | 65.1% |
| `buyer` row with an email | 0 | 0% |

The target role is **`lender_contact`** — the loan officer. It is the one party
on a refi that is both externally contactable and missing most of the time.
`borrower` is not a viable alternative: the enum member exists, nothing writes it,
and the `buyer` rows that stand in for borrowers carry no email addresses at all.

Sized against the same windows the invite job uses: 283 active refinance orders
opened 3–30 days ago have no lender-side email, of which **21 have a reachable
escrow officer**. At the shipped 7-day window that is 28 and 4.

So the refi opportunity is real and it is roughly the same size as the corrected
Purchase opportunity (21 vs 18 reachable at 30 days). It needs its own role form
in `party-wizard-fields.ts` — `FORMS` currently holds `listing_agent` only, and
`getSubmissionSchema` returns null for everything else. Not designed here.

## The reachability ceiling was self-inflicted, and we had already solved it

Both opportunities looked capped by the same upstream problem: **88.5% of
candidates have no `escrow_officer_id`**. That framed officer resolution
(`resolve-order-officers.ts`) as the blocker and a separate ticket.

It was not the blocker. The invite job read `orders.escrow_officer_id` and
nothing else, while **`resolvePrelimRecipients` has read the `escrow_company`
party row as a fallback since the prelim delivery work** — officer FK first, then
the party row's `external_email`, then that party's linked contact. The pattern
was already solved in our own code. This job simply never had it.

Applying that same precedence, on the corrected Purchase-only candidate set:

| Window | Candidates | Reachable, officer FK only | Reachable, with fallback |
| --- | --- | --- | --- |
| Purchase, 7 days | 24 | 2 (8.3%) | **24 (100%)** |
| Purchase, 30 days | 313 | 19 (6.1%) | **298 (95.2%)** |
| Refinance, 7 days | 44 | 16 (36.4%) | **43 (97.7%)** |
| Refinance, 30 days | 413 | 82 (19.9%) | **377 (91.3%)** |

The binding constraint was never the missing FK. It was that we only looked in
one place.

## Two claims in the original investigation were wrong

Recorded rather than quietly corrected, because both changed a decision.

**1. `escrowOfficerNoEmail` is not structurally impossible, only empirically
zero.** The original claim was that the counter can never fire. `contacts.email`
is nullable and nothing enforces that an escrow-officer contact carries one, so
the branch is reachable; it has simply never been taken. Across all 3,842 orders
with an `escrow_officer_id`, **0 point at a missing contact row and 0 at a
contact with a blank email**. That is a true zero, not dead code, so the counter
was kept and documented rather than deleted.

**2. The escrow officer FK does not mean "PCT colleague".** The scoping assumed
the officer FK resolves to an internal officer and only the `escrow_company`
fallback reaches outside firms — so the copy variant could be selected by which
lookup found the recipient. It cannot. Of the 3,842 orders with an officer FK,
**only 701 (18.2%) point at a `@pct.com` address**; the other 81.8% are outside
firms recorded as the officer — escrowforum.com (103), escrowoptions.com (87),
powerhouseescrow.com (86), cornerescrow.com (79). In the other direction, **118
`escrow_company` party rows carry `@pct.com` addresses**.

The consequence is larger than a copy detail: **the invite has been aimed at
external recipients all along, with copy written for a colleague, independent of
the fallback.** The variant is therefore selected by email domain — reusing the
existing definition of internal in `contacts/filters.ts` — and never by
resolution source.

---

## 2026-09-03, Claude — two prerequisites, both found by accident

The wizard's purpose is to put an agent on every order. Two things in the
contact layer make that unsafe today, and **neither was found by looking for
them** — both fell out of investigating a single failed order create.

### 1. Over-length lookup codes block order creation

SoftPro's order endpoint rejects a lookup code longer than ten characters
(`400 "Value must be no longer than 10 characters."`). Their contact endpoint
accepts one, so the code is minted quietly and fails on the first *order* that
names the person.

**154 active contacts carry one**, almost all real estate agents.

We have seen exactly two failures from this in thirty days — because PCT rarely
has a listing or buying agent on a file at all. The landmines are laid and
nobody is walking on them. **The wizard walks the whole team onto them at
volume.** The generator fix (#902df82) stops new ones; it does nothing for the
154 already stored.

### 2. Duplicate contacts break match-then-update

The design is match first, then update anything stale. **1,420 duplicate person
rows** exist (`docs/tickets/DUPLICATE_CONTACTS.md`) — Aashi Narang nine times,
Siyu Guo eight, Victor Wen seven. With nine records for one agent, "match and
update" updates one at random and leaves eight stale. The wizard would then
spread whichever one it happened to pick across new orders.

### 3. And the contact book we match against is 6% complete

Related and worse: the contacts sync has been reading 1,000 rows per type and
stopping (`docs/tickets/SOFTPRO_PAGINATION_TRUNCATES_AT_1000.md`).
`Order Contact - Person` has 15,609 rows in SoftPro; we hold the first 1,000.

So the wizard would be matching against a fraction of the real contact book,
and **failing to match is what creates a new contact** — which mints a new
lookup code, which is how the collisions and the duplicates happen in the first
place. The three problems feed each other.

**These are prerequisites, not parallel work.** Shipping the wizard first would
convert a dormant population into a live one and add to the duplicate pile while
doing it.
