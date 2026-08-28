# Watch-Out: Endorsement Is Not Corroboration

## The line

> **Endorsement is not corroboration; it is the same claim held by two people.**

## The Trap

Someone reports a finding. Someone else agrees with it, and often improves it —
sharpens the wording, draws out the consequence, files it somewhere durable.
The finding now feels checked, because two people have handled it.

Nobody tested it. Agreement moved it from "one person's guess" to "a thing we
know" without anyone running the command that would settle it.

This is distinct from [claims-nothing-verifies](./claims-nothing-verifies.md).
There, a comment or a column asserts something and no check exists. Here, a
check exists and is cheap, and is skipped **because the conclusion already has
agreement behind it.** The endorsement is what removes the impulse to verify.

It is worse than a solo error for two reasons. The claim acquires a second
author, so retracting it means contradicting a colleague rather than yourself.
And the extension usually goes further than the original: the person agreeing
adds a consequence the evidence never supported.

## Real Incident — 2026-08-28, three rounds on two empty files

Two background scripts produced empty output files and reported exit 0.

**Round 1.** Read as "SoftPro reads are slow enough to rule out refreshing on
modal open." Offered as evidence. Endorsed with *"it's cheaper evidence than an
argument"* and written into a ticket. **Never tested.**

**Round 2.** Retracted, and replaced with "something in the typed SoftPro client
hangs indefinitely — a plain `fetch` to the same URL returns immediately."
Endorsed, and **extended one level further**: "a client that hangs instead of
timing out will eventually hang a cron or a create." A ticket was opened on
that basis. **Also never tested.**

**Round 3.** Finally tested — one script, timestamped lines either side of each
call, under fifteen seconds to write and run:

```
LINE 4 (5.8s): getOrderContacts returned success=true
LINE 6 (8.8s): getOrderDetails returned success=true, items=1
LINE 7 (8.8s): done — process should now exit
LINE 8 (13.8s): STILL ALIVE 5s after finishing
```

Nothing was slow. Nothing hung. The client returns in about three seconds. The
process simply never *exits*, because the shared DB pool holds the event loop
open — and a killed process with block-buffered stdout redirected to a file
loses its entire output.

Both earlier mechanisms were inferred from an absence of output. Neither
survived the first real measurement.

### What it cost

- three investigations
- one destroyed measurement sample, deleted mid-run while chasing the wrong cause
- two wrong mechanisms, one of which reached a document and one of which got its
  own ticket
- a real defect (a process that cannot exit) left unfound for hours while two
  fictional ones were pursued

## Why the second round was worse than the first

The first was a guess. The second was a guess **built on an endorsed guess** —
the agreement on round 1 made round 2 feel like refinement rather than a fresh
unverified claim. Each round had agreement on it, and the agreement is exactly
what made the next round feel safe to skip verifying.

## How to catch it

Before agreeing with a finding, ask: **what would this look like if it were
false, and what would it cost to check?**

If the check is cheap and hasn't been run, agreement is premature no matter how
plausible the claim is. Say "that sounds right, run it" rather than "that's
right".

Specific tells, all present in the incident above:

- **A mechanism inferred from an absence.** No output, no error, no log line.
  Absence is compatible with many mechanisms; it selects none of them.
- **The consequence gets extended by the person agreeing.** "Slow" became "will
  hang a cron or a create." Extension is not evidence, and it raises the cost of
  being wrong.
- **The claim is filed before it is tested.** Writing it into a ticket or a doc
  converts it into something later readers will trust.
- **The phrase "cheaper evidence than an argument."** Evidence that has not been
  checked is not cheap; it is unpriced.

## The rule

A finding needs a **measurement**, not a **second opinion**. Two people agreeing
is one claim, not two data points.

When the check costs under a minute — a timestamped print, a row count, a
single call — run it before anyone agrees with anything.
