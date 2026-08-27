# Watch-Out: Claims Nothing Verifies

## The Trap

A comment, a column name, or a flag asserts behavior. Nothing checks that the
assertion is true. The claim is read as documentation by every later reader,
including the people deciding whether a safety check is adequate — so a wrong
claim doesn't just fail, it actively misdirects the investigation of its own
failure.

This is distinct from a bug. A bug does the wrong thing. These do the wrong
thing *while telling you they do the right thing*.

Nine instances surfaced in a single day (2026-08-27) during the
`ORDERS_NEVER_INGESTED` investigation. That frequency is the reason this is a
pattern entry and not a ticket.

The eighth is the worst shape of it and has its own section below: not a comment
that lied, but a **verification step run specifically to detect a failure, which
was structurally incapable of showing that failure.** A wrong comment misleads
whoever reads it. A verification that cannot fail manufactures confidence on
demand, and it does so at exactly the moment someone has decided to be careful.

The ninth is the shortest and the most humbling, and it is why this entry is not
only about code: the handover message that recorded the rule from #8 asserted two
things about repository state that nobody had checked, and one of them was that
the rule was already in the docs.

## Canonical Example: the comment and the SQL disagreed

`src/lib/jobs/handlers/fetch-prelims.ts` chose which orders to fetch prelims
for:

```typescript
// BROKEN — comment asserts the opposite of what runs
// Prioritize orders never attempted (lastPrelimFetchAt IS NULL → asc nulls first),
// then those whose last attempt is older than 6 hours.
  .orderBy(asc(orders.lastPrelimFetchAt))
  .limit(50)
```

**In Postgres, `ORDER BY col ASC` is `NULLS LAST`.** Null values sort as
larger than any non-null value. So never-attempted orders were served *last*,
behind every previously-attempted order that had aged past the 6-hour window —
the exact inverse of the stated priority.

The measured effect on 2026-08-27: 48 recycling rows sorted ahead of 118
never-attempted rows against a `limit 50`, so roughly **two** new orders were
examined per 15-minute cycle. 113 freshly imported orders sat untouched for
hours, and genuinely new orders queued behind them for their prelim delivery.

Nobody had misread the code. Everybody had read the comment.

```typescript
// CORRECT — spell out the null placement, and tiebreak the group
  .orderBy(sql`${orders.lastPrelimFetchAt} asc nulls first, coalesce(${orders.openedAt}, ${orders.createdAt}) desc`)
  .limit(50)
```

## The other six from the same day

| # | Claim | Reality |
|---|---|---|
| 1 | `import-orders` returns `completed` | Returned its failure in an `errors` array instead of throwing; the runner marked success. Two May runs are still recorded as completed having done nothing. |
| 2 | The job route accepts a JSON payload | `req.json().catch(() => ({}))` turns unparseable JSON into an empty payload, then runs with default arguments and reports success. Silently converted explicit date ranges into "today". |
| 3 | `lookback_sync` is a safety net for sync gaps | Reads `FROM orders`. Cannot see an order that was never inserted. |
| 4 | `verify_sync` verifies the sync | Same. Both nets could only examine what already existed, which is why 457 missing orders went unnoticed for four months. |
| 5 | `needs_manual_delivery` flags a prelim for a human | Written by the delivery path, read by nothing. 130 accumulated with no surface anywhere in the app. |
| 6 | `orders.opened_at` is when the order opened | `NOT NULL DEFAULT NOW()`, and `GetOrders` carries no open date — so every row from that path claimed to have opened at the moment it was written. Blinded the prelim backfill gate that measures exactly this. |
| 7 | *(above)* `asc nulls first` | `ASC` is `NULLS LAST`. |
| 8 | *(below)* "sweep stopped — process handle confirms it" | Killed the wrapper, not the child. Both confirming signals were downstream of the wrapper, so both were guaranteed to pass. The job ran 47 more minutes. |
| 9 | *(below)* "main moved f03a181 → dcc1aef, three more PRs landed after" and "standing rule, now in the docs" | One PR landed after `dcc1aef`, not three, and `main` was at `3afdc9f`. The rule was in an open PR. Both stated in the handover whose subject was not asserting state unchecked. |

The common shape: **the claim was load-bearing for a later decision.** #3 and #4
were cited as evidence that ingestion was monitored. #6 was the input to the
gate built to stop unintended emails. #7 was the reason nobody expected
backfilled orders to starve live traffic.

## #8: the verification that could not fail

Worst shape of the pattern, and the one to internalise.

A long-running recovery sweep needed to be stopped mid-flight. It was launched
as `powershell -File sweep.ps1` through a wrapper, so the reported PID was the
**wrapper**, not the PowerShell child doing the work.

```powershell
# BROKEN — every signal here is downstream of the wrapper
Stop-Process -Id $wrapperPid -Force
Get-Process -Id $wrapperPid   # returns nothing: "confirmed stopped"
Get-Content $terminalFile     # stops updating: "confirmed stopped"
```

Both checks passed. Both were incapable of failing. Killing the wrapper
guarantees `Get-Process` finds nothing, and it guarantees the captured stdout
goes quiet — because the wrapper was what captured it. The child kept running
for **47 more minutes**, completed the entire remaining range, and ran straight
through a production deploy that the operator had scheduled specifically because
they believed nothing was in flight.

The stop was reported as confirmed twice, on two independent-looking signals that
were the same signal.

```sql
-- CORRECT — ask the thing being written to, over a full cycle of the job
select max(created_at), count(*) filter (where created_at > now() - interval '3 minutes')
from orders where created_at >= $sweep_start;
```

### The rule

**Kill the child PID. Verify a stop by the absence of new database rows over a
full cycle of the job — never by a process handle.**

For a job that writes through an HTTP request, note that killing the client does
not stop the server: an in-flight request runs to completion, so writes continue
for up to the request timeout after the kill. A full cycle means at least that
long.

### The generalisation

Before trusting any verification, ask: **what would this check look like if the
thing I'm checking for were true?** If the answer is "the same", the check is
decoration. This is the identical error as #3 and #4 — those safety nets queried
`orders` to detect a missing order, and could only ever see what was there. The
difference is that #8 was a deliberate act of caution rather than a design
oversight, which is what makes it worse: the operator paid the cost of stopping,
and got none of the benefit.

## #9: the same error, in the message about the error

The handover written to carry #8's rule to the next session opened with a warning
against asserting repository state without fetching, and then asserted two pieces
of repository state without fetching:

> MAIN HAS MOVED A LOT. It went f03a181 -> dcc1aef and three more PRs landed
> after.

> STANDING RULE, now in the docs, and it applies to your Preview runs [...]

One PR had landed after `dcc1aef`, not three; `main` was at `3afdc9f`. And the
rule was not in the docs — it was in an open pull request, which is precisely the
state the same message elsewhere identified as the way a standing rule gets lost.

Two details make this worth recording rather than shrugging off.

**Both claims were checkable in one command.** `git log dcc1aef..origin/main`
and `gh pr view 48 --json state`. The cost of verifying was seconds; the cost of
being wrong was a downstream session rebasing onto a stale SHA and citing a rule
with no canonical home.

**The medium changed but the failure did not.** Instances 1–8 were code and
comments. This one is prose, in a status report, and prose gets far less scrutiny
than a diff — nobody code-reviews a handover. A status report is a set of
assertions about system state, and the ones that will be acted on deserve the
same standard as an assertion in a comment: enforced, or not made.

The corollary for anyone writing a handover: **the sentences most likely to be
wrong are the ones you did not have to look anything up to write.** Counts of
things that landed, "X is deployed", "Y is merged", "nothing is running" — these
feel like recall rather than claims, which is exactly why they escape checking.

## Detection

### Database semantics that differ from the obvious reading

- `ORDER BY col ASC` → `NULLS LAST`. `DESC` → `NULLS FIRST`. Always write the
  clause explicitly when nulls are meaningful.
- `NULL != 'x'` is `NULL`, i.e. excluded — a `ne()` filter on a nullable column
  silently drops null rows. (`dashboard/activity/route.ts` documents this
  correctly; it is the counter-example to copy.)
- `NOT IN (subquery)` returns no rows if the subquery yields a single NULL.
- A `DEFAULT` on a column the vendor may not populate manufactures data rather
  than recording absence.

### Comments that need a test, not a reviewer

Any comment stating an ordering, a priority, a threshold, a cap, or "this
cannot happen" is a testable assertion. If there is no test, treat the comment
as unverified. Grep starting points:

```bash
# Priority and ordering claims
rg -n "nulls (first|last)|[Pp]rioriti[sz]e|first, then|oldest|newest" src/lib

# Claims of impossibility
rg -n "cannot|never|always|guaranteed|by definition" src/lib --type ts
```

### Flags and columns with no reader

A written-but-never-read field is a report into a void. For every flag that
records a condition needing action:

```bash
# Does anything READ it, or only write it?
rg -n "needs_manual_delivery|<flag_name>" src/
```

If every hit is a write, the flag has no surface and the condition it records
is not being acted on.

### Safety checks that read the same store they guard

Ask what the check is protecting against, then ask whether its data source can
represent that failure. A check that queries `orders` cannot detect a missing
order. A check that samples rows cannot detect absent rows. This is the class
that produced #3 and #4, and it is invisible to code review because the code is
correct — it is the *premise* that is wrong.

## The Rule

Write the claim so the machine enforces it, or don't write the claim.

In practice:

1. Spell out the semantics rather than relying on a default — `nulls first`,
   explicit `NOT NULL`, explicit tiebreak.
2. If a comment asserts behavior, add the test that fails when it stops being
   true.
3. Prefer recording provenance at write time over inferring it later from
   timestamps. Both #6 and the residual hole in #7's fix reduce to this.
4. When a flag records "a human must look at this", ship the place the human
   looks in the same change.
5. In a handover or status report, every claim about repository or system state
   carries the command that produced it, or it is marked as unverified. A SHA
   comes from `git log`, a merge state from `gh pr view`, "nothing is running"
   from the table the job writes. #9 is what this rule exists to prevent.

## Reference

- `docs/tickets/ORDERS_NEVER_INGESTED.md` — the investigation these came out of
- `src/lib/jobs/handlers/fetch-prelims.ts` — #7, fixed, with the reasoning inline
- `src/lib/db/schema/orders.ts` — #6, fixed, `opened_at` nullable with no default
- `src/app/api/dashboard/activity/route.ts` — correct handling of the nullable
  `ne()` trap, worth copying
- `watch-outs/silent-job-failures.md` — #1 in its own entry, predates this
