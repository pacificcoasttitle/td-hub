# What the open-order form collects versus what the order record keeps

Every field on `createOrderInputSchema` against every column `createLocalRecords`
writes. Prompted by a production confirmation email for 20021376-OCT that
rendered seven operator-entered values as em dashes; three of them turned out to
be dropped on the write, not on the read.

**Headline: 26 of roughly 50 input fields never reach the database.** SoftPro
receives most of them, so the vendor and the local record disagree about the same
order, and anything reading locally — the confirmation email, the party wizard,
the order overview, CRM metrics — sees the smaller version.

The form is not the problem. `buildSoftProPayload` consumes nearly the whole
input. `createLocalRecords` consumes about half of it, and there is no comment or
type anywhere that says which half or why.

## Persisted today

| Input field | Destination |
| --- | --- |
| `orderType` | `orders.order_type` |
| `property.{address,city,state,zip,county,apn,legalDescription}` | `order_properties.*` |
| `property.unitNumber` | folded into `order_properties.full_address` only — no column of its own |
| `transaction.type` | `orders.transaction_type` (see caveat below) |
| `transaction.product` | `orders.product_type` |
| `transaction.salesAmount` | `orders.sales_price` |
| `transaction.underwriterCode` | `orders.underwriter_id`, via a `companies` lookup |
| `seller.{firstName,lastName}` | `order_parties` role `seller`, concatenated into `external_name` |
| `buyer.{firstName,lastName}` | `order_parties` role `buyer`, concatenated into `external_name` |
| `contacts.{escrowCompany,lender,buyerAgent,listingAgent}` | `order_parties` rows, `external_*` text only |
| `onBehalfOfContactId` | `orders.client_contact_id` |
| `titlePointSessionId` | TitlePoint session link (correctly not a column) |
| `siteXSnapshot.*` | `order_properties` owner/type/fips/apn/legal/county |

Two caveats on the "persisted" list:

- `validTxType` silently writes NULL for any transaction type outside
  `Purchase | Refinance | Equity | Other`. A typo in the enum becomes a missing
  transaction type rather than an error.
- Seller and buyer names are stored as one `"First Last"` string. The middle name
  is discarded and the structured split is unrecoverable, so anything downstream
  has to re-parse a name we already had parsed.

## Dropped: the column exists and nothing writes it

These are pure omissions in the insert. No schema change, no product decision.

| Input field | Column left NULL | Sent to SoftPro as | Status |
| --- | --- | --- | --- |
| `transaction.salesRep` | `orders.sales_rep_id` | `SalesRep` | **fixed** |
| `transaction.titleOfficer` | `orders.title_officer_id` | `TitleOffice` | **fixed** |
| `transaction.escrowOfficer` | `orders.escrow_officer_id` | `LookUpCodeEscrowOfficer`, `EscrowOfficerName` | **fixed** |
| `transaction.loanAmount` | `orders.loan_amount` | `LoanAmount` | **fixed** |
| `contacts.lender` | `orders.lender_id` | `lenderDetails` | **fixed** — persisted from the typeahead pick |
| `contacts.listingAgent` | `orders.listing_agent_id` | `listingAgentDetails` | **fixed** — same |
| `contacts.*` | `order_parties.contact_id` | party lookup codes | **fixed** — the pick now carries its contact id |
| `transaction.branchCode` | `orders.branch_id` | `LookUpCodeTitleOffice` | not taken — see below |

### `escrow_officer_id` is the party wizard's coverage ceiling

This one explains a number we have already investigated once, so it is written
out in full here to stop anyone investigating it a second time.

The form collects an escrow officer, resolves it to a contact, sends it to
SoftPro, and then discards the id. `escrow_officer_id` is NULL on **2,465 of
4,068 active orders**.

The party wizard invite has exactly one recipient, and it is that column:

```
src/lib/jobs/handlers/party-wizard-invite.ts
  loadCandidates()  leftJoin(contacts, eq(contacts.id, orders.escrowOfficerId))
  handlePartyWizardInvite()  if (!row.escrowOfficerId) { unreachable.noEscrowOfficer++; continue; }
```

Re-measured against the job's own candidate window (active, opened 3–7 days ago,
no listing agent, no prior invite):

| | |
| --- | --- |
| Candidates | 119 |
| Unreachable — `escrow_officer_id` is NULL | **97** |
| Unreachable — officer exists but has no email | **0** |
| Reachable | 22 (18.5%) |

**The resolver is not the problem.** Every unreachable order is unreachable for
one reason, and it is a NULL FK on a value the operator already typed. Zero are
blocked by a missing contact email, a bad join, a status filter, or the link
minting. The wizard's coverage cannot exceed the fill rate of this column, so the
4.7% purchase figure is an input problem, not a resolver problem — do not
re-investigate `party-wizard-service.ts` or the invite job looking for it.

Persisting the id at create (this branch) fixes it going forward.

### The backfill is not the lever — dry run, 25 Aug 2026

The scoped backfill exists: `POST /api/admin/backfill/escrow-officers` (May 2026),
which reads `GetOrderDetails.EscrowOfficer` per order and matches the name against
`contacts.is_escrow_officer` rows. Eligibility is defined by
`escrow-officer-expectation.ts`: order type `Title & Escrow` or `Escrow only`,
status open / in_process / completed, `escrow_officer_id` IS NULL. It ran once —
285 assigned, 0 unmatched.

Dry run against today's data:

| | |
| --- | --- |
| Eligible under the scoped definition | **13** |
| `Title & Escrow` orders with an officer | 529 of 541 (97.8%) |
| `Escrow only` orders with an officer | 14 of 15 |
| Orders missing an officer, all types | 2,931 |
| …of which `Title only` | **2,849** |

The backfill is already drained. The 2,849 remaining NULLs are `Title only`
orders, which the scope excludes **correctly** — on a Title-only file escrow is
external and there is no PCT escrow officer to find.

And the wizard's blocked candidates are exactly those orders:

| Order type | Candidates | Blocked | Reachable |
| --- | --- | --- | --- |
| `Title only` | 93 | 93 | 0 |
| `Title & Escrow` | 22 | 0 | **22 (100%)** |
| `Trustee Sale Guarantee` | 3 | 3 | 0 |

So the backfill cannot move wizard coverage at all: every order it is scoped to
reach already has an officer, and every order the wizard is missing is out of its
scope by design. Running it today would resolve 13 orders and change coverage by
nothing.

### What would actually move it

The blocked orders are not missing an escrow contact — they are missing the
*column the invite job reads*. Of 96 blocked candidates, 90 have an
`escrow_company` party row, 90 of those have an email, and 89 are already linked
to a `contacts` row.

The prelim resolver already handles this exact case with a two-step fallback
(`prelim-recipient-resolution.ts:133–162`): escrow officer FK first, then the
`escrow_company` party. The invite job has only the first step.

Applying the same fallback to the invite job, measured:

| | |
| --- | --- |
| Candidates | 116 |
| Reachable today (officer FK only) | 22 (19%) |
| Recovered via the `escrow_company` party | **88** |
| Reachable with the fallback | **110 (94.8%)** |
| Genuinely unreachable | 6 |

That is a resolver change in one file, not a backfill. It should be measured
again after it ships, since forwarding by an external escrow company is a
different behavioural bet than forwarding by a PCT officer.

The three blocked rows all need the same thing: a contact id for a party, which
only exists once the operator picks from a typeahead rather than typing free
text. That is `fix/hub-parties-resolution`. Once it lands, writing these three
FKs is a small follow-up, and it should be taken as one.

That follow-up is `fix/hub-parties-local-persistence`. The typeahead pick now
carries its `contacts.id` through to the server, which verifies it against the
same batched `contacts` lookup the officer FKs use and writes `orders.lender_id`,
`orders.listing_agent_id` and `order_parties.contact_id`. The gap window it
opened is measured in `ORDER_PARTIES_CONTACT_BACKFILL.md` — it is zero orders.

`branch_id` is deliberately not taken here. Something already populates it
(order 7308 has `branch_id = 2` despite create never setting it) and 765 active
orders have it NULL, so it needs its own look rather than a guess bolted onto
this change.

## Dropped: no column exists anywhere

| Input field | Sent to SoftPro as | Status |
| --- | --- | --- |
| `transaction.loanNumber` | `LoanNumber` | **fixed** — column added in `0034` |
| `transaction.escrowNumber` | `EscrowNumber` | **fixed** — column added in `0034` |
| `transaction.coverageAmount` | `CoverageAmount` | needs a decision |
| `isRushOrder` | `IsRushOrder` | needs a decision |
| `clientType` | drives `personalDetails.UserType` | needs a decision |
| `seller.middleName`, `seller.secondary{First,Middle,Last}Name` | `sellerDetails.*` | needs a decision |
| `seller.isOrganization`, `seller.organizationType` | `sellerDetails.*` | needs a decision |
| `buyer.middleName`, `buyer.secondary{First,Middle,Last}Name` | `transactionDetails.*Borrower*` | needs a decision |
| `buyer.isOrganization`, `buyer.organizationType` | `transactionDetails.*` | needs a decision |
| `contacts.mortgageBroker` | `mortgageDetails` | **fixed without the enum** — written as `party_role = 'lender_contact'`, which is where the SoftPro read-back already files a mortgage broker. Adding `mortgage_broker` to the enum remains an open decision, not a blocker |

The secondary buyer and seller are the largest gap in this group. A second
borrower is sent to SoftPro and the local order has no idea one exists, which
means the confirmation email's "Secondary owner" row and every party-coverage
count are computed from half the people on the transaction. Ticketed with the
measurements in `SECONDARY_BUYER_SELLER.md`.

## Dropped: goes nowhere at all, not even to SoftPro

| Input field | Reality |
| --- | --- |
| `deliverableEmails` | Full UI in both the hub form and the client wizard (up to five addresses), Zod-validated, carried through `client-wizard-to-create`, and then read by nothing. Not in the SoftPro payload, not persisted, and not used by the confirmation recipient resolver. An operator can enter five delivery addresses and none of them will ever receive anything. |
| `transaction.productTypeId` | Declared in the schema. Zero references in the codebase. |
| `transaction.orderTypeId` | Declared in the schema. Zero references in the codebase. |

`deliverableEmails` is the one to look at next. It is not a silent drop of a
value the operator might not miss — it is a delivery instruction that is accepted
and discarded, and the operator has no way to tell. What the recipient resolvers
use instead is mapped in `DELIVERABLE_EMAILS.md`.

## Fixed in this branch

`fix/confirmation-email-data` takes the four existing-column omissions plus the
two new columns. It does not take anything that needs a product decision, and it
does not take the three party FKs that depend on `fix/hub-parties-resolution`.

Proof is in `create-order-persisted-fields.test.ts`, which asserts the `orders`
insert payload directly rather than trusting that the form collected the value.
