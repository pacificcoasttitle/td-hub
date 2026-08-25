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
| `contacts.lender` | `orders.lender_id` | `lenderDetails` | blocked — needs a resolved contact id |
| `contacts.listingAgent` | `orders.listing_agent_id` | `listingAgentDetails` | blocked — same |
| `contacts.*.clientLookupCode` | `order_parties.contact_id` | party lookup codes | blocked — same |
| `transaction.branchCode` | `orders.branch_id` | `LookUpCodeTitleOffice` | not taken — see below |

`escrow_officer_id` is worth calling out on its own. The form collects an escrow
officer, resolves it to a contact, sends it to SoftPro, and then discards the id.
`escrow_officer_id` is NULL on **2,465 of 4,068 active orders**, and it is the
column the party wizard needs to reach a purchase order. The wizard's 4.7%
coverage has an upstream cause, and this is part of it.

The three blocked rows all need the same thing: a contact id for a party, which
only exists once the operator picks from a typeahead rather than typing free
text. That is `fix/hub-parties-resolution`. Once it lands, writing these three
FKs is a small follow-up, and it should be taken as one.

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
| `contacts.mortgageBroker` | `mortgageDetails` | needs a decision — `party_role` has no `mortgage_broker` value |

The secondary buyer and seller are the largest gap in this group. A second
borrower is sent to SoftPro and the local order has no idea one exists, which
means the confirmation email's "Secondary owner" row and every party-coverage
count are computed from half the people on the transaction.

## Dropped: goes nowhere at all, not even to SoftPro

| Input field | Reality |
| --- | --- |
| `deliverableEmails` | Full UI in both the hub form and the client wizard (up to five addresses), Zod-validated, carried through `client-wizard-to-create`, and then read by nothing. Not in the SoftPro payload, not persisted, and not used by the confirmation recipient resolver. An operator can enter five delivery addresses and none of them will ever receive anything. |
| `transaction.productTypeId` | Declared in the schema. Zero references in the codebase. |
| `transaction.orderTypeId` | Declared in the schema. Zero references in the codebase. |

`deliverableEmails` is the one to look at next. It is not a silent drop of a
value the operator might not miss — it is a delivery instruction that is accepted
and discarded, and the operator has no way to tell.

## Fixed in this branch

`fix/confirmation-email-data` takes the four existing-column omissions plus the
two new columns. It does not take anything that needs a product decision, and it
does not take the three party FKs that depend on `fix/hub-parties-resolution`.

Proof is in `create-order-persisted-fields.test.ts`, which asserts the `orders`
insert payload directly rather than trusting that the form collected the value.
