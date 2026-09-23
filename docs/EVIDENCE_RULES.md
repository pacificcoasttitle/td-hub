# What counts as evidence

Five rules, each one written the day it cost us something. They are all the
same rule wearing different clothes: **an artifact of how we invoked something
is not a fact about what the system does.**

Every entry names the incident, because a rule with no scar attached gets
argued with.

---

## 1 · A vendor accepting a message is not delivery

SendGrid answers `202` and then drops mail to a suppressed address. Seventeen
sends between April and September 2026 — six prelims, eleven confirmations —
were recorded as successful and reached nobody.

**The rule.** A write path's return value is evidence that the *call* was
accepted, never that the *effect* happened. Where the effect matters, find the
channel that reports it (SendGrid's event webhook) or say the weaker thing on
screen.

**What it looks like when applied.** The Delivery column says **Sent** on a 202
and **Delivered** only on a delivery event. Migration 0060 narrowed the column
so the stronger word could not be written; 0061 widened it once there was
something behind it.

---

## 2 · A status code is not proof the handler ran

The SendGrid webhook shipped, was probed live, returned
`401 {"error":"Unauthorized"}`, and was reported as correctly refusing
unsigned batches. It was refusing *everything*: the middleware demanded a
session and answered before the route, with a body byte-identical to the
route's own refusal. The handler had never executed.

**The rule.** When two layers can produce the same response, the response
cannot tell you which one produced it. Find something only the layer you care
about would leave behind — here, the `vendor_api_logs` row the handler writes
on every refusal. There were none, all along.

**What it looks like when applied.** Verify a webhook by its log row, not its
status code. `src/middleware.test.ts` now asserts every route under
`api/webhooks` is reachable without a session.

---

## 3 · A local render is evidence about the renderer, never about production

A local render of the Concierge document was given `compMapImage: null` and a
capture date, and printed "Map captured September 18" under "Comparable map not
available". That was reported as a production defect. It was the harness: the
real path loads the stored map and prints neither line.

**The rule.** A document rendered locally with hand-made inputs tells you
whether the *layout* is right. It tells you nothing about what production
produces, because production's inputs come from somewhere the harness invented.
To make a claim about production, render through the production path — for
Concierge and the farming reports that is free, because a re-render reads
stored data and calls no vendor.

**Why this one will recur.** The fastest way to look at a document is a local
render with fixtures, so it is the thing to hand exactly when someone asks
"does this look right". The answer is only ever about the renderer.

---

## 4 · A guard is not a guard until it has been shown to fail

This is the most expensive rule on the page, because a broken test does not
merely fail to catch a bug — **it certifies that there isn't one.** Every other
rule here describes something going unnoticed; this one describes something
actively vouching for the thing it was meant to check.

Four instances in a single month, each found by accident:

| | what passed, and why it proved nothing |
| --- | --- |
| County Sales fixture | Irvine's prices were symmetric, so mean and median were the same number. A mean/median swap passed every assertion. |
| Client-bundle guard | It timed out at five seconds and reported green. It had found nothing because it had not finished. |
| Carrier-route parity | The fixture's rejected row was kept with nulls rather than rejected, so `total === used` whatever the code under test returned. |
| Transfer audit rows | The fixture set `DocumentNumber`; the normaliser reads `RecorderDocumentNumber`. The assertion would have compared `undefined` to `undefined`. |

Note the last two were caught by *the guard's own meta-check* — an assertion
that the fixture exercises the difference — not by review. That is the only
mechanism here that scales.

**The rule, in three parts.**

1. **Assert the guard is still measuring.** It found the files. The fixture is
   populated. The values are asymmetric. The field list is not empty. Without
   this a guard degrades silently as the code around it changes.
2. **Mutate the thing it guards and watch it fail.** Break it on purpose,
   confirm the failure names the right thing, put it back. A guard never seen
   red is a guess.
3. **Pick the mutation someone would actually make.** Not `return false` —
   the tidy-up. An integer cast on a fractional bath. A filter that skips rows
   with a missing figure. Those are the changes that get made while
   improving something, which is when nobody is looking for a regression.

**Why it needs writing down.** Every instance above was caught by habit, in the
moment, by someone who happened to ask. Habits do not survive handoffs, and the
failure is invisible by construction: a green test that tests nothing looks
exactly like a green test.

---

## 5 · Check the payload, not the sample

The design mock's legal description read `TRACT # 14627`. Both live payloads
read `TRACT NO 6654`, so the first parser captured the word **NO** as the tract
number on every profile we own. The structured `TractNumber` field was there
all along, which no sample would have shown either.

**The rule.** One example is a shape, not a contract. Before writing a parser,
look at the real data — and before writing a parser at all, check whether the
vendor already sends the value structured.

---

## The shape they share

In every case the reassuring reading was available and cheap, and the
disconfirming check was available and nearly as cheap. The habit worth keeping
is not suspicion — it is asking *what would I see if this were broken?* before
deciding it is not.
