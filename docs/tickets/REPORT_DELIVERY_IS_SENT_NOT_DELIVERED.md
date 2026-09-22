# "Delivered" needs evidence we do not have yet

**Status:** open — the word fixed, the evidence not built
**Raised:** 2026-09-22, while building Notify rep

## What was about to happen

Notify rep writes a row to `report_deliveries` for every attempt. It was going
to write `outcome = 'delivered'` the moment SendGrid accepted the message, and
the Reports list would have shown a green **Delivered**.

SendGrid accepting a message proves it left us. It does not prove it arrived:
a message SendGrid accepts can still **bounce**, be **dropped** (suppression
list, invalid address), or land in **spam**, and today we hear about none of
it. The delivery log exists to answer "did they get it" — and that word would
have answered a different question.

This is the County Sales defect in another column: a label stronger than the
evidence. The label comes down to the evidence.

## What was changed

- Migration **0060**: `report_deliveries.outcome` allows `'sent'` and
  `'failed'`. `'delivered'` is refused by the constraint.
- The Delivery column says **Sent**, with a navy dot. Green is kept for a
  Delivered that can be proven. The tooltip and the row's detail say
  "Accepted by SendGrid … Delivery not confirmed."

## What would earn the word Delivered

SendGrid's **Event Webhook**, which posts per-message events: `delivered`,
`bounce`, `dropped`, `deferred`, `spamreport`, and more. The build:

1. A webhook route, signature-verified (SendGrid's signed event webhook), that
   accepts events and matches them to our send by message id — Notify rep
   already stores the id in `outcome_detail`; store it in its own column so it
   can be indexed.
2. Widen the constraint, deliberately: `sent` → `delivered` | `bounced` |
   `dropped` | `spam`. Each keeps SendGrid's reason verbatim.
3. The Delivery column earns green for `delivered`, and a bounce becomes
   something the team can see and act on — which today it cannot.

A bounce is exactly the thing the team needs to know and currently can't. It
is a real build and worth doing; it is not done here.

## The same claim elsewhere, already live

The prelim and policy delivery paths record `delivered` on SendGrid acceptance
too:

- `src/lib/domain/notifications/prelim-auto-delivery.ts` — `outcome: 'delivered'`
- `src/lib/domain/notifications/policy-delivery-send.ts` — `outcome: 'delivered'`

Those send to clients and agents, so the gap matters more there, not less.
Not changed here — they have their own readers (the ops daily report counts
`'delivered'`) and a rename needs those found first. The webhook above fixes
all three at once, which is the better reason to build it.

## Measured 2026-09-22 — it is not theoretical

`scripts/audit/sendgrid-bounces.ts` (read-only) pulls SendGrid's suppression
lists and joins them to our own send log, which records every recipient and
subject. Since 2026-04-01 we made **5,524 deliveries to 869 addresses**:
2,448 prelim, 2,784 confirmation, the rest internal alerts and samples.

**17 of those sends went to addresses SendGrid had already suppressed** — 6
prelims and 11 confirmations, to 12 distinct addresses, the most recent on
2026-09-22. SendGrid answered every one with a 202. We logged success. Nobody
was told, and nobody could have been: a suppressed address is dropped
silently, which is what `bounce_drops` counts.

That is the gap this ticket describes, with a number on it. Not a large
number — but each one is a confirmation or a prelim that an escrow officer is
still waiting for, and the sender believes it arrived.

Loss by path, over the whole period:

| | addresses | bounced | blocked | spam |
| --- | --- | --- | --- | --- |
| prelim | 429 | 5 (1.2%) | 1 (0.2%) | 0 |
| confirmation | 664 | 3 (0.5%) | 6 (0.9%) | 0 |

Both paths are healthy. **The delivery rate is not the problem; the silence
is.** One address, `rosa@lincolnescrow.com`, bounced on the prelim path and
was then blocked on the confirmation path a week later — two different orders,
two different officers, neither told.

### Two things that fall out of the same measurement

**1. The dashboard is not ours to read.** The SendGrid account shows 99,943
requests for the period against our 5,524 — something else sends on this
account, so account-level bounce and deferral counts (1,395 `bounce_drops`,
4,071 `deferred`) are overwhelmingly not ours. Any future alerting has to
filter to our own sends, as this script does, or it will measure a stranger.

**2. Two addresses in our contact data are malformed** and will never deliver,
whatever we build:

- `nathalie@villalendinginc.comc.com` — `.comc.com`, a typo
- `julie.martincz@primclending.com` — very likely `primelending.com`

Both are live contact records that we mailed a confirmation to this month.
Worth a validation pass on the contacts table separately from the webhook.

## BUILT 2026-09-22 — the webhook

**Status: the evidence exists.** `POST /api/webhooks/sendgrid/events`,
signature-verified, filtered to our own mail.

### The scoping mistake worth recording

The plan above said to match events to "our send by message id — Notify rep
already stores the id in `outcome_detail`". Built exactly that way, this
webhook would have caught **none of the seventeen silent drops**, and would
have looked like it was working.

`report_deliveries` has **zero rows in production**. Notify rep has never been
used. All 2,874 client emails — every prelim, every confirmation, all
seventeen drops — are in **`notification_logs`**, which already carries the
SendGrid message id in `provider_id` on every single row.

The lesson is the familiar one: the plan named the table we had just built
rather than the table the mail actually goes through. Found by querying
production before committing, not by reasoning about it.

### Matched on message **and** recipient

One message id covers up to eight recipients — a confirmation goes to the
escrow officer, both agents and the cc list under one id, and production has
many such rows. SendGrid reports per recipient. Matching on the id alone would
have stamped one person's bounce onto all eight rows: seven lies for every
truth.

### What it does

- **Verifies** every batch (ECDSA P-256 over `timestamp + raw body`), with a
  ten-minute skew window against replay. No public key configured means
  *refuse*, never wave through. `SENDGRID_WEBHOOK_PUBLIC_KEY` must be set.
- **Filters to our own sends.** The account shows ~99,900 requests against our
  ~5,500. An event whose (message, recipient) we have no record of is counted
  and dropped, never stored.
- **Stores what SendGrid said, verbatim and append-only**, in `email_events`.
  Unique on (message, event, instant), so a retried batch cannot double-count
  a bounce.
- **Recomputes** the shown outcome from the full event history rather than
  applying each event in place, so late and out-of-order arrivals cannot
  produce a wrong answer.
- **Answers 500 on a storage failure**, so SendGrid retries. A 200 there would
  lose the batch — the exact silent failure this ends.

### The words

`delivered` is now earned. Green is reserved for it, as 0060 intended.
`bounced`, `dropped` and `spam` are kept separate because they need different
actions: a bounce means the address is wrong, a drop means we are still
sending to an address SendGrid gave up on weeks ago, and spam means we got
through and a person rejected us. `deferred` is deliberately **not** an
outcome — it is a retry in progress, and showing it would put an alarming word
against the ordinary case.

### Still to do

- **Turn it on.** SendGrid dashboard → Settings → Mail Settings → Event
  Webhook: post to `https://hub.pctdesk.com/api/webhooks/sendgrid/events`,
  enable signature verification, copy the public key into
  `SENDGRID_WEBHOOK_PUBLIC_KEY`. Until that is done this endpoint is correct
  and idle.
- **The two other `'delivered'` writers** (`prelim-auto-delivery.ts`,
  `policy-delivery-send.ts`) still record `delivered` on acceptance in
  `admin_activity_logs`. The webhook now corrects `notification_logs`
  underneath them, so the two disagree until those are changed to `sent`. Not
  done here: the ops daily report counts `'delivered'` and needs finding first.
