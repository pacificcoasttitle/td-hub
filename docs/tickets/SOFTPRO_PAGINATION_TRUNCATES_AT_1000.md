# The contacts sync reads 1,000 rows and stops — silently, today

**Read-only investigation, 2026-09-03. Nothing changed. This is live.**

## What is happening

`sync-contacts.ts` pages SoftPro's lookup table like this:

```ts
let hasMore = true;
while (hasMore) {
  const adapterResult = await getLookupTable({ userType, Page: page, pageSize, ... });
  ...
  hasMore = adapterResult.data.hasMore;   // ← always false
  page += 1;
}
```

and `getLookupTable` builds that flag like this:

```ts
hasMore: raw.HasMore === true || raw.hasMore === true,
```

**SoftPro does not put it at the top level.** The real envelope:

```
top-level keys: Status | Message | Pagination | data
Pagination: {"Page":1,"PageSize":1000,"TotalRows":15609,"TotalPages":16,"HasMore":true}
data: array(1000)
```

`raw.HasMore` is `undefined`, so `hasMore` is `false`, so the loop stops after
one page. Every sync of every contact type has read at most 1,000 rows.

**The vendor is not lying.** `Pagination.HasMore` is `true` and correct, and
they also hand us `TotalRows` and `TotalPages`. We read the wrong key. That
matters for who fixes it and for what we tell Aashima — this one is ours.

## How much we are missing

Measured directly against the live endpoint:

```
userType                     TotalRows  TotalPages  we read   missing
Order Contact - Person       15609      16          1000      14609   (94%)
Escrow Company                2793       3          1000       1793   (64%)
Listing Agent/Broker          1539       2          1000        539   (35%)
Selling Agent/Broker          1539       2          1000        539   (35%)
Lender                        1479       2          1000        479   (32%)
Mortgage Broker                552       1           552          0
Title Officer                    7       1             7          0
Escrow Officer                   6       1             6          0
Underwriter                      2       1             2          0
Sales Representative             0       0             0          0
```

**Roughly 18,000 rows have never been synced.** The five types that fit inside
one page are fine, which is exactly why this went unnoticed: every small table
looked complete, and the big ones looked plausible.

`Escrow Company` at 2,793 is the one already known to have lost months of sync.
The cause is the same flag, still unfixed in the parser.

## Scope of the sweep

Every production path that paginates a SoftPro endpoint:

- **`sync-contacts.ts:720`** — the only paging loop in the codebase, and the
  one described above.
- `getOrders`, `getOrderDetails`, `getOrderContacts`, `getAttachedDocuments`,
  `getFees`, `getSalesReps` — date-range or single-key calls with no `Page`
  parameter. They cannot truncate on a flag because they do not read one.
  (Whether the server caps a wide date range is a separate question this
  ticket does not answer.)
- Probed live: `GetOrderMarketingRep` returns no `Pagination` envelope and all
  48 rows. `GetLookuptable` is the only one that paginates.

Nothing anywhere in `src/lib/` reads the string `Pagination`. Grep returns
nothing.

## The rule this becomes

> **Paginate until a page comes back empty. Never trust a vendor's
> more-data flag.**

Even where the flag is correct, it costs one extra request to not depend on it,
and this is the second time the same field has silently capped a sync. A
transient empty page is also possible — `Page=1` returned zero rows once during
this investigation and returned 1,000 on retry — so "empty" should mean
*empty after a retry*, not empty once.

## Not proposed here

The fix is small and obvious, but this ticket is the read-only report that was
asked for. Worth deciding deliberately: a corrected sync will pull ~18,000 rows
it has never seen, and the duplicate-contact situation
(`docs/tickets/DUPLICATE_CONTACTS.md`) means that import wants a plan, not just
a working loop.
