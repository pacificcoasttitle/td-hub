# The confirmation email leaves before the documents exist

**Status: DIAGNOSED. Record fix built. Timeout change NOT made — see "This is a stopgap".**
Opened: 2026-09-09

Reported as "grant deeds reach SoftPro but are not on the confirmation email".
The documents are not failing. The email is early.

---

## The diagnosis, in one comparison

For orders that have both a grant deed and a confirmation, compare
`documents.created_at` against `notification_logs.sent_at`:

```
orders with both                            221
grant deed created AFTER the email sent      41   (18.6%)
grant deed created before                   180
average margin                              -12 seconds
```

**After** means the document did not exist when the email was assembled. This
is a race, not a selection bug.

How tight a race:

| grant deed vs email | orders |
|---|---|
| 1–5 min before | 17 |
| under 60s before | 163 |
| **under 60s after — lost** | **21** |
| 1–5 min after — lost | 19 |
| 5–60 min after — lost | 1 |

184 of 221 land within a minute either side. Every order is a photo finish.

## Why: the gate is a 10-minute clock and the work takes longer

`getConfirmationReadiness` releases the confirmation when legal vesting **and**
tax are terminal — or, if they are not, when a timeout expires.
`open_order_confirmation_timeout_minutes` is **10**.

Legal vesting durations, 236 completed searches over 90 days:

```
p50   7.1 min      p90  15.6 min      p99  61.0 min
p75  11.3 min      p95  24.8 min      max  83.8 min
```

**34.3% of legal vesting searches run past 10 minutes.** The timeout is set
below the tail of the distribution it is supposed to bound, so a third of the
time the clock wins and the email goes out mid-search.

Worked example, `20021993-GLT`:

```
15:42:31   legal vesting search created
15:52:48   tax completed
15:53:31   CONFIRMATION SENT          <- 10-minute timeout, LV still running
15:54:31   legal vesting completed
15:54:32   grant deed created
15:54:45   both documents synced to SoftPro
```

## Grant deed is the second-worst case

Same 14-day window, same race, by category:

| document | orders with it | created after the email |
|---|---|---|
| legal vesting | 230 | **45 (19.6%)** |
| grant deed | 217 | 41 (18.9%) |
| tax roll | 223 | 11 (4.9%) |

Legal vesting misses most often and is the one the code treats as required.
The team reported the grant deed because of what the email *says* — see below.

By order source, 14 days: `manual_entry` 36 of 212 (17.0%);
`softpro_sync` 5 of 5 — but all five are one 16-minute batch on 1 September on
orders created 1–16 hours earlier, not an ongoing pattern in the synced path.

## What the customer is told, which is the worse half

- **Legal vesting missing** → the body says *"Pacific Coast Title will send the
  title documents for this property separately."* **Nothing in the system does
  that.** There is no follow-up send: **0 second sends across 239 confirmed
  orders**, and double-send is actively guarded. A human has to notice.
- **Only the grant deed missing** → it is classified optional, so the email
  says **nothing at all**. The customer is not told. That is why this surfaced
  from the team rather than from a customer.

## The two lists are not the bug

The confirmation's attachment query and the SoftPro `AddDocuments` query are
separate code but agree on substance: same table, same three categories, same
`status = 'active'`. SoftPro additionally takes `is_synced_to_softpro = false`
and sends every matching row where the email takes one per category.

Neither difference explains this. **They read the same data at different
moments.** SoftPro's attach defers while TitlePoint is in flight and retries on
a 10-minute cron, so it eventually catches everything. The email has one shot.

---

## 1. The timeout the data supports

**25 minutes catches 95.3%.** Full trade-off, 236 searches:

| timeout | caught | still sends incomplete | rescued vs today | those wait, avg |
|---|---|---|---|---|
| **10 (today)** | 66.5% | 79 | — | — |
| 15 | 88.6% | 27 | 52 | 11.9 min |
| 20 | 92.8% | 17 | 62 | 12.7 min |
| **25** | **95.3%** | **11** | **68** | **13.5 min** |
| 30 | 97.5% | 6 | 73 | 14.4 min |
| 45 | 98.3% | 4 | 75 | 15.1 min |

**Confirmed from the code: a longer timeout costs fast orders nothing.**
`getConfirmationReadiness` returns `{ ready: true, reason: 'complete' }` as soon
as both gated searches are terminal, and that branch returns *before* the
timeout is read — the clock is only consulted when something is still missing.
An order whose searches finish in four minutes confirms in four minutes whatever
the timeout says.

So the only orders a longer timeout affects are ones that would have sent
incomplete:

- **68 of them get a complete email instead of an incomplete one**, arriving on
  average 13.5 minutes after the search started rather than at 10.
- **11 still send incomplete**, now at 25 minutes instead of 10. That is the
  entire cost: 11 of 236 (4.7%) wait an extra 15 minutes for the same
  incomplete email they get today.

30 minutes is the better knee if you want it — 97.5% for six residual cases —
but 25 is the answer to the question asked. No value short of an hour catches
everything; p99 is 61 minutes.

## 2. Record what the email carried — BUILT

`notification_logs.metadata` was **null on all 961 sends**. The only available
question was "did the document row exist before `sent_at`", which cannot
distinguish *never generated* from *generated and failed to attach* — and the
second is silent, because an S3 download failure at send time is caught and
logged to `vendor_api_logs`, not to the send.

Every confirmation now writes, on every recipient row:

```json
{
  "attached":   ["legal_vesting", "tax"],
  "eligible":   ["legal_vesting", "tax", "grant_deed"],
  "dropped":    ["grant_deed"],
  "filenames":  ["...pdf", "...pdf"],
  "outstanding": false
}
```

`eligible` is what existed, `attached` is what went, `dropped` is the
difference. Kept apart rather than collapsed into a count, because "we had
nothing to send" and "we had it and lost it" need different fixes and a single
number cannot separate them afterwards. Same discipline as write-accepted
versus listing-confirmed on the SoftPro side.

**This is deliberately first.** Without it a timeout change can only be shown to
move a number, not to have worked.

## 3. "Will send separately" is a promise nothing keeps

Not decided here — it is customer-facing copy. Two honest options:

- **Make it true.** A follow-up send when the outstanding document lands. The
  existing design note in `confirmation-documents.ts` argues against a second
  message titled "Confirmation"; a distinct "Title documents for <file>" is not
  that, and would keep the promise.
- **Make it accurate.** Say what actually happens — the documents follow by
  hand — or drop the sentence and let the absence speak.

Leaving it is the worst of the three: the customer reads it and waits.

---

## This is a stopgap, and the ticket says so on purpose

Raising the timeout tunes a clock. **The pipeline rebuild removes the clock.**
Phase C is sequential — C2 (send the confirmation) cannot start until C1 (all
documents terminal) has finished, so there is no gate and no timeout to size.
`completion-checker.ts` already carries the same note at the anchor logic.

Small finding while checking that reference: the comment there cites
`docs/tickets/OPEN_ORDER_PIPELINE_REBUILD.md`, **and no such file exists in this
repo** — the rebuild is tracked outside it. Not repaired here, because writing a
file to satisfy a pointer would be inventing the design doc rather than linking
it. Whoever owns the rebuild should either add it or fix the pointer.

A 25-minute timeout makes one in twenty orders send incomplete instead of one in
three. It does not make the confirmation wait for the documents, because nothing
in this design can. **Do not let the stopgap become the answer.**
