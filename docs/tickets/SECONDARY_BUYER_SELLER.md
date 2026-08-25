# The second buyer and the second seller are not recorded

Ticket. Not implemented.

**Every party-coverage number we have quoted is computed from half the people on
the transaction.** Co-buyers and co-sellers exist on the form, are validated, and
are sent to SoftPro — and the local order record has no row for them. "This order
has a buyer" has never meant "this order has its buyers."

## What the create path writes

```315:319:src/lib/domain/orders/create-order.ts
function buildPartyInserts(orderId: number, input: CreateOrderInput): PartyInsert[] {
  const p: PartyInsert[] = [
    { orderId, role: 'seller', isPrimary: true, externalName: [input.seller.firstName, input.seller.lastName].join(' ') },
    { orderId, role: 'buyer', isPrimary: true, externalName: [input.buyer.firstName, input.buyer.lastName].join(' ') },
  ];
```

Two rows, both `isPrimary: true`, always. The input carries six more name fields
that this function never reads:

| Input field | Sent to SoftPro as | Written locally |
| --- | --- | --- |
| `buyer.secondary{First,Middle,Last}Name` | `transactionDetails.SecondaryBorrower*` | no |
| `seller.secondary{First,Middle,Last}Name` | `sellerDetails.SecondaryOwner*` | no |
| `buyer.middleName` / `seller.middleName` | `Primary*MiddleName` | no — dropped by the two-part join |
| `buyer.isOrganization` / `seller.isOrganization` | `IsOrganization`, `OrganizationType` | no |

`buildSoftProPayload` maps all of them (`softpro-payload.ts:159–168`, `234–241`).
So the vendor knows there are two buyers and we do not.

## This is a create-path-only gap

The schema supports it and every other writer uses it. `order_parties.is_primary`
already carries secondaries:

| Role | Rows | Primary | Secondary |
| --- | --- | --- | --- |
| `buyer` | 5,362 | 3,852 | **1,510** |
| `seller` | 3,388 | 2,280 | **1,108** |

Those secondaries come from the SoftPro read-back, which writes all four slots:

```725:728:src/lib/jobs/handlers/enrich-orders.ts
    { role: 'buyer', isPrimary: true, party: mapped.parties.buyer },
    { role: 'buyer', isPrimary: false, party: mapped.parties.secondaryBuyer },
    { role: 'seller', isPrimary: true, party: mapped.parties.seller },
    { role: 'seller', isPrimary: false, party: mapped.parties.secondarySeller },
```

`verify-order-sync.ts:296–299` reconciles the same four. Only `create-order.ts`
writes two of four, and it is the only writer with the operator's typed values in
hand.

The two oldest hub-created orders show the shape of it exactly. Orders 50 and 51
were created on 25 March with one buyer row each; a second buyer row
(`YESSICA S MENDOZA`, `is_primary = false`) appeared on 3 April, written by the
read-back. The create path had that name and dropped it; a batch job put it back
nine days later. Every hub order created since — 4773, 4774, 6429, 6430, 7308,
7309 — still has exactly one buyer row and one seller row.

## How big the omission is

A second person on title is normal, not an edge case:

| | |
| --- | --- |
| Order property records | 7,342 |
| With a primary owner | 5,384 |
| **With a secondary owner** | **2,227 — 41.4% of owned records** |

`order_properties.secondary_owner` is populated from SiteX at create, so on 41%
of orders we can already see that a second person is on title while writing a
single seller party row for them. The order record contradicts itself on the same
insert.

## What reads the wrong number

- **Party coverage metrics.** Any query of the form "orders with a buyer party"
  counts orders, not people, and for hub-created orders it structurally cannot
  return more than one per side. The 73% of purchases with no buyer, and every
  coverage percentage quoted alongside it, measured primary slots only. A file
  with a co-borrower who is missing counts as covered.
- **The confirmation email.** "Secondary owner" renders from
  `order_properties.secondary_owner` (SiteX), so on a hub-created purchase the
  buyer side has no secondary to render at all.
- **CRM and client rollups.** `crm/clients` attributes orders through
  `order_parties`; a co-buyer is invisible to it.
- **Party wizard and reconciliation.** `verify-order-sync` compares four slots
  against SoftPro. Two of them are guaranteed to differ on any hub-created order
  with a co-buyer, which makes real drift harder to see.

## Proposed approach

Not built pending confirmation, but there is little to decide — this is a
four-row insert instead of a two-row insert, using values already in `input`:

1. In `buildPartyInserts`, emit `isPrimary: false` rows for buyer and seller when
   any secondary name field is non-empty. Match `enrich-orders`' shape so the
   read-back updates rather than duplicates.
2. Stop discarding `middleName`. Either store the full three-part name in
   `external_name` or keep the structured split; the second is preferable, since
   everything downstream currently re-parses a name we already had parsed.
3. Re-run every party-coverage number afterwards, per person rather than per
   order, and state which basis each figure uses.

Open question worth settling first: `order_parties` has no first/middle/last
columns, only `external_name`. Storing structured names means either a schema
change or continuing to concatenate. Concatenating is what produced
`DANIEL TIEU,` on order 7308 — a trailing comma and a dropped middle name in the
local record while SoftPro received the parsed version.

Related: `SITEX_ENTITY_OWNER_NAMES.md` (entity vestings parsed as people) and
`CREATE_ORDER_DROPPED_FIELDS.md` (the full audit this came out of).
