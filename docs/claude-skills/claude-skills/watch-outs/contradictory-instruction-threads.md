# Watch-Out: Contradictory Instruction Threads

## The Trap

Two instructions about the same object exist at once, in different threads, and
the second does not say that it replaces the first. Everyone who read only the
first thread — agents included — carries on acting on it. Nothing looks wrong
from either side: both instructions were given deliberately, both were followed,
and the reader holding the stale one has no signal that it went stale.

The cost is not a bad outcome. It is effort spent reconciling a system that is
behaving correctly against a belief that is quietly out of date.

## Real Incident

On 2026-08-27 a production backfill route had 97 orders queued for
re-enrichment:

```
POST /api/admin/backfill/reenrich-latched-orders?apply=true
```

Asked how to run it, the Director's answer in one thread was: let the scheduled
cron drain it, then verify the rows landed. A few messages later, in a separate
thread, he passed the admin route commands to a colleague and green-lit the
apply. It ran at 18:45 UTC, swept all 97 orders in 123 seconds, and returned
`partiesWritten: 21, ordersWithNewParties: 4, stoppedEarly: false`.

The write was correct and authorised. But "the cron will do it" was still live
for anyone reading only the first thread, so the sweep read as an unexplained
production write. An agent investigated it as state diverging from belief and
went looking for the process that had caused it. There was no rogue process and
no divergence — there were two simultaneous instructions, and the second did not
announce that it superseded the first. The Director has noted the contradiction
was his.

## The Rule

**An instruction that reverses an earlier one has to say so explicitly.**
Otherwise the earlier one stays live in the reader's model, and it stays live in
the thread where it was given, which is where the next reader will find it.

"Ignore what I said about letting the cron drain it — run it manually now" costs
one clause and closes the earlier instruction out.

### The symmetric obligation on the agent

When a new instruction conflicts with one already held, surface the conflict
rather than silently taking the newer one. Only the human can know which was
intended, and a silent switch destroys the evidence that there was ever a
choice — including the last chance to notice that someone else is still working
from the old instruction.

Say: "This contradicts the earlier instruction to let the cron drain it — should
I treat the manual run as replacing that?"

## Detection

- A production change nobody in your thread expected. Before reaching for a
  rogue process, ask whether a second thread authorised it.
- Any instruction of the form "actually, go ahead and ..." touching something
  already covered by a standing decision.
- Instructions relayed through a third party. The relay carries the new
  instruction and not the one it overrides.

## Reference

- `watch-outs/claims-nothing-verifies.md` — the adjacent failure: a belief about
  system state carried forward without being checked against the system
