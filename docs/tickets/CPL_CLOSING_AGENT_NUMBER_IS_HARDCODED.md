# Every CPL names Orange as the closing agent, whatever branch issued it

**Status: reported, NOT fixed.** Deliberately not fixed — resolving it needs
Westcor's definition of the field, not a code change we can reason our way to.
Opened: 2026-08-28
Found: while tracing the March CPL failures for the hub detail pane work.

## The line

`src/lib/integrations/cpl/westcor/payloads.ts`, in the CPL request body:

```ts
PolicyProducingAgentNumber:    templateBase.PolicyProducingAgentNumber ?? branch.branchCode,
PolicyProducingAgentAddressID: branch.branchCode,
PolicyProducingAgentAddress:   branch.address,
PolicyProducingAgentCity:      branch.city,
PolicyProducingAgentState:     branch.state,
PolicyProducingAgentZip:       branch.zip,
ProtectLender:                 true,
ClosingAgentNumber:            'CA1038',        // ← hardcoded
IsDualCPL:                     false,
```

Six consecutive fields are derived from the selected branch. The seventh is a
string literal. `branch.branchCode` is in scope on the same object.

`CA1038` is the Westcor code for **Pacific Coast Title – Orange**. The branch
codes are:

| code | branch |
|---|---|
| `CA1038` | Orange |
| `CA1038.01` | Glendale |
| `CA1038.02` | Oxnard |
| `CA1038.03` | Concord |
| … | 20 configured in total |

So for 19 of the 20 branches, the CPL goes out naming a closing agent that is
not the branch that issued it.

## This is not hypothetical — it has already happened once

The only CPL generated in ordinary production use is document 4464,
`westcor_20016790-GLT_1.pdf`, order 2131, 2026-07-23.

**`-GLT` is the Glendale file-number suffix.** That is a Glendale order, and it
went to Westcor with `ClosingAgentNumber: CA1038` — Orange.

(The evidence is the file-number suffix, not a stored branch id: which branch
the operator selected at generation time is not recorded anywhere. That is a
second, smaller gap — see below.)

Westcor accepted it. No error was logged. Which tells us the field is either
not validated against the producing agent, or is expected to be a
company-level identifier. It does not tell us the document is correct.

## What it SHOULD be — and why this needs Westcor, not a guess

Two readings, and the code cannot distinguish them:

**(a) `ClosingAgentNumber` is company-level.** `CA1038` is simultaneously
Orange's branch code and the root of every other code (`CA1038.nn`), which is
exactly what a parent agency identifier looks like. If so the value is
*correct*, and the defect is only that it is expressed as a literal that
happens to equal Orange's branch code — a coincidence that will mislead the
next reader, and will silently become wrong if Orange's code ever changes.
The fix would be to source it from a named company-level constant, not from
thin air.

**(b) `ClosingAgentNumber` identifies the branch conducting the closing.** Then
it should be `branch.branchCode`, matching `PolicyProducingAgentAddressID`
directly above it, and **every CPL issued outside Orange has named the wrong
agent.**

A closing protection letter is a legal instrument: it is the underwriter's
indemnity to the lender for that specific agent's acts. Naming the wrong agent
is not cosmetic.

**Settle it by asking Westcor what the field means.** Do not change the line
first — under reading (a), "fixing" it to `branch.branchCode` would send
`CA1038.01` where the agency identifier belongs and could break issuance
outright, turning a paperwork question into an outage on the week the team
starts using it.

## A prior document says legacy did the same — and it cannot be verified here

Found after this ticket was first written, on checking `docs/cpl/legacy/`.

`CPL_WESTCOR_GENERATION.md:430`, in a legacy-vs-ours parity table:

```
| `ClosingAgentNumber: "CA1038"` | Hardcoded | Same | Matched |
```

and line 452: "Matches legacy. Could be moved to branch data if PCT gets
multiple closing agent numbers."

If that is right, this is **inherited behaviour, not a regression we
introduced**, and legacy has been issuing CPLs this way for as long as it has
been issuing them — which would make reading (a), the company-level
identifier, considerably more likely than reading (b).

**But it is not verifiable from anything in the repo.** The legacy Westcor
source is not in `docs/cpl/legacy/` — that folder holds `Common.php` and
`Fnf.php`, which are the FNF path, and searching both for `CA1038`,
`ClosingAgentNumber` or `cpl@pct` returns nothing. `CPL_WESTCOR_GENERATION.md`
itself declares on line 5 that it "reflects the actual code in
`src/lib/integrations/cpl/westcor/`" — it is a document about OUR
implementation, and the provenance of its "Legacy" column is unknown.

The same document, line 285, records legacy sending
`PolicyProducingAgentAddressID: "CA1038"` as a literal too, where our code now
uses `branch.branchCode` (`payloads.ts:362`). So on that neighbouring field we
have already diverged from what it describes as legacy behaviour.

**This does not change the recommendation to ask Westcor.** It changes the
question put to them: not "are we sending the wrong thing" but "your agency
`CA1038` has been receiving CPLs with `ClosingAgentNumber: CA1038` for every
branch — is that the value you expect at agency level, or should it track the
issuing branch?" That is answerable in one email and settles both readings.

## Why nobody caught it

Worth understanding, because the shape recurs.

1. **A hardcoded constant sitting inside a run of correctly-derived ones.**
   Six `branch.*` fields, then a literal, then another literal (`IsDualCPL`).
   Reading the block, the eye completes the pattern — the literal reads as
   configuration, not as an omission.
2. **`CA1038` is not obviously wrong.** It is a real, valid agent number for a
   real branch. A placeholder like `'TODO'` or `'XXXX'` would have been caught
   in review; a plausible production value is invisible.
3. **The vendor accepts it.** There is no error, no warning, no log line. The
   only signal would be someone reading the issued PDF and noticing the agent
   is not their branch — and only three CPLs have ever been produced, two of
   them on a March test order.
4. **Volume hid it.** One CPL in five months. This is the class of defect that
   stays invisible precisely until adoption, which is why it is being raised
   now rather than after.

## Related gap: the branch used is not recorded

`documents` stores the filename and the order, not which `cpl_branches` row was
selected. So for any CPL already issued, the branch has to be inferred from the
file-number suffix. If reading (b) turns out to be correct and a remediation
sweep is needed, that inference is the only thing available to identify
affected documents. Recording `branch_id` on the document at generation would
cost nothing and remove the guesswork.

## Not urgent today, urgent the week it is adopted

Three CPLs exist. One is real. The hub's detail pane now puts a **Create CPL**
button in front of the open-order team, so volume is about to change — which is
the entire reason for filing this before that happens rather than after.
