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
