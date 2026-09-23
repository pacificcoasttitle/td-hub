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

## 4 · A test that passes without running proves nothing

The client-bundle guard timed out at five seconds and was reported green. It
had found nothing because it had not finished. The County Sales fixture had
symmetric prices, so a mean/median swap passed every assertion. A round-trip
fixture of nulls would pass every field comparison while comparing nothing.

**The rule.** A guard needs a check that it is still measuring: assert it found
the files, that the fixture is populated, that the values are asymmetric. Then
mutate the thing it guards and watch it fail.

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
