# apn_lookup logs nothing that reconciles against an invoice

**Status:** open, not implemented. Raised out of the resolve-first work
(#228) and deliberately kept out of it — Gerard, 16 Oct 2026: "same fix as
#227, different operation. Not today."

**Why it is separate:** #227 fixed `property_search` by adding the four fields
its 200 branch never wrote. `apn_lookup` is a different operation on the same
client with the same hole, and folding it into #228 would have put an untested
logging change inside the PR that moved where money is spent.

## The damage

Every `apn_lookup` line ever written is missing the two fields that make a
charge traceable. Measured against all of `vendor_api_logs` where
`vendor = 'sitex'`:

| operation | lines | no `creditsCharged` | no `searchId` | no `httpStatus` | first seen |
| --- | --- | --- | --- | --- | --- |
| `property_search` | 2,195 | 2,195 | 2,195 | 1,668 | 2026-03-23 |
| `apn_lookup` | **499** | **499 (100%)** | **499 (100%)** | 454 | 2026-08-31 |
| `concierge_profile` | 47 | 0 | 0 | 30 | 2026-08-24 |

`concierge_profile` is the column to read across: the concierge feed has
recorded the cost and the SearchId since the day it shipped. The same response,
the same field, two readings of it that drifted apart — which is exactly what
#227 said about `property_search`.

`property_search`'s row is historical: #227 merged 2026-10-16 17:21, and the
last line above it (17:14:57) predates that deploy. Lines after it should carry
all four. `apn_lookup`'s row is current.

## Why it matters

A SiteX charge is reconciled against an invoice line by its **SearchId**. With
no SearchId and no credit count, 499 parcel lookups cannot be matched to
anything: the question "did this invoice line come from us, and from which
request?" has no answer for any of them.

It is also the lookup the orders flow uses most heavily for condominiums, which
is where a double charge is most likely — the exact failure the resolve-first
work removed from the Reports flow.

## The fix

The same one, in the same file. `apn_lookup`'s success branch in
`src/lib/integrations/sitex/client.ts` should write what the
`property_search` branch now writes:

```ts
responseMeta: {
  match: result.match,
  locationCount: result.locations.length,
  httpStatus: response.status,
  searchId: raw.OrderInfo?.SearchId ?? null,
  creditsCharged: 1,
  matchCode,
}
```

`SiteXSearchResponse.OrderInfo` already carries `SearchId` — it was declared in
#227 and needs no further type work.

## What it cannot recover

The 499 existing lines. The SearchId was in a response nobody kept, so the
backfill does not exist; this stops the gap growing rather than closing it. Say
that plainly if anyone asks for a reconciliation covering 31 Aug – 16 Oct.

## How to check it worked

```bash
npx tsx --env-file=.env.local scripts/audit/resolve-first-log-check.mts --minutes 60
```

Its last section counts `property_search` and `apn_lookup` lines with no cost
or SearchId, and says which nulls are legitimately historical. An `apn_lookup`
line written after that deploy with nulls means the fix is not taking effect.
