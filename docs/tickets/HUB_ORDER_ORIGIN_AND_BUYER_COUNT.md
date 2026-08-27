# The 73% missing-buyer figure is not about hub-created orders

Read-only reconciliation. Nothing here changes behaviour.

**The hub has created 8 orders in its lifetime and every one of them is a
Refinance. There has never been a hub-created Purchase — not in the last
fourteen days, not ever.** So "172 of 235 hub-created purchases have no buyer"
cannot be describing hub-created orders. The 235 is the count of *all* purchase
orders opened in a fourteen-day window, and all of them were pulled in from
SoftPro by the sync job.

The corrected statement:

| Quoted | Actual |
| --- | --- |
| 172 of 235 hub-created purchases, 14 days, no buyer | **0 of 0** — no hub-created purchase exists |
| — | 178 of 250 **SoftPro-synced** purchases opened in the last 14 days have no local buyer party row (71.2%) |

The 73% is a real, reproducible number about a real gap. It is a gap in what the
**sync pulls in from** SoftPro, not in what the hub **pushes out to** SoftPro.
The direction is reversed, and the conclusion drawn from it — that the hub form
is where a buyer identity fails to originate — does not follow from this
measurement. Those 178 orders were never touched by the hub form; they were
created in SoftPro and read into the database.

The hub form bug the figure was attached to **was real** and is fixed
(`4706c48`, 24 Aug 2026 12:53 -0700, in `main`). It has simply never produced a
single row of data, because no Purchase has ever been opened in the hub.

Everything below was measured against production at **2026-08-27 05:15 UTC**.
The counts move: new orders arrive continuously and the sync backfills buyer
rows onto orders that had none. Re-running these queries later will not
reproduce these exact integers, and that is the point of §3.

## 1. What actually marks an order's origin

`orders.source` — an `order_source` enum, `NOT NULL`, defaulting to
`'softpro_sync'`. Confirmed live in `information_schema`, not just in
`src/lib/db/schema/orders.ts`.

```sql
-- Q1
select source, is_imported, count(*)::int as orders,
       count(created_by)::int as with_created_by,
       min(opened_at) as first_opened, max(opened_at) as last_opened
from orders
group by source, is_imported
order by orders desc;
```

| `source` | `is_imported` | `created_by` set | Orders | First opened | Last opened |
| --- | --- | --- | --- | --- | --- |
| `softpro_sync` | `true` | 0 | **7,428** | 2025-03-05 | 2026-08-27 |
| `manual_entry` | `false` | 8 | **8** | 2026-03-26 | 2026-08-25 |

Three columns say the same thing and none of them disagrees with the others:

- `source` — written `'manual_entry'` by `create-order.ts:262`, `'softpro_sync'`
  by `upsert-softpro.ts:71,89,127`.
- `is_imported` — `false` on the create path, `true` on the sync path
  (`mapper.ts:126`). Perfectly correlated with `source`; adds nothing.
- `created_by` — a `profiles` FK, non-null on exactly the 8 and null on all
  7,428. The sync job has no user to attribute.
- `order_status_history.source` — `'manual'` on exactly 8 distinct orders (Q22).

**So the discriminator is reliable.** Use `source = 'manual_entry'`, or
equivalently `created_by is not null`.

Two caveats worth writing down so nobody re-derives them:

- **`web_form` is a dead enum value.** It exists in the type and zero rows carry
  it (Q25). The client-facing wizard funnels through
  `client-wizard-to-create.ts` → `createOrder` → `createLocalRecords`, which
  hardcodes `'manual_entry'`. **The database cannot distinguish an order opened
  in the hub's operator form from one opened in the client wizard.** For the
  present question it does not matter — all 8 were created by one
  `super_admin` profile (Q24) — but any future "client wizard adoption" number
  has no column to stand on.
- **`order_external_refs` is not an origin signal.** It holds 13 rows, all
  Westcor CPL, on a handful of orders. There is no SoftPro order-id ref row to
  test for presence or absence.

The 8, in full:

```sql
-- Q2
select id, file_number, transaction_type, source, is_imported,
       created_by is not null as has_created_by, opened_at, created_at
from orders
where source <> 'softpro_sync'
order by id;
```

| Order | File | Transaction type | Opened (UTC) |
| --- | --- | --- | --- |
| 50 | 20015757-GLT | Refinance | 2026-03-26 02:24:11 |
| 51 | 20015761-GLT | Refinance | 2026-03-26 03:39:17 |
| 4773 | 20018616-GLT | Refinance | 2026-06-09 04:01:51 |
| 4774 | 20018618-GLT | Refinance | 2026-06-09 04:03:36 |
| 6429 | 20020403-GLT | Refinance | 2026-07-29 03:09:34 |
| 6430 | 20020404-GLT | Refinance | 2026-07-29 03:11:07 |
| 7308 | 20021376-OCT | Refinance | 2026-08-25 02:34:03 |
| 7309 | 20021378-GLT | Refinance | 2026-08-25 02:40:37 |

`transaction_type` is `Refinance` on all eight. Across the whole table (Q23),
`manual_entry` has exactly one transaction type and it is not `Purchase`:

```sql
-- Q23
select o.source, coalesce(o.transaction_type::text, '(null)') as transaction_type,
       count(*)::int as orders
from orders o
group by 1, 2
order by 1, orders desc;
```

| `source` | Type | Orders |
| --- | --- | --- |
| `softpro_sync` | Refinance | 3,579 |
| `softpro_sync` | **Purchase** | **3,563** |
| `softpro_sync` | Other | 156 |
| `softpro_sync` | (null) | 130 |
| `manual_entry` | Refinance | **8** |
| `manual_entry` | **Purchase** | **0** |

## 2. Re-deriving measurement A

### The query that produces the 73%

```sql
-- Q3: population = every order with transaction_type 'Purchase' whose
-- opened_at falls in a rolling 14-day window. No origin filter.
with win as (
  select o.id from orders o
  where o.transaction_type = 'Purchase'
    and o.opened_at >= now() - interval '14 days'
),
b as (
  select w.id,
         count(p.id) filter (where p.role = 'buyer')::int as buyer_rows,
         count(p.id) filter (
           where p.role = 'buyer'
             and (p.external_name is not null and btrim(p.external_name) <> '')
         )::int as named_buyer_rows
  from win w
  left join order_parties p on p.order_id = w.id
  group by w.id
)
select count(*)::int                                     as purchases_14d,
       count(*) filter (where buyer_rows = 0)::int       as no_buyer_row_at_all,
       count(*) filter (where buyer_rows > 0
                        and named_buyer_rows = 0)::int   as buyer_row_but_blank_name,
       count(*) filter (where named_buyer_rows > 0)::int as has_named_buyer
from b;
```

| | |
| --- | --- |
| Purchases opened in the last 14 days | **250** |
| No buyer party row at all — *absent* | **178 (71.2%)** |
| Buyer row present, `external_name` empty or whitespace — *present-but-empty* | **0** |
| Buyer row with a name — *present-with-a-value* | 72 |

The same query split by origin (Q4) returns **one row**: `softpro_sync`,
250 / 178 / 0 / 72. There is no `manual_entry` row because there are no
`manual_entry` purchases to group.

**"Empty borrower field" is also the wrong description of the state.** Nothing
in this population has a blank buyer name. The row does not exist. Zero of
5,404 buyer rows in the entire table have a null or whitespace `external_name`.
Whatever produced the phrase "empty borrower field", it was not this column.

### Where 235 comes from

235 is a plausible value of the same all-purchases query taken a few days
earlier. Rolling the anchor back one day at a time (Q6):

```sql
-- Q6
select to_char(anchor, 'YYYY-MM-DD') as anchor_utc,
       count(o.id)::int as purchases_14d,
       count(o.id) filter (
         where not exists (select 1 from order_parties p
                           where p.order_id = o.id and p.role = 'buyer')
       )::int as no_buyer_row
from generate_series(now()::date - 21, now()::date, interval '1 day') as anchor
left join orders o
  on o.transaction_type = 'Purchase'
 and o.opened_at <  anchor + interval '1 day'
 and o.opened_at >= anchor + interval '1 day' - interval '14 days'
group by anchor
order by anchor;
```

`purchases_14d` ranges from **212 to 250** across the last three weeks. Q16
walks the anchor hourly and reconstructs the buyer-row count *as it stood at
that instant* (`p.created_at <= anchor`): **235 purchases occurs at 2026-08-20
23:17 UTC, with 173 lacking a buyer row.** 172/235 = 73.2%.

That is a match to within one order, on a population of all purchases
regardless of origin. It is not reachable on any hub-scoped population, because
that population is empty.

The reconstruction is approximate and should not be quoted to the unit: the
read-back merges party values field by field and can update an existing row
rather than insert one, and the sync can revise `opened_at`. It is enough to
establish which population the number came from, not to pin the exact minute it
was taken.

### The window is not the disagreement

```sql
-- Q5 (abbreviated)
select count(*) filter (...) from orders o where o.transaction_type = 'Purchase'
  and o.opened_at >= now() - interval '14 days';   -- and the created_at / 7d / 30d variants
```

| Window definition | Purchases | No buyer row |
| --- | --- | --- |
| `opened_at >= now() - 14 days` | 250 | 178 |
| `created_at >= now() - 14 days` | 250 | 178 |
| `opened_at >= now() - 7 days` | 129 | 91 |
| `opened_at >= now() - 30 days` | 511 | 360 |

`opened_at` and `created_at` give identical counts, so the two agents cannot
have disagreed on that. No window definition brings the hub population anywhere
near 235, because no window contains a hub purchase.

## 3. Re-deriving measurement B

```sql
-- Q7
select o.id, o.file_number, o.transaction_type, o.opened_at,
       count(p.id)::int as party_rows,
       count(p.id) filter (where p.role = 'buyer')::int  as buyer_rows,
       count(p.id) filter (where p.role = 'seller')::int as seller_rows,
       count(p.id) filter (where p.role not in ('buyer','seller'))::int as other_rows
from orders o
left join order_parties p on p.order_id = o.id
where o.source = 'manual_entry'
group by o.id, o.file_number, o.transaction_type, o.opened_at
order by o.id;
```

| Order | Party rows | buyer | seller | other |
| --- | --- | --- | --- | --- |
| 50 | 4 | 2 | 1 | 1 |
| 51 | 5 | 2 | 1 | 2 |
| 4773 | 2 | 1 | 1 | 0 |
| 4774 | 2 | 1 | 1 | 0 |
| 6429 | 2 | 1 | 1 | 0 |
| 6430 | 2 | 1 | 1 | 0 |
| 7308 | 2 | 1 | 1 | 0 |
| 7309 | 2 | 1 | 1 | 0 |

**Measurement B is sound on its facts.** Eight hub orders; six with exactly two
party rows. The extra rows on 50 and 51 all postdate the insert — the second
buyer and the `escrow_company` rows were written by the SoftPro read-back on
3 April, and a `lender` row on 27 March (Q8). At insert time every hub order has
had exactly two party rows, which is what `buildPartyInserts` emits.

Two corrections to B's wording, both small but both the kind that has misled
this project before:

- **The timestamps are Pacific, not UTC.** Orders 7308 and 7309 were opened at
  `2026-08-25 02:34:03` and `02:40:37`, and `opened_at` is
  `timestamp without time zone` holding UTC. 24 Aug 19:34 / 19:40 is the
  *Pacific* rendering of those instants.
- **"No operator has ever entered a transaction party" is only true of the
  contact roles.** The two rows on each order are a buyer and a seller, and on
  every one of the eight the buyer name is operator-typed and present:

```sql
-- Q21
select o.id, o.transaction_type,
       (select case
                 when p.external_name is null then 'absent'
                 when btrim(p.external_name) = '' then 'present-but-empty'
                 when upper(btrim(p.external_name)) in ('TBD','TBD TBD') then 'placeholder-TBD'
                 else 'present-with-value'
               end
        from order_parties p
        where p.order_id = o.id and p.role = 'buyer' and p.is_primary
        order by p.id limit 1) as primary_buyer_state
from orders o where o.source = 'manual_entry' order by o.id;
```

All eight: `primary_buyer_state = present-with-value`
(`GERARDO J HERNANDEZ`, `DANIEL TIEU,`, `CHRISTOPHER HAMILTON`, …). All eight:
`primary_seller_state = placeholder-TBD`, which is the `.default('TBD')` in
`createOrderInputSchema` firing because the Refinance form does not collect a
seller. What no operator has ever entered is an escrow company, lender, buyer
agent or listing agent that survived to `order_parties` at insert.

## 4. Why the two disagree

Neither agent measured what its sentence claims, but they fail differently.

**Measurement A ran a query with no origin filter and labelled the result
"hub-created."** Since 7,428 of 7,436 orders are SoftPro-synced, an unfiltered
count is a SoftPro count with rounding error. The `where` clause was
`transaction_type = 'Purchase' and opened_at >= now() - interval '14 days'`;
adding `and source = 'manual_entry'` returns zero rows.

**Measurement B is right about the population and slightly overstated in its
inference.** It filtered on the correct marker; the marker is not the problem.

The causal story attached to A also inverts the data flow. The 178 orders exist
in the database because `enrich-orders` read them out of SoftPro. They have no
local buyer row because the read-back has not yet returned one, not because the
hub sent an empty one. Nothing the hub form does or does not collect can affect
them.

### The hub form bug was real, and it leaves no trace of this shape

Before `4706c48`, `OwnerFields` rendered Seller/Owner only when
`txType === 'Purchase'`; the buyer inputs were behind the refinance branch. The
commit message states the consequence directly: *"Purchase previously collected
seller only, so SoftPro got TBD borrowers."* `purchase-buyer-payload.test.ts`
pins it — pre-fix, `PrimaryBorrowerFirstName` went out as `'TBD'`.

Note what that would look like in this database if it had ever happened. The
create path does not skip the row; `createOrderInputSchema` defaults the name to
`'TBD'` and `buildPartyInserts` writes it. A hub purchase opened before the fix
would carry a buyer row reading `TBD TBD` — **present-with-a-value**, and
invisible to a query that counts missing rows. The two measurements were never
capable of pointing at the same thing.

Placeholder buyers in the whole table (Q18, Q19, Q27): **four rows**, all
`is_primary = false`, all on `softpro_sync` purchases opened Nov–Dec 2025, all
written by the read-back in July 2026. SoftPro itself holds `TBD TBD` as the
co-borrower on those four files. Zero hub-created orders have a TBD buyer. The
eight TBD *seller* rows are the eight hub Refinances described above.

## 5. The correctly-scoped empty-borrower figures

Two different questions were being conflated. Both answers are below.

### a) Orders reaching SoftPro with an empty primary borrower

Judgement: the only orders the hub has ever written to SoftPro are the 8 with
`source = 'manual_entry'`. Everything else went the other way.

| | |
| --- | --- |
| Orders the hub has sent to SoftPro, all time | **8** |
| …that are Purchases | **0** |
| …that sent a `TBD` or empty primary borrower | **0** |
| Opened before the fix commit (24 Aug 2026 19:53 UTC) | 6 — all Refinance, all with a typed borrower |
| Opened after it | 2 (7308, 7309) — both Refinance, both with a typed borrower |

The split uses the commit timestamp; when it reached production is not recorded
in the database. It does not matter — the count of hub purchases is zero on both
sides of any line drawn.

**The before/after comparison the fix asked for is 0 versus 0.** The fix is
correct and worth keeping; it has no historical damage to repair.

### b) Purchases in the database with no buyer on record

Judgement: "no buyer" = no `order_parties` row with `role = 'buyer'`. The
`borrower` enum value exists in `party_role` and has zero rows table-wide
(Q13), so it changes nothing. Population is `source = 'softpro_sync'`, which is
every purchase.

```sql
-- Q9 (all time) and Q12 (aged cohort)
with b as (
  select o.id, o.source,
         count(p.id) filter (where p.role = 'buyer')::int as buyer_rows
  from orders o
  left join order_parties p on p.order_id = o.id
  where o.transaction_type = 'Purchase'
  group by o.id, o.source
)
select count(*)::int as purchases,
       count(*) filter (where buyer_rows = 0)::int as no_buyer_row
from b;
```

| Cohort (all `softpro_sync`) | Purchases | No buyer row | Share |
| --- | --- | --- | --- |
| Opened in the last 14 days | 250 | 178 | 71.2% |
| Opened 15–90 days ago | 1,257 | 848 | 67.5% |
| All time | 3,563 | 2,083 | 58.5% |

This is **not** an ingestion lag that resolves itself. Buyer rows do arrive
late — of 1,507 purchases opened in the last 90 days, 481 eventually got one, on
average 136 hours after opening (Q11) — but 848 of the 1,257 that are already
more than a fortnight old still have none. By status and age (Q20), the gap
persists into `completed` (282 of 788 at 90d+) and `closed` (195 of 424).

Two facts that bound what this can and cannot mean:

- The sync has run against these orders. Of the 178, **zero** have a null
  `last_details_fetch_at` and **zero** a null `last_contacts_fetch_at`; only 5
  carry `contacts_empty_confirmed` (Q10). So they were fetched and no buyer came
  back — this is a mapping or a vendor-side-emptiness question, not an
  unprocessed queue.
- The property record usually knows an owner even when the parties do not: of
  the 250, 217 have a valued `order_properties.primary_owner`, 33 have it
  absent, 0 have it empty (Q14). On a purchase that owner is the *seller* side
  from SiteX, so it is not a substitute for the buyer — but it does mean these
  are real, enriched files, not stubs.

**Not measured here:** whether SoftPro holds a borrower for those 178 and the
hub fails to map it, or whether SoftPro is genuinely empty because the buyer has
not been keyed into the file yet. That needs a read against
`GetOrderDetails` for a sample, which is a vendor call and out of scope for a
read-only database audit. It is the next question and it is the one that decides
whether this is our bug or the normal shape of a freshly-opened purchase file.

## What propagated

The sentence in circulation — *73% of hub-created purchases go to SoftPro with
an empty borrower field, because the hub form had nowhere to enter a buyer* —
joins four claims. Three of them do not survive:

| Claim | Verdict |
| --- | --- |
| The hub form had nowhere to enter a buyer on Purchase | **True.** Fixed in `4706c48`. |
| 73% of purchases have no buyer on record | **True**, of SoftPro-synced purchases. 71.2% today. |
| Those purchases are hub-created | **False.** Zero hub-created purchases exist. |
| Those purchases went *to* SoftPro with an empty borrower | **False.** They came *from* SoftPro. |
| The borrower field is present-but-empty | **False.** The party row is absent; no buyer row anywhere has a blank name. |

The wider argument — that the hub form is the only place a buyer identity can
originate — is not supported by this data either. For 3,563 purchases the buyer
identity originates in SoftPro and reaches us, or fails to, through the
read-back. The hub form has never opened one.

## Reproducing

`scripts/audit/order-origin-explore.ts` (live `information_schema` and enum
checks), `order-origin-reconciliation.ts` (Q1–Q14),
`order-origin-pointintime.ts` (Q15–Q23) and `order-origin-creators.ts`
(Q24–Q27). Read-only; `DATABASE_URL` in the environment; no writes, no vendor
calls. `npm run typecheck:scripts` exits 0 with all four present.

Related: `CREATE_ORDER_DROPPED_FIELDS.md` (what the create path persists),
`SECONDARY_BUYER_SELLER.md` (party coverage counts orders, not people — which is
a second reason no coverage percentage should be read as "this file has its
buyers").
