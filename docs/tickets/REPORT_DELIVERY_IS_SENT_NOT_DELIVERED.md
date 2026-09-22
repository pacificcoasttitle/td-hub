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
