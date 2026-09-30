# What counts as evidence

Eight rules, each one written the day it cost us something. They are all the
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

## 6 · If a number will shape a decision, commit the thing that produced it

Every wrong figure this month came out of an ad-hoc query nobody could rerun:

> "contact book at 6%" · "1,476 missing contacts" · "821 officer-less orders" ·
> "87 held prelims" · "four source-reading guards" · "forty-seven"

Each was stated with the same confidence as a verified one. Two of them reached
Gerard. The count of source-reading guards was wrong **twice in a row** — first
a guess, then a grep loose enough to match fixtures — and both times the method
died with the shell that ran it, so the only way to find the error was to
happen to redo it.

**The rule.** A number that will inform a decision gets a committed artifact:
a script, a test, a query file. Not because the number needs auditing, but
because *the method* does — an unrepeatable measurement cannot be corrected,
only replaced by another guess.

**The stronger form, where it is available: make the number and the enforcement
come from the same file.** `scripts/audit/detect-source-readers.mjs` produces
the count, and `source-readers.test.ts` seeds its baseline from the same
detector — so the figure in the document and the rule in the codebase cannot
drift apart. When that is reachable, a wrong number stops being possible rather
than becoming correctable.

**The distinction to keep.** "Not known to be broken" and "known not to have
been checked" are different statements. Collapsing them is how a figure that
describes what somebody looked at gets reported as a figure describing what is
there — which is what a sync *rate* reported as a *total* is, and what "four
guards" was.

## 7 · A fixture is a real stored payload unless there is a reason it cannot be

Six vacuous guards this month, and one factor is common to every single one:
**the fixture was hand-built and minimal.**

| The fixture | What it could not see |
| --- | --- |
| County Sales: symmetric Irvine prices | a mean/median swap — both gave the same number |
| Carrier-route parity: rejected row kept with nulls | `total === used` whatever the code returned |
| Transfer audit: `DocumentNumber` set | the normaliser reads `RecorderDocumentNumber`; `undefined === undefined` |
| Client-bundle guard: five-second timeout | it had not finished, and reported green |
| Concierge document: **one** comparable | the summary page overflowed to nine sheets on the real four |
| Concierge document: `compMapImage: null` | the map branch never rendered, so a 420px map measured a page with no map on it |

Every one would have failed on first contact with real data. The last two are
the clearest: code that passed every assertion against a one-comparable fixture
rendered **nine sheets instead of eight** the moment it met profile 4 — and the
overflow guard written to catch that sat green at a 420px map, because the
fixture had no map in it to overflow.

**The rule.** Build the fixture from a real stored payload. For Concierge and
the farming reports that is free and already in reach: `raw_storage_key` holds
exactly what the vendor sent, `downloadFile` reads it, no vendor is contacted.
`scripts/audit/concierge-render-preview.mts` does it end to end and writes
nothing.

**Why hand-built is specifically dangerous.** It encodes what the author
expected the data to look like, which is the thing under test. An author who
believes one comparable is representative writes a one-comparable fixture, and
the guard then agrees with them. The real payload has four comparables, two
different building areas, a null exemption, a tax status that must not print,
and keys the normaliser does not read — none of which anyone would think to
type out.

**When minimal is right, and how to keep it honest.** A fixture that must be
minimal to isolate a branch — the empty case, the malformed case, a boundary —
is legitimate. Then the branch has to be asserted present before anything is
asserted about it: the field is populated, the values are asymmetric, the list
is not empty, the image is not null. That is rule 4's meta-check, and it is the
only thing that makes a synthetic fixture worth having.

**The corollary that caught a parser.** A real payload also tells you what the
vendor actually sends. `normalizeSubject` read `LastTransferValue`, `SalePrice`
and `LastSaleDate`; feed 100001 sends `SalesPrice` and `TransferDate`. Every
profile printed "No subject sale on record" over a payload holding both a price
and a date — **and the design then acquired a panel explaining the absence.**
That is the expensive end of this: a parsing bug became a documented behaviour
that the next person built around. A hand-built fixture using the names the
code reads would have passed forever.

## 8 · A tool reports on the environment it runs in, not on the system

`git worktree list` said 65 of 68 worktrees were **prunable**. Prunable means
the directory is gone. The instruction that followed was the obvious one: prune
them and remove the dead directories.

**Every one of those directories existed.** The shell that produced the listing
runs in a Linux container with the Windows filesystem mounted, and git inside
that container cannot resolve `C:/Users/...`, so it could not find a single
worktree and marked them all prunable. The flag was **true about the container
and false about the machine**.

Running it would have deleted 19 worktrees holding work — one with **1,315
modified files** uncommitted, several with unmerged commits. Nothing was lost,
because the survey ran before the deletion and reported `prunable: 0` from a
shell on the host.

**The rule.** Anything a tool tells you about the world outside itself is a
report about its own environment first. Path existence, file presence, process
lists, port bindings, clock, user, network reachability — a container answering
a question about the host is **inference wearing the costume of a
measurement**.

**This is rule 3 with a different costume.** That one says a local render is
evidence about the renderer, never about production; this one says a local
*tool* is evidence about its own environment, never about the machine. The two
came from opposite directions — rule 3 from an agent's harness, rule 8 from a
human operator's shell — which is the point. Neither party is the unreliable
one. The environment is.

**What to do instead.** Before a destructive action keyed on what a tool
reported:

1. **Re-ask from the environment that owns the thing.** The host shell, not the
   container. `git worktree list` run where the paths resolve.
2. **Check the finding against something with independent provenance.** Does
   the directory listing agree? Does `git status` inside it work?
3. **Scope the action to what survives both.** 28 worktrees were clean and
   fully merged on both readings; those were removed. The other 40 were not
   touched.

**The tell.** A flag that is unanimous — *every* worktree prunable, *every*
lender with a blank address, *all 120* contacts nameless — is more often a
statement about the instrument than about the population. Unanimity is a
prompt to check the instrument, not a finding.

## The shape they share

In every case the reassuring reading was available and cheap, and the
disconfirming check was available and nearly as cheap. The habit worth keeping
is not suspicion — it is asking *what would I see if this were broken?* before
deciding it is not.
