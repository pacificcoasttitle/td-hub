# `npm run verify` was red because of three files on nobody's branch

**Status:** gate green as of 2026-09-29. Three files quarantined, not deleted.
Someone needs to claim or bin them.

## The finding

`npm run verify` is the command AGENTS.md says to run before calling anything
ready. It could not go green on this machine. Every failure came from a file
that is **untracked — never committed, on no branch, in no remote**:

| File | How it failed | Now at |
| --- | --- | --- |
| `scripts/audit/reenrich-zip-only.ts` | two type errors, failing `typecheck:scripts` | `_scratch_untracked/quarantined/` |
| `src/lib/jobs/handlers/fetch-prelims-cooldown.test.ts` | suite failed to load: anchors on `const PRELIM_FETCH_DUE` | `_scratch_untracked/quarantined/` |
| `src/components/hub/split/order-detail.test.tsx` | expects "No property on file"; the component renders "Address pending" | `_scratch_untracked/quarantined/` |

**Nothing in the repository was failing.** `git log --all` returns nothing for
any of the three. They are somebody's in-progress work sitting in a shared
working tree.

They were **moved, not deleted** — recovering one is a single command, and
deleting another agent's uncommitted work is the failure AGENTS.md's reverting
note is written about.

A fourth cause was config: `vitest.config.ts` had no `exclude`, so vitest also
collected two probes under `_scratch_untracked/_pre_pull_untracked/` — one
importing a path that does not exist, one importing a module never written.
AGENTS.md already says that directory is excluded from the CI tsconfig; it now
says so to vitest as well.

## Why this matters more than three red lines

**A gate that cannot pass stops being consulted.** The suite has been reporting
failures that belong to nobody, which trains everyone to read past the summary
line — and the next real failure arrives in a list that already had four.

## The three files, individually

### `reenrich-zip-only.ts` — has outstanding work, and should never have been here

Its own header: *"Write zip onto the ~35 open/in-process rows that already have
an address and no zip."* A **production write**, uncommitted, in the tree since
28 August. That is the exact thing AGENTS.md forbids:

> Nothing that writes to production runs from uncommitted code. Not a one-shot,
> not a backfill, not a repair script.

The work is not finished. `scripts/audit/orders-missing-zip.ts` (committed,
read-only) reports **5** open/in-process orders with an address and no zip, and
**132** in-process rows with no zip at all. None arrived in the last 30 days, so
it is a small backlog rather than a live defect — but if anyone still wants those
five filled, it needs a committed script and a review, not this file.

### `fetch-prelims-cooldown.test.ts` — has never passed

It slices `fetch-prelims.ts` between `const PRELIM_FETCH_DUE` and
`export async function fetchPrelimsForOrder`, and asserts the first index is
greater than −1. It fails with `expected -1 to be greater than -1`.

`PRELIM_FETCH_DUE` does not exist in `src`, and
`git log -S "PRELIM_FETCH_DUE" --all` finds it **in no commit on any branch**.
The constant was never there. So this is not a guard that broke — it is a guard
that has never been green, written against code that was never committed.

Whoever wrote it knows what the cooldown constant was going to be called. It is
not safe for anyone else to re-anchor it: editing a guard until it passes is how
a guard stops being one (EVIDENCE_RULES.md rule 4).

Note also that it reads source with bare `readFileSync`, which the ratchet in
`src/test-support/source-readers.test.ts` refuses for new files. When it comes
back it should use `readSource(path, { mustContain })`, which would have failed
with "the file moved" instead of silently slicing from index −1.

### `order-detail.test.tsx` — the test and the component disagree

It expects `No property on file` and `There's nothing on this order yet`; the
component renders `Address pending`. The component is committed and the test is
not, so this is either copy that was planned and never landed, or a test written
against a local edit.

Both readings need the author. Changing the component to match an uncommitted
test would be writing product copy from a test file.

## What to do

1. **Whoever owns each file:** pull it back out of
   `_scratch_untracked/quarantined/`, finish it, and commit it — with a real
   anchor for the cooldown guard, and through a branch for the zip backfill.
2. **If nobody claims them in a week:** delete them. They are in a gitignored
   directory, so nothing preserves them beyond this machine anyway.
3. **The five zip rows** are worth a decision either way: fill them with a
   committed script, or accept them.
