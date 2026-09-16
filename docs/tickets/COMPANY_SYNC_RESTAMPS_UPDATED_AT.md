# The company syncs restamp updated_at, and count every row as updated

**Opened:** 2026-09-15 · **Status:** noted, not fixed. Not a data defect.

## What happens

`syncCompanyType` (escrow company, lender, mortgage broker, selling agent,
underwriter) writes two tables per vendor row: the `companies` record, and the
`contacts` row matched on `flookup_code`. Both writes go through
`omitEmptyForUpdate(vals)` — and `vals` always carries `updatedAt: new Date()`.

So every row the sweep matches is written, whether or not any value changed,
and counted as `updated`.

Measured on 2026-09-15, the first day the sweeps completed after #137:

```
escrow company sweep  18:45  3 pages  reported updated 2,795
lender sweep          18:55  2 pages  reported updated 1,481   (9 genuinely created)
contacts rows with updated_at in those windows                 2,585
```

Nothing wrong was written. The person sync does compare before writing
(`OPEN_CONTACT_FIELDS`), which is why its run reported 10 created / 14 updated
against 3,000 rows read.

## Why it matters

1. **`updated` from a company sweep is not a change count.** Reading it as one
   makes a quiet sweep look like a busy one, and hides a sweep that really did
   change something.
2. **`contacts.updated_at` is not a change timestamp** for any row a company
   sweep touches. Anything that reasons about recency — including the drift
   measurement designed in `ORDER_CONTACT_REFRESH.md` — must compare values, not
   timestamps.
3. It writes ~4,300 rows a day that did not need writing, which is cheap but not
   free.

## The fix, when it is worth doing

Compare before writing, the way `syncOpenContacts` does: name the fields the
company sync owns, skip a row whose fields all match, and count `unchanged`
separately from `updated`. It is the same shape as the change made to the
person sync on 2026-09-09.
