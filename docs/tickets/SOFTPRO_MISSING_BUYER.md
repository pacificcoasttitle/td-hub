# The missing buyer is SoftPro's, not ours — but the probe found two real drops

**Status:** diagnosis only, nothing implemented. Read-only vendor probe of the
2,103 SoftPro-synced Purchase orders with no `buyer` row in `order_parties`.

**The headline, measured against production SoftPro on 26 Aug 2026:** of 21
missing-buyer purchase orders sampled across four branches, three age bands and
three statuses, **20 had no borrower value in SoftPro at all** and **1 had a real
borrower we are structurally unable to collect**. The vendor is empty. This is a
PCT data-entry problem before it is a code problem, and no mapping fix will
recover the 2,103 files.

That is the answer to the question that was asked. The probe also found two
defects that are narrower than the headline but are unambiguously ours:

1. **`contacts_empty_confirmed` is a one-way latch.** Once an order is marked
   empty, no scheduled job ever re-reads its contacts. 92 orders are latched with
   zero party rows. One of the two latched orders in the sample
   (`20021133-ONT`) **has held a real borrower in SoftPro since some point after
   17 Aug and we will never see it.**
2. **`BuyersAgentBrokers` is never read.** SoftPro returns it as a top-level key
   on every `GetOrderContacts` response and it carried a real agent name on
   **7 of the 25** orders sampled. `order_parties` has **zero `buyer_agent` rows,
   ever**. This is a vendor field discarded at 100%, and it settles the open
   question left in `DELIVERABLE_EMAILS.md`.

---

## 1. The three-way split

Sample: 21 orders with no stored `buyer` row, plus 4 controls that have one.
Selection criteria and SQL in §5. Base URL used for every call:
**`http://100.29.181.61:3000/api/`** (production; staging is port 8081).

| What SoftPro returned for the borrower | Orders | Share |
| --- | --- | --- |
| `buyer: {Person: null, Company: null}` — container present, both slots null | 12 | 57% |
| `buyer: null` — key present, container null | 7 | 33% |
| No `buyer` key at all — payload was `{"Status": 0}` | 1 | 5% |
| **`buyer.Person.PrimaryBorrower` holds a real name** | **1** | **5%** |

Collapsed to the three states this project distinguishes:

| State | Count |
| --- | --- |
| **Absent** — no borrower data returned | 1 / 21 |
| **Present but empty** — buyer structure returned carrying nothing | 19 / 21 |
| **Present with a value we dropped** | 1 / 21 |

**Measured.** Every one of the 21 returned HTTP 200. None failed, none timed out,
so "SoftPro is empty" is an answer from the vendor and not a read error — with the
one exception noted below.

Two details that matter for reading the table honestly:

- The single **absent** case, `20016337-GLT`, is not evidence of vendor emptiness.
  `GetOrderContacts` returned the bare envelope `{"Status": 0}` and
  `GetOrderDetails` returned **zero rows** for the file number across a
  2025-01-01 → today window. The order enriched successfully in July
  (`parties_written: 4`) and no longer resolves in the vendor adapter at all. That
  is a separate question — an order we hold that SoftPro will not return — and it
  is not a borrower-mapping issue.
- The distinction between `buyer: null` and `buyer: {Person: null, Company: null}`
  is the vendor's, not ours. Both map to no borrower. Neither is a value we drop.

### What this does not license

**Inferred, and deliberately not quantified:** the sample was stratified to span
the range, not drawn at random, so 19/21 is **not** a population estimate for the
2,103. The direction is robust — the vendor-empty state appears in every stratum,
every branch and every status band — but anyone wanting a population percentage
needs a random sample. What the sample does establish is that no plausible
mapping fix addresses the bulk of the gap.

### The corroborating operational signature

The strongest support for "PCT staff are not typing the borrower" is not in the
sample at all, it is in our own table. Of the 2,103 missing-buyer purchase orders,
**1,302 (62%) already hold a `seller` row.** SoftPro's `Sellers.PrimarySeller` was
filled in on the same file where `buyer` was left blank, read by the same call,
through the same mapper, on the same code path. 15 of the 21 sampled orders show
exactly this: a real seller name mapped, and nothing on the buyer side.

```
| 20021019-GLT | buyer: null | seller mapped: "Roberto A Hernandez" |
| 20019932-GLT | buyer: null | seller mapped: "Sashi Nambiar"       |
| 20015506-OCT | buyer: {Person:null,Company:null} | seller mapped: "Nadir A Eltahir" |
```

The gap is also not purchase-specific, which a mapping bug in the buyer branch
would have to be: **1,217 of 3,588 Refinance orders (34%) have no buyer row
either**, and a refinance always has a borrower.

---

## 2. The control-group diff

Four purchases that DO have a stored buyer row, one per branch:

| File | SoftPro `buyer.Person.PrimaryBorrower` | Mapper output | Stored |
| --- | --- | --- | --- |
| `20018752-GLT` | `"Ezekiel Serrano"` | `"Ezekiel Serrano"` | yes |
| `20017429-OCT` | `"Marcos Flores-Carreno"` | `"Marcos Flores-Carreno"` | yes |
| `20017912-ONT` | `"Paul Alvarez"` | `"Paul Alvarez"` | yes |
| `20015577-PRV` | `"Josephine M. Perry"` | `"Josephine M. Perry"` | yes |

**The diff is one string.** Control and failing responses are otherwise
identical: same endpoint, same HTTP 200, the same ten top-level keys in the same
order (`buyer, EscrowCompanies, Lenders, ListingAgentBrokers, BuyersAgentBrokers,
MortgageBrokers, PayoffLenders, Sellers, TitleCompanies, Underwriters`), the same
`mapOrderContacts` call, the same `persistResolvedParties` path. The only
structural difference is whether `buyer.Person.PrimaryBorrower` contains a
non-empty string.

This is what rules out the failure modes that have bitten this integration before,
and each was checked explicitly rather than reasoned about. The probe deep-scans
every key in the payload matching `/buy|borrow|preimary/i` at any depth,
regardless of whether our types declare it:

| Candidate failure mode | Result |
| --- | --- |
| Contact-type string we don't match on | No unmatched borrower-bearing key found |
| Casing mismatch (`buyer` vs `Buyers`) | Vendor really does send lowercase `buyer`; `mapper.ts:177` matches it |
| Field under a different key | Only `buyer.Person.*` / `buyer.Company.*` ever carry borrower names |
| Entity name where a person was expected | `buyer.Company.PrimaryBorrower` was `null` on all 25; `mapper.ts:178` already reads it |
| Array we filter to nothing | `buyer` is an object on every response, never an array |
| Value only in `GetOrderDetails` | Zero borrower-bearing keys in any details response |
| The `PreimaryBorrower` misspelling | Already tolerated at `mapper.ts:180`; never seen in this sample |

The mapper is not the problem. On the one order where a value was present
(`20021133-ONT`), `mapOrderContacts` returned `"Daniel Garihay Espinoza"` and
`"Maria G. Ortiz"` correctly. It reads all four borrower locations and the
vendor's own misspelling:

```177:183:src/lib/integrations/softpro/mapper.ts
  const primaryBuyer = nullableString(data.buyer?.Person?.PrimaryBorrower)
    ?? nullableString(data.buyer?.Company?.PrimaryBorrower)
    ?? nullableString(data.buyer?.PrimaryBorrower)
    ?? nullableString(data.buyer?.PreimaryBorrower);
  const secondaryBuyer = nullableString(data.buyer?.Person?.SecondaryBorrower)
    ?? nullableString(data.buyer?.Company?.SecondaryBorrower)
    ?? nullableString(data.buyer?.SecondaryBorrower);
```

---

## 3. Defect 1 — `contacts_empty_confirmed` never releases

**This is the one case where a real borrower exists in SoftPro and we cannot
reach it, and it is the only finding here that costs us buyers.**

`20021133-ONT` was opened 17 Aug 2026 and enriched the same day at 18:03:03.
SoftPro was empty at that moment, so the run recorded `outcome: empty_confirmed`
and set the flag. SoftPro now holds `Daniel Garihay Espinoza` and
`Maria G. Ortiz`. Nine days later the order still has **zero party rows** and
`last_contacts_fetch_at` is still 17 Aug — it has not been re-read once.

The flag is written from whatever the vendor said on the most recent read:

```244:246:src/lib/jobs/handlers/enrich-orders.ts
  const contactsEmptyConfirmed = softProContactsEmpty(data, mapped);
  result.contactsEmptyConfirmed = contactsEmptyConfirmed;
  setFields.contactsEmptyConfirmed = contactsEmptyConfirmed;
```

and the batch picker then excludes anything carrying it:

```296:300:src/lib/jobs/handlers/enrich-orders.ts
      and(
        or(
          isNull(orders.contactsEmptyConfirmed),
          eq(orders.contactsEmptyConfirmed, false),
        ),
```

Line 246 is the only writer that can clear the flag, and reaching line 246
requires passing the line 298 filter. **A true value is therefore terminal.** The
`NOT EXISTS ... order_parties` clause at line 309 looks like it should rescue
these orders, but it sits in the inner `or` and is gated by the outer `and`, so it
never applies to a latched row.

Nothing else clears it. `contacts_empty_confirmed` is written in exactly one
file (`enrich-orders.ts`); `resync-from-softpro.ts` and the daily report only
read it. The two other writers of buyer rows are both manual-only per-order
endpoints, so no automation reaches a latched order:

| Writer | Trigger | Gated on the latch? |
| --- | --- | --- |
| `handleEnrichOrders` | scheduled | **yes — excluded forever** |
| `enrichSingleOrder` | `POST /api/orders/[id]/enrich` | no, but human-triggered only |
| `verifySingleOrder` → `reconcileParties` | `POST /api/orders/[id]/verify-sync` | no, but human-triggered only |

**Scale, measured:**

| Population | Orders |
| --- | --- |
| Latched (`contacts_empty_confirmed = true`) | 92 |
| ...of which have zero party rows | **92 (all of them)** |
| Purchase | 33 |
| Refinance | 57 |
| Other | 2 |
| Latch dates | 12 Jul – 27 Aug 2026 |

**Measured:** 1 of the 2 latched orders in the sample has since acquired a real
borrower in SoftPro. **Inferred:** a similar share of the other 90 likely has too,
but that is a guess until someone re-reads all 92 — which is a cheap, purely
read-only check and is the recommended next step.

**Proposed fix, not implemented.** The flag is a useful "don't re-poll a
genuinely empty order every six hours" optimisation, so deleting it is wrong.
Make it expire instead of terminate: add the latch to the existing
`lastContactsFetchAt` staleness arm so an empty-confirmed order is retried on a
long cadence (say weekly) rather than never. That is a change to the `or` at
lines 296–300 only. An order in a non-terminal `operational_status` with no party
rows should arguably never be latched at all.

## 4. Defect 2 — `BuyersAgentBrokers` is discarded entirely

Unrelated to the missing buyer, found by the same probe, and a clean instance of
the failure class this repo has hit before: the vendor sends a field, our type
does not declare it, and the mapper cannot see it.

`GetOrderContacts` returns `BuyersAgentBrokers` as a top-level key on **every**
response — it appears in all 25 sampled orders, in the same position, between
`ListingAgentBrokers` and `MortgageBrokers`. It carried a real agent on 7 of 25:

| File | `BuyersAgentBrokers.Person.Name` | `BuyersAgentBrokers.Company.Name` |
| --- | --- | --- |
| `20017694-ONT` | `Leonard Bustos` | Moving Results Realty |
| `20012563-PRV` | `Gabby Alcantar` | Real Brokerage Technologies, Inc. |
| `20005524-ONT` | `Garrett Weston` | Coldwell Banker Realty |
| `20019416-ONT` | `G. Dale Babb` | Regency Real Estate Brokers |
| `20021133-ONT` | `Joe Rodriguez` | Capstone Realty |
| `20017912-ONT` | `Jimmy Olguin` | First Choice Realty |
| `20015577-PRV` | — | Legacy Real Estate Inc |

`Coldw840` on `20005524-ONT` is a populated `Company.LookupCode`, so some of
these would resolve straight onto an existing `companies` row.

The field is absent from the response type, so it is unreachable:

```102:112:src/lib/integrations/softpro/types.ts
export interface SoftProOrderContactsData {
  buyer: SoftProBuyerRole | null;
  Sellers: SoftProSellerRole | null;
  EscrowCompanies: SoftProResolvedRole | null;
  Lenders: SoftProResolvedRole | null;
  ListingAgentBrokers: SoftProResolvedRole | null;
  MortgageBrokers: SoftProResolvedRole | null;
  PayoffLenders: SoftProResolvedRole | null;
  TitleCompanies: SoftProResolvedRole | null;
  Underwriters: SoftProResolvedRole | null;
}
```

`mapOrderContacts` therefore has no `buyerAgent` entry, and
`persistResolvedParties` has no `buyer_agent` row — the enum value exists and is
never written:

```724:735:src/lib/jobs/handlers/enrich-orders.ts
  const rows: PartyUpsert[] = [
    { role: 'buyer', isPrimary: true, party: mapped.parties.buyer },
    { role: 'buyer', isPrimary: false, party: mapped.parties.secondaryBuyer },
    { role: 'seller', isPrimary: true, party: mapped.parties.seller },
    { role: 'seller', isPrimary: false, party: mapped.parties.secondarySeller },
    { role: 'lender', isPrimary: true, party: mapped.parties.lender, contactId: updates.lenderId },
    { role: 'listing_agent', isPrimary: true, party: mapped.parties.listingAgent, contactId: updates.listingAgentId },
    { role: 'escrow_company', isPrimary: true, party: mapped.parties.escrowCompany },
    { role: 'lender_contact', isPrimary: true, party: mapped.parties.mortgageBroker },
    { role: 'other', isPrimary: true, party: mapped.parties.titleCompany, companyId: updates.titleCompanyId },
    { role: 'other', isPrimary: false, party: mapped.parties.underwriter, companyId: updates.underwriterId },
  ];
```

Confirmed table-wide — `buyer_agent` does not appear at all:

| Role | Rows | Distinct orders |
| --- | --- | --- |
| `other` | 12,735 | 6,386 |
| `escrow_company` | 5,910 | 5,910 |
| `buyer` | 5,407 | 3,888 |
| `seller` | 3,460 | 2,325 |
| `lender` | 3,134 | 3,134 |
| `listing_agent` | 1,919 | 1,919 |
| `lender_contact` | 1,469 | 1,466 |
| **`buyer_agent`** | **0** | **0** |

**This closes an open question.** `DELIVERABLE_EMAILS.md:201–206` records zero
`buyer_agent` rows and leaves it undecided: *"Either buyer agents are being filed
under another role or they are not captured at all."* Neither. SoftPro sends them
and the read path cannot see them. The confirmation email's `buyer_agent` TO
candidate has never resolved for anyone because of a missing line in a type.

**Proposed fix, not implemented.** Three small additions, mirroring
`ListingAgentBrokers` exactly, which already works and has 1,919 rows:
add `BuyersAgentBrokers: SoftProResolvedRole | null` to
`SoftProOrderContactsData`; add `buyerAgent: resolvedParty(data.BuyersAgentBrokers?.Person, data.BuyersAgentBrokers?.Company)`
to `mapOrderContacts`; add `{ role: 'buyer_agent', isPrimary: true, party: mapped.parties.buyerAgent }`
to `persistResolvedParties`. Note that `softProContactsEmpty` would also need the
new party counted, or an order whose only contact is a buyer's agent would be
wrongly latched as empty.

Worth checking before building: `scripts/audit/readback.ts:169` maps
`buyer_agent` from `ListingAgentBrokers`, and `softpro-payload.ts:325` writes the
create-side field as `buyersAgentDetails`. Someone should confirm the read key is
`BuyersAgentBrokers` and the write key is `buyersAgentDetails` rather than
assuming symmetry.

---

## 5. Reproducing this

### Base URL and method

Every vendor call was a `GET` against **`http://100.29.181.61:3000/api/`**, taken
from `.env.local`'s `SOFTPRO_API_URL` unmodified, and logged by the probe on
startup. Staging is `http://100.29.181.61:8081/api/` and was not contacted. Only
`ordercreation/GetOrderContacts` and `ordercreation/GetOrderDetails` were called.
No writes, no `createOrder`.

The probe uses raw `fetch` rather than `client.ts` for two reasons: to capture the
untouched response envelope instead of the unwrapped `data`, and so the probe does
not append the `vendor_api_logs` rows that every call through `makeRequest`
produces. No Postgres writes were made.

```
npx tsx scripts/audit/softpro-missing-buyer-probe.ts
npm run typecheck:scripts   # exit code 0
```

Raw per-order responses land in `_scratch_untracked/buyer-probe/<file>.json`
(untracked) with the full envelope for both endpoints.

### The population

```sql
-- Headline: missing buyer rows by source and transaction type.
-- 2,103 of 3,584 softpro_sync Purchase orders; 1,217 of 3,588 Refinance.
SELECT o.source, o.transaction_type, COUNT(*) AS orders,
       COUNT(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM order_parties p
                           WHERE p.order_id = o.id AND p.role = 'buyer')
       ) AS no_buyer_row
FROM orders o
GROUP BY 1, 2
ORDER BY orders DESC;
```

```sql
-- The operational signature: 1,302 of the 2,103 already hold a seller row,
-- and all but 51 hold at least one party row of some kind.
WITH pu AS (
  SELECT o.id, o.contacts_empty_confirmed,
         EXISTS (SELECT 1 FROM order_parties p WHERE p.order_id=o.id AND p.role='buyer')  AS has_buyer,
         EXISTS (SELECT 1 FROM order_parties p WHERE p.order_id=o.id AND p.role='seller') AS has_seller,
         EXISTS (SELECT 1 FROM order_parties p WHERE p.order_id=o.id)                     AS has_any_party
  FROM orders o
  WHERE o.source='softpro_sync' AND o.transaction_type='Purchase'
)
SELECT has_buyer, has_seller, has_any_party, contacts_empty_confirmed, COUNT(*)
FROM pu GROUP BY 1,2,3,4 ORDER BY 5 DESC;
```

```sql
-- Defect 1 scale: 92 latched orders, every one with zero party rows.
SELECT o.transaction_type, count(*) AS latched_orders,
       count(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM order_parties p WHERE p.order_id=o.id)
       ) AS latched_zero_parties,
       min(o.last_contacts_fetch_at)::date AS oldest_fetch,
       max(o.last_contacts_fetch_at)::date AS newest_fetch
FROM orders o WHERE o.contacts_empty_confirmed = true
GROUP BY 1 ORDER BY 2 DESC;
```

```sql
-- Defect 2: buyer_agent has never been written.
SELECT role, count(*) AS rows, count(DISTINCT order_id) AS orders
FROM order_parties GROUP BY 1 ORDER BY 2 DESC;
```

```sql
-- The latch, per order: 20021133-ONT enriched once, same day it opened,
-- outcome empty_confirmed, never re-read.
SELECT o.file_number, o.contacts_empty_confirmed, o.last_contacts_fetch_at,
       o.opened_at::date AS opened, l.started_at, l.request_meta
FROM orders o
LEFT JOIN vendor_api_logs l
  ON l.order_id = o.id AND l.operation = 'enrich_order_contacts'
WHERE o.file_number IN ('20021133-ONT','20018364-GLT','20016337-GLT')
ORDER BY o.file_number, l.started_at;
```

### Sample selection

Stratified rather than random, so that a single age band, status or branch could
not produce the result on its own. `md5(file_number)` orders within each stratum
so the pick is deterministic and re-derivable, and `ONT`/`PRV` are force-included
because they are small (36 and 32 purchase orders) and would otherwise never be
drawn. Branch suffixes present in the population: `GLT` 2,313, `OCT` 1,203,
`ONT` 36, `PRV` 32.

```sql
WITH pu AS (
  SELECT o.id, o.file_number, o.operational_status, o.opened_at,
         COALESCE(substring(o.file_number from '-([A-Za-z]+)$'),'(none)') AS branch,
         (now()::date - o.opened_at::date) AS age_days,
         EXISTS (SELECT 1 FROM order_parties p WHERE p.order_id=o.id AND p.role='buyer')  AS has_buyer,
         EXISTS (SELECT 1 FROM order_parties p WHERE p.order_id=o.id AND p.role='seller') AS has_seller,
         (SELECT count(*) FROM order_parties p WHERE p.order_id=o.id) AS party_rows
  FROM orders o
  WHERE o.source='softpro_sync' AND o.transaction_type='Purchase'
),
labelled AS (
  SELECT *, CASE
    WHEN NOT has_buyer AND party_rows=0                                THEN 'F_no_parties_at_all'
    WHEN NOT has_buyer AND operational_status IN ('completed','closed') THEN 'D_completed_closed'
    WHEN NOT has_buyer AND age_days <= 14                              THEN 'A_recent_14d'
    WHEN NOT has_buyer AND NOT has_seller                              THEN 'E_no_seller_other_parties'
    WHEN NOT has_buyer AND age_days BETWEEN 15 AND 90                  THEN 'B_aged_15_90'
    WHEN NOT has_buyer                                                 THEN 'C_older_90plus'
    ELSE 'Z_control_has_buyer' END AS stratum
  FROM pu
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY stratum ORDER BY md5(file_number))         AS rn_stratum,
            row_number() OVER (PARTITION BY stratum, branch ORDER BY md5(file_number)) AS rn_branch
  FROM labelled
)
SELECT stratum, file_number, branch, operational_status, opened_at::date, age_days,
       has_seller, party_rows, contacts_empty_confirmed, last_contacts_fetch_at
FROM ranked
WHERE (stratum <> 'Z_control_has_buyer' AND rn_stratum <= 2)
   OR (stratum <> 'Z_control_has_buyer' AND branch IN ('ONT','PRV') AND rn_branch = 1)
   OR (stratum  = 'Z_control_has_buyer' AND rn_branch <= 1 AND branch IN ('GLT','OCT','ONT','PRV'))
ORDER BY stratum, branch, file_number;
```

| Stratum | Meaning | Sampled |
| --- | --- | --- |
| `A_recent_14d` | opened within 14 days — rules out ingestion lag | 4 |
| `B_aged_15_90` | 15–90 days old | 4 |
| `C_older_90plus` | older than 90 days | 4 |
| `D_completed_closed` | terminal status — the buyer had every chance to arrive | 3 |
| `E_no_seller_other_parties` | other parties stored, neither buyer nor seller | 4 |
| `F_no_parties_at_all` | zero party rows, `contacts_empty_confirmed = true` | 2 |
| `Z_control_has_buyer` | control — buyer row present, one per branch | 4 |

---

## 6. Per-file results

Spot-checkable directly in SoftPro by file number. "SoftPro borrower" is the
verbatim `GetOrderContacts` value; "Mapped" is what `mapOrderContacts` returns
from that exact payload.

| File | Stratum | Status | Opened | SoftPro borrower | Mapped buyer | Stored | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20021019-GLT | A_recent_14d | in_process | 2026-08-13 | `buyer: null` | `null` | none (5 party rows) | empty |
| 20021254-GLT | A_recent_14d | in_process | 2026-08-19 | `buyer: null` | `null` | none (5 party rows) | empty |
| 20021273-ONT | A_recent_14d | in_process | 2026-08-20 | `buyer: {Person:null, Company:null}` | `null` | none (2 party rows) | empty |
| 20021428-PRV | A_recent_14d | in_process | 2026-08-25 | `buyer: {Person:null, Company:null}` | `null` | none (4 party rows) | empty |
| 20019932-GLT | B_aged_15_90 | in_process | 2026-07-15 | `buyer: null` | `null` | none (5 party rows) | empty |
| 20018832-OCT | B_aged_15_90 | in_process | 2026-06-12 | `buyer: null` | `null` | none (2 party rows) | empty |
| 20020933-ONT | B_aged_15_90 | in_process | 2026-08-11 | `buyer: {Person:null, Company:null}` | `null` | none (5 party rows) | empty |
| 20020817-PRV | B_aged_15_90 | in_process | 2026-08-07 | `buyer: {Person:null, Company:null}` | `null` | none (4 party rows) | empty |
| 20017185-GLT | C_older_90plus | in_process | 2026-04-30 | `buyer: null` | `null` | none (4 party rows) | empty |
| 20015506-OCT | C_older_90plus | in_process | 2026-03-18 | `buyer: {Person:null, Company:null}` | `null` | none (4 party rows) | empty |
| 20017694-ONT | C_older_90plus | in_process | 2026-05-14 | `buyer: {Person:null, Company:null}` | `null` | none (5 party rows) | empty |
| 20012563-PRV | C_older_90plus | in_process | 2026-01-12 | `buyer: {Person:null, Company:null}` | `null` | none (6 party rows) | empty |
| 20011758-GLT | D_completed_closed | completed | 2025-12-15 | `buyer: {Person:null, Company:null}` | `null` | none (3 party rows) | empty |
| 20015633-GLT | D_completed_closed | closed | 2026-03-21 | `buyer: {Person:null, Company:null}` | `null` | none (4 party rows) | empty |
| 20005524-ONT | D_completed_closed | closed | 2025-07-22 | `buyer: {Person:null, Company:null}` | `null` | none (5 party rows) | empty |
| 20016337-GLT | E_no_seller_other_parties | in_process | 2026-04-09 | **payload was `{"Status":0}`; details returned 0 rows** | `null` | none (4 party rows) | **absent / order does not resolve** |
| 20017286-GLT | E_no_seller_other_parties | in_process | 2026-05-04 | `buyer: null` | `null` | none (4 party rows) | empty |
| 20019416-ONT | E_no_seller_other_parties | in_process | 2026-06-30 | `buyer: {Person:null, Company:null}` | `null` | none (3 party rows) | empty |
| 20016576-PRV | E_no_seller_other_parties | in_process | 2026-04-15 | `buyer: {Person:null, Company:null}` | `null` | none (3 party rows) | empty |
| 20018364-GLT | F_no_parties_at_all | in_process | 2026-06-02 | `buyer: null` | `null` | none (0 rows, latched) | empty, latched but no loss yet |
| **20021133-ONT** | F_no_parties_at_all | in_process | 2026-08-17 | **`Person.PrimaryBorrower` = `"Daniel Garihay Espinoza"`, `Person.SecondaryBorrower` = `"Maria G. Ortiz"`** | **`"Daniel Garihay Espinoza"`** | **none (0 rows, latched)** | **value dropped — latch** |
| 20018752-GLT | Z_control | completed | 2026-06-11 | `Person.PrimaryBorrower` = `"Ezekiel Serrano"` | `"Ezekiel Serrano"` | present (3 party rows) | correct |
| 20017429-OCT | Z_control | completed | 2026-05-07 | `Person.PrimaryBorrower` = `"Marcos Flores-Carreno"` | `"Marcos Flores-Carreno"` | present (9 party rows) | correct |
| 20017912-ONT | Z_control | in_process | 2026-05-20 | `Person.PrimaryBorrower` = `"Paul Alvarez"` | `"Paul Alvarez"` | present (8 party rows) | correct |
| 20015577-PRV | Z_control | in_process | 2026-03-19 | `Person.PrimaryBorrower` = `"Josephine M. Perry"` | `"Josephine M. Perry"` | present (8 party rows) | correct |

---

## 7. What the owner has to decide

Nothing here is implemented. In rough order of value:

1. **Operational, and the only thing that recovers the 2,083–2,103.** The
   borrower field is not being filled in on SoftPro purchase orders. 62% of the
   affected files have a seller typed and no buyer, which suggests a workflow or
   training gap at a specific step rather than indifference. That is a
   conversation with title and escrow staff, not a code change.
2. **Fix the latch** (§3). Smallest change with a proven cost — one order in the
   sample of two, and 92 orders exposed. Recommended before anything else in code.
3. **Re-read all 92 latched orders read-only** and count how many now hold a
   borrower. Cheap, and it turns the inference in §3 into a measurement.
4. **Wire `BuyersAgentBrokers`** (§4). Doesn't touch the missing buyer, but
   recovers a vendor field currently discarded at 100% and revives the
   `buyer_agent` confirmation recipient.
5. **Ask about `20016337-GLT`.** An order we hold that production SoftPro no
   longer returns from either endpoint. If there are more, the missing-buyer count
   itself is partly explained by orders that have left the vendor.

Related: `SECONDARY_BUYER_SELLER.md` (co-buyers dropped on the create path — note
its "73% of purchases with no buyer" figure counts primary slots only),
`DELIVERABLE_EMAILS.md:201–206` (the `buyer_agent` question this closes),
`CREATE_ORDER_DROPPED_FIELDS.md`.
