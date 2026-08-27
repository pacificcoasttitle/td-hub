# The gap window for `order_parties.contact_id`, measured

Plan. Approved to scope — **not implemented, and nothing here was run against
production.** Every number below came from read-only SQL, quoted so it can be
re-derived.

**Headline: the gap window this document was written to size is empty.**
`fix/hub-parties-resolution` reached `main` at 2026-08-26 10:46 PDT. Zero
hub-created orders have been opened since. So the "every order created between
the parties branch merging and this branch deploying" population is **0 orders,
0 party rows** at the time of writing, and if this branch deploys before the next
hub order is opened, the gap window closes at zero.

```sql
-- hub orders opened in the gap window, and how many carry a transaction party
select
  count(*) as hub_orders_in_gap_window,
  count(*) filter (where exists (
    select 1 from order_parties op
    where op.order_id = o.id
      and op.role in ('buyer_agent','listing_agent','lender','lender_contact','escrow_company')
  )) as with_a_transaction_party
from orders o
where o.source = 'manual_entry'
  and o.created_at >= timestamp '2026-08-26 17:46:00';  -- merge time, UTC
-- 0 | 0
```

That is the answer to the question as asked. The rest of this document exists
because the same query over all time returns a much larger number, and it is
worth being precise about who owns it — because it is not the hub.

## What the hub has actually written, all time

The hub has created **8 orders since March**, and they are the entire
`source = 'manual_entry'` population.

```sql
select o.id, o.file_number, o.created_at, o.lender_id, o.listing_agent_id,
       (select count(*) from order_parties op where op.order_id = o.id) as party_rows,
       (select count(*) from order_parties op
         where op.order_id = o.id and op.contact_id is not null) as parties_linked
from orders o
where o.source = 'manual_entry'
order by o.created_at;
```

| Order | Opened | `lender_id` | `listing_agent_id` | Party rows | Linked |
| --- | --- | --- | --- | --- | --- |
| 50 | 25 Mar | NULL | NULL | 4 | **0** |
| 51 | 25 Mar | NULL | NULL | 5 | **0** |
| 4773 | 8 Jun | NULL | NULL | 2 | **0** |
| 4774 | 8 Jun | NULL | NULL | 2 | **0** |
| 6429 | 28 Jul | NULL | NULL | 2 | **0** |
| 6430 | 28 Jul | NULL | NULL | 2 | **0** |
| 7308 | 24 Aug | NULL | NULL | 2 | **0** |
| 7309 | 24 Aug | NULL | NULL | 2 | **0** |

Both columns are NULL on all eight, and no party row on any of them is linked to
a contact. But look at the party counts: six of the eight have exactly two rows,
which is the buyer and the seller. **No operator has ever entered a transaction
party through the hub form.** Orders 7308 and 7309 were opened on 24 August at
19:34 and 19:40 UTC — before `b5cfef9` was even authored (24 Aug 21:08 UTC), so
they predate the typeahead entirely.

The three transaction-party rows that do exist on hub orders were written days
later by the SoftPro read-back, not by the create path:

| Order | Role | `external_name` | `external_company` | Written |
| --- | --- | --- | --- | --- |
| 51 | `lender` | `sfsdfsf` | Barrett Financial Group | 26 Mar (create was 25 Mar) |
| 50 | `escrow_company` | Jerry Hernandez | Newport Financial Associates, Escrow Division | 3 Apr |
| 51 | `escrow_company` | Jerry Hernandez | Newport Financial Associates, Escrow Division | 3 Apr |

None has an email, and `sfsdfsf` is test keystrokes. There is nothing here worth
recovering.

## The real unlinked population is the SoftPro sync, not the hub

```sql
select o.source, op.role,
       count(*) as party_rows,
       count(*) filter (where op.contact_id is null) as no_contact_id
from order_parties op
join orders o on o.id = op.order_id
group by o.source, op.role
order by o.source, op.role;
```

| Source | Role | Rows | No `contact_id` |
| --- | --- | --- | --- |
| `softpro_sync` | `listing_agent` | 1,908 | 808 |
| `softpro_sync` | `lender` | 3,131 | 2,590 |
| `softpro_sync` | `lender_contact` | 1,465 | 701 |
| `softpro_sync` | `escrow_company` | 5,894 | 251 |
| `softpro_sync` | `buyer` / `seller` / `other` | 21,518 | 21,518 |
| `manual_entry` | all roles | 21 | 21 |

Scoped to the five linkable transaction roles, with something to match on:

```sql
select
  count(*) as unlinked_transaction_parties,
  count(distinct op.order_id) as orders_affected
from order_parties op
join orders o on o.id = op.order_id
where op.contact_id is null
  and op.role in ('buyer_agent','listing_agent','lender','lender_contact','escrow_company')
  and (coalesce(op.external_name,'') <> ''
    or coalesce(op.external_email,'') <> ''
    or coalesce(op.external_company,'') <> '');
-- 4,353 party rows across 3,346 orders
```

**4,353 rows on 3,346 orders — and 4,350 of them are `softpro_sync` orders.**
The hub's contribution to this number is three rows. Two of the five roles are
worth noting further: `buyer_agent` has **zero rows in the entire table** (the
read-back never writes it, and no operator has entered one), and `buyer` /
`seller` / `other` are unlinkable by design — they are transaction principals and
title/underwriter companies, not address-book contacts.

## Does the gap self-heal?

**Partly, and not by the route you would assume.** This is the answer to the
question that prompted the document, and it is more favourable than "no".

`enrich-orders` **does** write `order_parties.contact_id`. It is not
`external_name`-only. `persistResolvedParties` passes the resolved FKs straight
into the party upsert:

```729:733:src/lib/jobs/handlers/enrich-orders.ts
    { role: 'lender', isPrimary: true, party: mapped.parties.lender, contactId: updates.lenderId },
    { role: 'listing_agent', isPrimary: true, party: mapped.parties.listingAgent, contactId: updates.listingAgentId },
    { role: 'escrow_company', isPrimary: true, party: mapped.parties.escrowCompany },
    { role: 'lender_contact', isPrimary: true, party: mapped.parties.mortgageBroker },
```

and `resolvePartyIdentityFromMaster` resolves a contact from the SoftPro lookup
code independently of those FKs (`enrich-orders.ts:518–532`), matching on
`contacts.lookup_code`, `softpro_lookup_code` or `source_id`. So the machinery to
link a party from the read-back exists and works.

What is true is the **batch** job does not reach a hub order — but there is no
`source` or `is_imported` filter anywhere in `enrich-orders.ts`. The exclusion is
emergent, not declared. `handleEnrichOrders` selects on:

```301:310:src/lib/jobs/handlers/enrich-orders.ts
        or(
          and(
            isNull(orders.lenderId),
            isNull(orders.listingAgentId),
            isNull(orders.titleCompanyId),
            isNull(orders.underwriterId),
          ),
          isNull(orders.clientContactId),
          sql`NOT EXISTS (SELECT 1 FROM ${orderParties} op WHERE op.order_id = ${orders.id})`,
        ),
```

A hub-created order sets `underwriter_id` at create (all eight have 2748), sets
`client_contact_id` whenever a client was picked, and always writes buyer and
seller party rows. All three branches of that `or` are therefore false and the
order is never selected. This is a **fragile** exclusion, and it is worth stating
plainly: it means the batch skips a hub order precisely because the hub filled
in some fields, and it will keep skipping it after this branch also fills in
`lender_id` and `listing_agent_id`. Nothing about that behaviour changes.

The per-order path has no such gate. `POST /api/orders/[id]/enrich`
(`src/app/api/orders/[id]/enrich/route.ts:31`) calls `enrichSingleOrder`, which
skips the batch query entirely and enriches whatever order id it is given —
including a hub-created one. `resync-from-softpro.ts:193` calls the same
function.

**So the recovery tool already exists and needs no new code.** For any hub order
in a future gap window, one authenticated POST per order re-reads
`GetOrderContacts` and writes both the order FKs and the party `contact_id`s.

## How a party row would be matched, and what each match risks

If a bulk backfill is ever wanted for the 4,350 `softpro_sync` rows, these are
the options, measured. The important finding is that **the intuitive ordering is
wrong**: email is the highest-yield strategy but it is also the more ambiguous
one.

### By lookup code — safe, and already implemented

The read-back carries `PersonLookupCode` / `CompanyLookUpCode` per party. Match
against `contacts.lookup_code` / `softpro_lookup_code` / `source_id`. This is an
identifier issued by the system of record, so a hit is an identity, not a guess.

- **False-match risk: effectively zero.**
- **Safe to automate: yes.**
- Not measurable from the local tables — the codes are not stored on
  `order_parties`, which is why this needs a SoftPro read rather than SQL. That
  read is exactly what `enrichSingleOrder` already does, so the honest
  recommendation is "re-run the existing job", not "write a matcher".

### By email — highest yield, and 42% of its hits are ambiguous

```sql
with gap as (
  select op.id, lower(trim(op.external_email)) as em
  from order_parties op
  join orders o on o.id = op.order_id
  where op.contact_id is null
    and op.role in ('buyer_agent','listing_agent','lender','lender_contact','escrow_company')
    and coalesce(op.external_email,'') <> ''
), cand as (
  select lower(email) as em, count(*) as n
  from contacts where coalesce(email,'') <> '' group by 1
)
select count(*) as gap_rows_with_email,
       count(c.em) as email_found,
       count(*) filter (where c.n = 1) as exactly_one_contact,
       count(*) filter (where c.n > 1) as more_than_one_contact
from gap g left join cand c on c.em = g.em;
```

| | |
| --- | --- |
| Unlinked rows carrying an email | 918 |
| Email matches at least one contact | 410 |
| Matches **exactly one** contact | **237** |
| Matches **more than one** contact | **173 (42% of hits)** |

`contacts` has 21,703 rows and no unique constraint on `email`, so duplicate
contact records sharing an address are common. 173 rows would have a matcher
picking one of several contact ids essentially at random, and the resulting link
would look identical in the database to a correct one.

- **Safe to automate: only the 237 unambiguous rows.** The 173 ambiguous ones
  must either be skipped or deduplicated first — deduplicating `contacts` is the
  better project and would raise the yield of every strategy here.

### By normalised name — low yield, and the wrong shape of risk

```sql
with gap as (
  select op.id, upper(regexp_replace(coalesce(op.external_name,''), '[^A-Za-z]', '', 'g')) as nm
  from order_parties op
  join orders o on o.id = op.order_id
  where op.contact_id is null
    and op.role in ('buyer_agent','listing_agent','lender','lender_contact','escrow_company')
    and coalesce(op.external_name,'') <> ''
), cand as (
  select upper(regexp_replace(coalesce(full_name,''), '[^A-Za-z]', '', 'g')) as nm, count(*) as n
  from contacts where coalesce(full_name,'') <> '' group by 1
)
select count(*) as gap_rows_with_name,
       count(c.nm) as name_found,
       count(*) filter (where c.n = 1) as exactly_one_contact,
       count(*) filter (where c.n > 1) as more_than_one_contact
from gap g left join cand c on c.nm = g.nm;
```

| | |
| --- | --- |
| Unlinked rows carrying a name | 1,331 |
| Name matches at least one contact | 130 (9.8%) |
| Matches exactly one contact | 116 |
| Matches more than one contact | 14 |

The 14 looks reassuring and is not. Name collision risk is not the duplicate-row
problem that email has; it is that two different people share a name, and a
strict full-string match cannot tell them apart while a loose one ("first initial
+ last name", nickname handling) manufactures collisions. 9.8% yield does not buy
enough to accept that.

- **Safe to automate: no.** Suitable for a review queue at most, and 116 rows is
  not worth building a review queue for.

### By company — cannot produce a link at all

`order_parties` has **no `company_id` column** (`src/lib/db/schema/orders.ts:142–166`).
Matching `external_company` against `companies.name` identifies a company and
then has nowhere to put it: `contact_id` references `contacts`, and
`loadCompanyIdentity` in the read-back returns `contactId: null` for exactly this
reason (`enrich-orders.ts:496–502`).

Company matching could only reach a contact transitively — company → its contacts
→ pick one — which is a guess about *which person* at a firm, on a party row that
may name no person at all. This is where the worst false matches would come from:
attributing an order to a named individual who was never on it. `escrow_company`
is the role most affected, since 233 of its 251 unlinked rows have a name that is
often the firm rather than a person.

- **Safe to automate: no.** If company attribution is wanted, the correct move is
  a schema change (`order_parties.company_id`), not a transitive contact guess.

## What cannot be recovered

- **Which suggestion the operator clicked.** The hub stores no provenance for a
  party pick. Once the id was discarded, the difference between "the operator
  selected Jerry Hernandez from the typeahead" and "the operator typed Jerry
  Hernandez" is gone. Any backfill reconstructs a *plausible* link, not the one
  that was actually made. For the hub population this costs nothing — no operator
  ever entered a party — but it is the reason a bulk matcher can never be called
  a repair.
- **Free-text parties that never existed in `contacts`.** 508 of the 918
  email-bearing rows match no contact at all. A party that was typed in and is
  not in the address book has no id to find; that is correct behaviour, not a
  gap, and the row already carries everything known about it.
- **`buyer_agent` history.** The role has zero rows table-wide, so there is no
  buyer's-agent history to link for any order, hub or synced.
- **The mortgage broker before this branch.** The create path wrote no row for it
  at all, so the only mortgage brokers with local rows are the 1,465
  `lender_contact` rows the read-back created. A hub order's mortgage broker
  before this branch exists only in SoftPro.

## Recommendation

1. **Do not write a bulk matcher.** The population it was scoped for is zero
   rows, and the population that is actually large belongs to the SoftPro sync
   and already has a correct, identifier-based repair path.
2. **If a hub order ever lands in a gap window, POST it to
   `/api/orders/[id]/enrich`.** One call per order, no new code, matches on
   lookup codes rather than on names.
3. **Declare the enrich-orders exclusion instead of leaving it emergent.** The
   batch skips hub orders as a side effect of which columns the hub fills. That
   is not a decision anyone recorded and it will drift. Either add an explicit
   `source` predicate with a comment saying why, or add a condition that catches
   an order with unlinked party rows.
4. **Deduplicate `contacts` by email before considering any matching work.** 173
   ambiguous email hits out of 410 is the ceiling on every strategy above, and
   lowering it helps the typeahead, the recipient resolvers and CRM attribution
   at the same time.

Related: `CREATE_ORDER_DROPPED_FIELDS.md` (the audit that identified these three
FKs as blocked on a resolved contact id) and `SECONDARY_BUYER_SELLER.md` (the
other create-path party gap, still open).
