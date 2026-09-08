# 1,685 "people" with no name are companies filed as persons

Found when the lender contacts page went live and two-thirds of it rendered as
em dashes.

## What they are

```
nameless rows on the lender page          1157
nameless rows on the mortgage broker page  528
                                          ----
                                          1685
```

Not people missing a name. **Companies stored as `type='person'`.** Every one:

```
lookup_code   1159  (100%)   company-shaped: 4 letters of name + 4 of address
address1      1157  (100%)
company_name     0  (0%)
email           34  (3%)
phone           48  (4%)
```

The codes are the giveaway — `Vict217L2`, `Victo217`, `VIPB20501` — which is
`companyLookupBase`, not `personLookupBase`. A person's code is 3 + 3 + 4 of
first, last and company; these are 4 + 4 of name and address.

All arrived in the same **2026-03-12** SoftPro import.

## Nothing renders for them, and nothing can

`cName()` falls back to an em dash, so the page is not blank — it is 1,157 rows
of `—`. There is no better fallback available: only 3% have an email and none
has a company name, so showing the email would have fixed 34 rows of 1,159. That
was the first fix proposed and it was measured before it was built.

## Hiding them is safe — checked, not assumed

```
same lookup_code exists in companies      1157  (100%)
no company with that code                    2
  ...of those, address matches a lender co   2
neither code nor address matches             0
```

**Zero are the only record of their firm.** Every one is already on the company
side, so `namedContactFilter` removes nothing that cannot be seen elsewhere.

Blast radius, also measured before choosing where to apply it:

```
type                        listed  nameless  remain
lender                        1704      1157     547
mortgage_broker               1000       528     472
escrow_officer (external)      719         0     719
real_estate_agent             1910         0    1910
title_officer / sales_rep        2         0       2
```

Nameless rows exist **only** on those two types, so the filter is opt-in and no
existing page changes. Contact search is untouched.

## Hiding is the presentation fix. Retyping is the real one.

These rows are the wrong type. The actual repair is retyping them as companies —
a data change on live records, which needs Gerard, and is deliberately **not**
proposed here.

## Shared root

Same 2026-03-12 import as two other populations already ticketed:

- `DUPLICATE_CONTACTS.md` — 1,420 duplicate person rows
- the 4,790 contacts with no `softpro_lookup_code`

Three malformed populations from one import is worth treating as one question
rather than three tickets, when somebody has time to ask it.

## Closed by measurement: the stamping work

The backfill plan once included stamping ~2,451 codeless contacts with SoftPro
codes before importing, to stop the import inserting duplicates beside them.

**That was measured against the wrong denominator and is not needed.** Against
the real missing set:

```
the real gap                                                  1476
of those, would insert beside a codeless contact of ours         0
genuinely new people the backfill adds                        1476
```

Zero collisions. The stamp-then-backfill sequence, the 2,451 candidates, the
stratified sample and the email check are all closed. Do not restart them on the
strength of the earlier 2,609 — that number counted every codeless contact
against every SoftPro row, not against the people actually missing.
