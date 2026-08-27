# `other` is the largest party role, and it is two missing enum values

**Status: measured, NOT fixed.** No remediation attempted.
Opened: 2026-08-26
Found: incidentally, while sizing the hub detail pane's parties section.

## The number that started it

`order_parties` role distribution, all 8,036 orders:

| role | rows | orders |
|---|---:|---:|
| **other** | **13,851** | **6,946** |
| escrow_company | 6,338 | 6,338 |
| buyer | 5,753 | 4,157 |
| seller | 3,693 | 2,482 |
| lender | 3,312 | 3,312 |
| listing_agent | 2,058 | 2,058 |
| lender_contact | 1,576 | 1,573 |
| buyer_agent | 25 | 25 |
| borrower | 0 | 0 |

`other` is larger than any real role — larger than buyer and seller combined.

## It is not a catch-all swallowing arbitrary parties

That was the worry. It is not what the data says. 99.3% of the bucket is
three company names:

| what is in `other` | rows |
|---|---:|
| Pacific Coast Title Company | 6,876 |
| Westcor Land Title Insurance Company | 5,949 |
| Commonwealth Land Title Insurance Company | 933 |
| everything else (≈14 distinct values, incl. `WC`, `GLT`, `OCT`) | 93 |

Two independent signals agree that this is exactly two roles per order, not a
grab bag:

- **6,905 of the 6,946 orders have precisely 2 `other` rows.** 41 have one.
  None has three.
- The two are always the same kinds of thing: **the title company** (us,
  Pacific Coast) and **the underwriter** (Westcor, Commonwealth, and the long
  tail of competitor title companies on the odd order).

`WC`, `GLT`, `OCT`, `CW` are branch or company abbreviations that were not
expanded — a separate, much smaller data-quality issue in the same feed.

## The cause

`party_role` has no value for either concept:

```
buyer, seller, buyer_agent, listing_agent,
lender, lender_contact, escrow_company, borrower, other
```

No `title_company`. No `underwriter`. The sync has nowhere correct to put
them, so it puts them in `other`. Nothing is being lost or misrouted — the
schema simply cannot express the two most reliably-present parties on a title
order.

**And the destination already exists elsewhere.** `orders` carries
`title_company_id` and `underwriter_id` FK columns pointing at `companies`.
So the same two facts have a typed home on the order and an untyped home in
`order_parties`, and the party sync writes to the untyped one.

## Shape of the rows

All 13,851:

| | |
|---|---:|
| `contact_id` set | **0** |
| `external_company` set | 13,851 (100%) |
| `external_email` set | 12,852 (92.8%) |
| `external_name` set | 6,845 (49.4%) |
| `is_primary` true | 6,934 |

Every one is unresolved free text. None is linked to a `contacts` or
`companies` row, so none of this participates in dedup, search, or reporting.

## Also observed

`source` is NULL on **every** row of `order_parties` — all 36,606, every role,
not just `other`. The column records nothing at all. Whatever it was meant to
distinguish, it does not.

Creation is concentrated in two months — 10,937 rows in June 2026 and 2,829 in
July — consistent with a backfill rather than steady per-order writes.

## What a fix would involve, when someone owns it

Sketched only, not proposed, and deliberately not attempted here:

1. Add `title_company` and `underwriter` to `party_role`.
2. Reclassify by company name, which the numbers above suggest is reliable —
   but reclassification MUST be verified per-row against the order's existing
   `title_company_id` / `underwriter_id` before it is trusted, not inferred
   from the name alone. A title company on one order is an underwriter on
   another.
3. Decide whether `order_parties` should hold these at all, given `orders`
   already has typed FK columns for both. Duplicating them is how they drifted
   apart in the first place.
4. `borrower` has zero rows across 8,036 orders. Worth confirming it is
   genuinely unused before anyone treats the enum as documentation.

## Impact today

Low and cosmetic, which is why this is a ticket and not a fix. The hub detail
pane's parties section shows named roles and would render these two as
"Other", twice, on nearly every order. The pane ships listing the roles it can
name; these two are excluded from that list until they have real values,
rather than shown as two anonymous "Other" rows.
