# Prelim auto-delivery is OFF — temporary, and must not stay that way

**Status: OFF since 2026-09-17 17:34 UTC** (production deploy of #154).
**Must be followed by:** the age rule below. Until it ships, no prelim is
emailed to anyone automatically — not the backlog, and not today's orders.

## What happened

A SoftPro-side automation that generates the prelim summary on document upload
failed, and prelims stopped reaching the hub for up to 20 days. Recovering them
means fetching old prelims now, and the ingest path delivered on arrival, so a
three-week-old prelim fetched today would have been mailed as if it were news.
Gerard: no emails for the backlog.

#154 (Cursor) is the emergency stop: `softpro.fetch_prelims` now ingests with
`deliver: false`.

## Why this is not a resting state

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

## The follow-up: the age rule

In the same fetch path, deliver a prelim only when it is recent; store old ones
without sending. Gerard's instruction: nothing older than three days goes out.

- Recent (SoftPro issued / uploaded within 3 days): ingest and auto-deliver as before.
- Older: ingest, visible in the hub, no email.
- Decide what "age" is measured from. NOT `documents.created_at` — a prelim
  fetched today has today's `created_at` whatever SoftPro's date is.
  `GetAttachedDocumentsPrelim` returns `ModifiedAt`; the order's open date is a
  fallback.

Owner: Cursor (delivery side).

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
