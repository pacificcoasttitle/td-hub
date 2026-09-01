# SiteX APN lookup has never returned a result

**Status: FIXED. Cause established from the vendor's own OpenAPI spec, at no
cost — no billable call was needed.**
Opened: 2026-09-01

## The measurement

```
apn_lookup, ALL TIME:  13 calls, 0 succeeded
window:                2026-09-01 03:19:44 → 06:42:20   (one day, today)
every response:        HTTP 400 SXP-BadRequest "Missing required fields"
```

For comparison, in the same client:

```
property_lookup:       13,151 calls, 8,554 succeeded
```

So this is not a credentials, network or feed problem. One search mode works
and the other has never once worked.

## Correcting the first report of this

**It was first reported to Gerard as "a leading space in an APN
(`" 3093-521-31-0000"`) — small, ours, cheap." That was wrong**, and it was
wrong in a way worth recording: it generalised from the visible oddity in four
sample rows instead of counting all thirteen.

Whitespace appears on **1 of 13** failing calls, and on **0 of 6,061** stored
APNs in `order_properties`. Trimming would change nothing.

What the log actually shows is an operator retrying by hand, in different
formats, because it keeps failing:

```
03:19:44  "4317-003-061"        Los Angeles
03:19:47  "4317-003-061"        Los Angeles
05:57:17  " 3093-521-31-0000"   San Bernardino
05:57:41  "3093-521-310000"     San Bernardino
05:57:55  "3093-521-31-0000"    San Bernardino
05:58:09  "3093-521-31-0000"    San Bernardino
06:01:21  "3093-521-31-0000"    San Bernardino
06:41:24  "5178024010"          Los Angeles
06:42:14  "5178-024-010"        Los Angeles
```

Two APNs, five spellings each, all rejected identically. A person trying
variations, not a data defect.

## What we send

`src/lib/integrations/sitex/client.ts`, the apn_lookup branch:

```ts
searchUrl.searchParams.set('apn', params.apn);
searchUrl.searchParams.set('county', params.county);
searchUrl.searchParams.set('state', params.state ?? 'CA');
searchUrl.searchParams.set('feedId', config.feedId);
```

The working `property_lookup` sends `addr`, `lastLine`, `feedId`.

## Resolved: the vendor's own spec

`GET /realestatedata/search/schema/{feedId}` — free, non-billable — returns
SiteXPro's OpenAPI document. `GET /search` takes exactly twelve query
parameters:

```
addr, lastLine, owner, fips, apn, zip, clientReference, options,
feedId, isMailingAddress, latitude, longitude
```

with `fips` = "property fips code" and `apn` = "assessor's parcel number".

**`county` and `state` are not parameters.** They were silently ignored,
leaving `apn` + `feedId` — a search with no locality — which is why every call
was rejected as "Missing required fields".

The fix sends `fips` (5-digit state+county) instead. `fips5From` derives it
from the county table already built for Westcor, preferring a stored SiteX code
when one exists. The APN is also trimmed — not the cause, but a pasted space
would break a search that otherwise works.

### A free UAT environment, found in the same document

The spec lists three servers:

```
https://api.bkiconnect.com/realestatedata          (production, billable)
https://api.uat.bkitest.com/realestatedata         (UAT)
https://api-co-dev.dev.bkitest.com/realestatedata  (dev)
```

Worth pursuing separately: a UAT host would let SiteX changes be exercised
without spending production credits, which has been the constraint on every
SiteX change so far.

## The hypothesis before it was checked, and why it was NOT evidence

Gerard's reading: `/realestatedata/search` wants `fips`, and `county` + `state`
are not parameters it recognises — so the request reduces to `apn` + `feedId`,
has no locality, and is rejected as incomplete.

That was plausible and it fitted every observation. It also turned out to be
right. **But at the time it was stated it was a recollection, not a citation,
and an earlier version of this ticket presented it as "the documented parameter
set".**

Being right is not the same as being evidenced. The recollection was correct
and the promotion of it to a citation was still wrong — and had it been wrong,
nothing in the chain would have caught it.

**Our documentation does not settle it.**
`docs/cannon/SiteX-and-TitlePoint-Complete-Reference.md`, "Property Search
Endpoint", verbatim and complete:

```
GET {BASE_URL}/realestatedata/search
Authorization: Bearer {access_token}

Query params:
  addr      = street address (e.g., "123 Main St")
  lastLine  = "City, ST, ZIP" with commas (e.g., "Los Angeles, CA, 90001")
  feedId    = SITEX_FEED_ID
```

Three parameters. **No `fips`. No `apn`.** The same document lists the internal
APN endpoint as:

| `/property/lookup-by-apn` | POST | Search by APN **(stub)** |

So our documentation does not describe an APN search mode at all. It neither
supports nor contradicts the `fips` hypothesis — it is silent, and "(stub)"
suggests this was never a finished path.

## What settled it

Route 1, and it cost nothing: the vendor publishes its own spec at
`/realestatedata/search/schema/{feedId}`, and `/realestatedata/search/options/{feedId}`
returns the feed's option list. Both are free. Neither was known to us before
this ticket.

**The lesson is cheaper than the credit was going to be**: before paying a
vendor to answer a question about its own contract, check whether the vendor
publishes the contract. Two endpoints, one round trip, no charge.

## Blast radius while unfixed

Small and operator-visible. 13 attempts by one person in one day; every failure
is loud and immediate. No silent data loss, no customer impact. The feature
appears to be newly exposed in the UI, which is why the attempts are all from
today.

## Related

- `docs/claude-skills/claude-skills/watch-outs/writing-from-the-shape-of-the-problem.md`
  — instance 3 is this ticket's first draft, where the user's hypothesis was
  restated back as "the documented parameter set".

## Still unverified

The fix has NOT been exercised against SiteX. The parameter set is the
vendor's, the FIPS derivation is unit-tested against the real failing APNs
(Los Angeles 06037, San Bernardino 06071), but no search has been run — a
successful one costs a credit.

The next genuine operator APN search will confirm or refute it at no extra
cost, since that call would have been made anyway. If it fails, the response
body now tells us why.
