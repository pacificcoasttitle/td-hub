# The buyer is missing from most of our purchase files, and it is missing in SoftPro

**27 August 2026 · Pacific Coast Title · for discussion with SoftPro and with PCT operations**

## What this costs us

On 2,159 SoftPro purchase files — 59% of every purchase order we have ever received from
SoftPro — there is no buyer or borrower on the file. Not a blank name: no buyer record of
any kind. On those files we cannot email the buyer, cannot send them documents, cannot
call them, and cannot confirm from our own system who is purchasing the property.
Anything a buyer receives on those files goes out because a person remembered, not
because the file told us to.

1,518 of them are still open. 419 were opened in the last 30 days — about fourteen new
files a day.

## It is getting worse

Of purchase files opened in January 2026, 52% had no buyer. June 66%, July 68%, August so
far 72%. Every branch is affected — GLT 56%, OCT 65%, ONT 74%, PRV 49% — and so are
finished files: 36% of completed purchases and 46% of closed ones have no buyer either.
Files were still being opened without one today.

## Measured, and inferred

**Measured.** The counts above are from our own records. Separately, on 26 August we asked
SoftPro directly about 21 of these files. On 19, SoftPro returned the borrower section of
the file with nothing in it. On 1 it returned nothing at all. On 1 it returned a real
borrower name. All 21 answered successfully, so this is SoftPro reporting the field empty,
not our system failing to ask.

**Inferred.** Those 21 were chosen to span every branch, age and status rather than drawn
at random, so 19-of-21 is not a survey result and should not be quoted as a population
percentage. What it establishes — because the empty answer came back from every branch,
age band and status — is the direction: the borrower is not being entered. Putting a
percentage on it would need a random sample.

## Our software is not the cause, with one honest exception

Two facts settle this without relying on the sample. 1,331 of the same 2,159 files (62%)
*do* have a seller recorded, read from the same request, through the same code, on the
same path — if our reading were broken the seller would be missing too. And 1,239 of
3,663 refinance files are also missing a borrower, which a fault specific to purchase
buyers could not produce. We also compared four files that do have a buyer against
failing ones: the responses were identical except for whether the borrower field held a
name.

The exception, plainly: on 1 of the 21, SoftPro did hold a real borrower and our software
did not collect it. That defect is ours, it is being fixed, and it is one file in
twenty-one. It does not explain the 2,159.

## Two defects we found and are fixing

Neither causes the gap above. First, once a file is read and found to have no contacts, our
system marks it confirmed-empty and never looks again — 92 files are stuck that way, and
at least one now holds a real borrower in SoftPro that no automated process will collect.
That is the same file named above. Second, SoftPro returns the buyer's agent on every
response and our software has never read it; the consequence is that nobody at PCT has
ever been able to contact a buyer's agent from the system, on any order, ever. Both fixes
are in progress.

## Questions for SoftPro

1. Where in your order workflow is the borrower expected to be entered, and is there a
   setting that would make it required before an order can be saved?
2. Can you confirm the field is genuinely empty on your side for these files, rather than
   held somewhere your order-contacts response does not return?
3. Is there a report or export that shows which of our open orders have no borrower, so we
   can chase them without asking file by file?
4. File 20016337-GLT: we read it successfully in July, and today your system returns
   nothing for it from either request. Where did it go, and are there others?

## Questions for PCT operations

1. At what step is the buyer's name meant to be entered on a purchase, and who owns that
   step? The seller is entered on 62% of these same files, so the buyer step is being
   missed specifically rather than skipped generally.
2. Is buyer information actually available at open, or does it genuinely arrive later? If
   later, where should it be recorded when it does?
3. How are we contacting buyers on these files today, and what is that costing in time?
4. Can we work a daily exception list of purchase orders open with no buyer, starting with
   the 1,518 already open?

---

# Appendix — how these figures were derived

*Technical detail only; nothing here is needed to read the brief.*

## Sources

- Full evidence, per-file results, sample selection and the raw vendor probe are in
  `docs/tickets/SOFTPRO_MISSING_BUYER.md` on branch `diag/softpro-missing-buyer`
  (commit `89c0df3`).
- Vendor figures were measured against production SoftPro on 26 August 2026. No SoftPro
  calls were made for this brief.
- Counts in the body were re-derived from production Postgres on 27 August 2026,
  read-only. They differ slightly from the ticket because the population grows daily: the
  ticket recorded 2,103 of 3,584 purchase orders on 26 August, the same query returned
  2,159 of 3,671 on 27 August, and both are 59%. Refinance moved from 1,217/3,588 to
  1,239/3,663 (34% both days). Seller-present moved from 1,302 to 1,331 (62% both days).

## Caveats carried from the ticket

- The 21-file sample was stratified by branch, age band and status, ranked
  deterministically within each stratum, with the two small branches force-included. It is
  not random, and 19/21 is not a population estimate.
- The 1 file that returned nothing at all (`20016337-GLT`) is not evidence of vendor
  emptiness — it no longer resolves in either vendor endpoint despite enriching
  successfully in July. It is counted separately in the body for that reason.
- The buyer's-agent key is present on all 25 sampled responses but carried an actual agent
  name on 7 of them. "Returned on every response" refers to the key, not to a populated
  value.
- The confirmed-empty file that has since acquired a borrower and the one sampled file
  whose value our software dropped are the **same order** (`20021133-ONT`), not two
  separate cases.

## New queries run for this brief (read-only)

Trend by month opened:

```sql
SELECT to_char(date_trunc('month', o.opened_at), 'YYYY-MM') AS month,
       COUNT(*) AS purchase_orders,
       COUNT(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM order_parties p
                           WHERE p.order_id = o.id AND p.role = 'buyer')
       ) AS no_buyer,
       ROUND(100.0 * COUNT(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM order_parties p
                           WHERE p.order_id = o.id AND p.role = 'buyer')
       ) / COUNT(*), 1) AS pct
FROM orders o
WHERE o.source = 'softpro_sync' AND o.transaction_type = 'Purchase'
GROUP BY 1 ORDER BY 1;
```

By branch suffix — swap the `substring(...)` expression for `o.operational_status` to get
the status breakdown:

```sql
SELECT COALESCE(substring(o.file_number from '-([A-Za-z]+)$'), '(none)') AS branch,
       COUNT(*) AS purchase_orders,
       COUNT(*) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM order_parties p
                           WHERE p.order_id = o.id AND p.role = 'buyer')
       ) AS no_buyer
FROM orders o
WHERE o.source = 'softpro_sync' AND o.transaction_type = 'Purchase'
GROUP BY 1 ORDER BY purchase_orders DESC;
```

Recency, span, and how many are still open:

```sql
WITH miss AS (
  SELECT o.*
  FROM orders o
  WHERE o.source = 'softpro_sync' AND o.transaction_type = 'Purchase'
    AND NOT EXISTS (SELECT 1 FROM order_parties p
                    WHERE p.order_id = o.id AND p.role = 'buyer')
)
SELECT COUNT(*) AS missing_buyer,
       MIN(opened_at)::date AS earliest_opened,
       MAX(opened_at)::date AS latest_opened,
       COUNT(*) FILTER (
         WHERE operational_status NOT IN ('completed','closed','canceled','duplicate')
       ) AS still_open,
       COUNT(*) FILTER (WHERE opened_at >= now() - interval '90 days') AS opened_last_90d,
       COUNT(*) FILTER (WHERE opened_at >= now() - interval '30 days') AS opened_last_30d
FROM miss;
```

Returned: 2,159 missing buyer; opened 2025-03-05 through 2026-08-27; 1,518 still open;
1,102 opened in the last 90 days; 419 in the last 30.

The headline population query, the seller-signature query and the sample-selection query
are unchanged from §5 of the ticket and are not repeated here.
