# Prelim age guard — recent ones mail, old ones do not

**Status:** shipping. Opened 2026-09-17.

Prelim delivery is completely off in production as of 00a8e1aa. That's
correct for today and it can't stand: the only other send path is a webhook
that has never fired once, so right now no prelim can ever reach a client
automatically.

Get the age rule into that same path today so recent prelims resume
delivering and old ones don't. Until it lands, every prelim that arrives is
silently undelivered — which is the exact failure mode we've spent this week
finding.

## What the rule is

`maybeAutoDeliverPrelim` will not mail a prelim older than **three Pacific
calendar days**. Age is:

1. SoftPro's document/event time, when the payload carries one
2. else the order's `opened_at`
3. else fail closed (`skipped_older_than_window`, no send)

Hub `created_at` is not consulted. A recovery fetch stamps today on every
row; measuring that clock is how a 20-day catch-up would look like news.

`needs_manual_delivery` is false on the age skip. Older prelims are hub
visibility only.

## What this PR does

- Re-arms live `fetch_prelims` (`deliver: true`). That is the only path that
  has ever actually mailed.
- Leaves the T&E one-shot at `deliver: false`. A months-old T&E land is not
  this rule.
- Webhook stays `deliver: true` and treats `skipped_older_than_window` as an
  expected outcome.

## What it is not

Not a spreadsheet. Not a settings flag. Not "don't fetch." The document
still stores. Delivery decides from the prelim's own age.

The Aug 27 backfill gate (`skipped_backfilled_order`) is a different clock:
order import lag. See `PRELIM_GATE_MISSES_DOCUMENT_FETCH_LAG.md`. That ticket
told us not to paper over a bulk land by guessing document age. This rule is
the product cutoff Jerry locked on 2026-09-17 (17 Sep → 14 Sep onward), not
that paper-over.
