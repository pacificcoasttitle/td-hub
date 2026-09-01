# SiteX APN lookup has never returned a result

**Status: OPEN. Cause not established. Do not fix from the reasoning below —
it is unverified.**
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

## The leading hypothesis, and why it is NOT yet evidence

Gerard's reading: `/realestatedata/search` wants `fips`, and `county` + `state`
are not parameters it recognises — so the request reduces to `apn` + `feedId`,
has no locality, and is rejected as incomplete.

That is plausible and it fits every observation. **It is not confirmed, and an
earlier version of this ticket wrongly presented it as documented.**

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

## What would settle it

One of:

1. **Vendor documentation we do not currently hold.** The BKI/SiteX Pro API
   reference for `/realestatedata/search`. Cheapest if someone has it.
2. **One billable call.** A successful `/search` costs one credit. Sending
   `apn` + `fips` + `feedId` for a known-good parcel would confirm or refute in
   a single request. **Requires explicit approval — not yet given for this
   specific call.**
3. **Asking SiteX** what an APN-mode search requires.

Route 1 is free and should be tried first.

## Blast radius while unfixed

Small and operator-visible. 13 attempts by one person in one day; every failure
is loud and immediate. No silent data loss, no customer impact. The feature
appears to be newly exposed in the UI, which is why the attempts are all from
today.

## Related

- `docs/claude-skills/claude-skills/watch-outs/writing-from-the-shape-of-the-problem.md`
  — instance 3 is this ticket's first draft, where the user's hypothesis was
  restated back as "the documented parameter set".
