# Prelim auto-delivery is OFF — temporary, and must not stay that way

**RESOLVED.** Prelim auto-delivery was fully off for 18 minutes and is now
age-guarded.

| When (UTC, 2026-09-17) | State |
|---|---|
| 17:34 | #154 deployed: the fetch path ingests with `deliver: false`. Nothing auto-delivers. |
| 17:52 | #156 deployed: the age guard. A prelim issued within `PRELIM_AUTO_DELIVERY_MAX_AGE_DAYS` (3) delivers; older ones are stored and skipped as `skipped_older_than_window`. |
| 18:51 | #157 deployed: the held-prelim retry goes through the same guard. |

Age is taken from `resolvePrelimIssuedAt` — SoftPro's document date, falling back
to the order's open date — NOT `documents.created_at`, which is the date the hub
fetched it.

Confirmed in production: at 18:01 an order opened 2026-07-14 was stored and
skipped as `skipped_older_than_window`, and between 18:14 and 18:16 nine prelims
for orders opened 2026-09-14 delivered normally.

## What happened

A SoftPro-side automation that generates the prelim summary on document upload
failed, and prelims stopped reaching the hub for up to 20 days. Recovering them
means fetching old prelims now, and the ingest path delivered on arrival, so a
three-week-old prelim fetched today would have been mailed as if it were news.
Gerard: no emails for the backlog.

#154 (Cursor) is the emergency stop: `softpro.fetch_prelims` now ingests with
`deliver: false`.

## Why a permanent stop would not have been a resting state

That job was the ONLY path that has ever auto-delivered a prelim:

- 1,164 automatic prelim deliveries in the system's history, every one with
  `triggered_by = fetch_prelims` (checked 2026-09-17).
- The prelim webhook, the other path wired to deliver, has never logged a single
  call (`vendor_api_logs`, vendor `softpro_webhook`: zero prelim rows, ever).
- Deliveries were running at 7–35 a day in the week before the stop.

So with the stop in place, **prelims quietly stop going out**: escrow officers and
sales reps get nothing unless someone presses Deliver Prelim by hand. That is the
failure this incident started from — prelims not reaching people, and nobody
noticing for weeks.

## The follow-up that shipped: the age rule

#156 and #157 (Cursor). A prelim issued within 3 days delivers as before; an
older one is stored, shown in the hub, and recorded as
`skipped_older_than_window`. Age comes from SoftPro's document date, with the
order's open date as the fallback.

## How to know it is back on

After the age rule deploys, within a business day:

```sql
select created_at::date, count(*)
from admin_activity_logs
where action = 'prelim_auto_delivery' and meta->>'outcome' = 'delivered'
  and created_at > now() - interval '3 days'
group by 1 order by 1;
```

Zero rows on a business day with new orders means delivery is still off.

## Side effects of the recovery to tell the team

- **Fresh dates on old prelims.** A prelim fetched today shows today as its
  "Prelim Received" / "Issued" date on the order, even if SoftPro issued it three
  weeks ago. The date is when the hub got it, not when it was written.
- **TESSA summaries lag.** Recovered prelims show "No Analysis Yet" until the
  fetch_prelims cron analyzes them, five per run.

## Recovery fetch

`scripts/one-off/backfill-prelims-from-softpro.mts` (#153): orders with no stored
prelim, opened since 2026-08-28 (then older active ones), via
`GetAttachedDocumentsPrelim`, ingested with `deliver: false`. One request at a
time, 2 s pause, 1,600-request ceiling. Started 17:28 UTC, paused 17:30 while
delivery was checked (nothing sent), resumed after #154 was live.

Verified on the first three (20022323-GLT, 20022322-OCT, 20022317-OCT), through
the functions the screens call, against a normally ingested prelim: shown on the
admin Documents tab and Find Prelim, the client portal, the order detail (Prelim
Received milestone), and the hub badge/tile; opens from S3 as a PDF; no delivery
rows.
