# Agent notes

- One-off audit and diagnostic scripts go in `scripts/`, which is excluded from the tsconfig the Vercel build uses — they cannot fail a deploy, and `npm run typecheck:scripts` (run in CI) is what keeps them honest.
- Throwaway probes and scratch output go in `_scratch_untracked/`, which is also excluded from that tsconfig — a half-finished scratch file cannot fail a deploy or a local `npm run typecheck`. It is gitignored and per-machine, so it deliberately has no tsconfig of its own and is not typechecked in CI.
- Chrome user-data profiles for browser automation go in a temp directory outside the repository (`$env:TEMP` on Windows), never under `_scratch_untracked/` — a profile holds a live cookie store, so the concern is session credentials sitting at rest inside a working tree, not repo tidiness. The gitignore stops such a profile being committed, not being created.

## Before you say it is ready (2026-09-09)

**`npm run verify`.** Typecheck, script typecheck, tests — the three things CI
runs, in one command.

`npm run test` passing does not mean the build passes: **vitest does not
typecheck.** Twice on 2026-09-09 a green suite went to CI and failed on `tsc` —
once on a mock missing a field a type had gained, once on a narrowing error.
Both were two CI round trips that a local command would have caught in one.

Run it before pushing anything, and read the whole result rather than the tail.
If the run looks degraded — worker start-up timeouts, far fewer test files than
usual — the machine is starved, not the code; re-run it before drawing any
conclusion, and never report the summary line from a starved run as a result.

## Source-level checks cannot see render-level failures (2026-09-10)

Three sidebar entries were invisible in production — Mortgage Companies,
Mortgage Employees, and the generic Companies page, the last of those for
almost four months. The nav file was correct. All nine entries were present,
permitted for every role that could see any of them, pointing at pages that
existed and loaded. The container animated between `max-h-0` and `max-h-60`
with `overflow-hidden`: a 240px ceiling on 340px of content, no scrollbar, no
error. Entries seven, eight and nine were clipped away.

**The check that missed it was a source-level check.** Nav labels had been
verified pairwise against page titles, and all nine pairs passed — including
the two that could not be seen. A label can be correct, permitted, routed and
typed right and still sit 100px below a clipping boundary. **Nothing in the
source says "row seven."**

The only check that found it was rendering the real markup in a real browser
and measuring what was on screen: six children fully visible, the seventh
clipped to 10px, the eighth and ninth gone.

So:

- **When the question is "can a person see this?", the answer is not in the
  source.** Render it and measure it. Reading the JSX, the classes, the
  permissions and the routes will all say yes while the answer is no.
- **This test environment has no DOM and no layout** — even with jsdom,
  `getBoundingClientRect` returns zeroes. There is no browser runner in the
  repo. Measuring means doing it by hand, which is cheap: a static HTML file
  with the real classes, served over http (a `file://` page cannot be
  scripted), and read with `getBoundingClientRect`.
- **When you cannot assert the measurement, assert the invariant that makes
  the measurement unnecessary.** `sidebar-nav.test.ts` does not assert that six
  entries fit — that would encode the magic number that caused the bug. It
  asserts that no fixed height cap exists at all, so the container sizes to its
  content and a tenth entry cannot vanish the same way.
- **Anchor an assertion on something other than what it is asserting.** The
  first version of that test located the container by the classes the fix
  introduced, so against the old markup it failed with "container not found"
  rather than "cap reintroduced" — and a later rewrite would have made it stop
  checking silently. It now anchors on `entry.children.map(`.
- **Strip comments before an assertion reads source.** The second version
  passed because the explanatory comment above the container contains the
  literal strings the test was searching for. An assertion that reads its own
  documentation asserts nothing.

Related: the history is the reason the fix is not a bigger number. The cap has
been `max-h-60` since April; the section grew into it at seven children on
2026-05-19, #100 added two more entries into an already-overflowing section on
2026-09-08, and #108 renamed two rows nobody could see on 2026-09-09. Raising
240 to 400 buys another four months of silence. See
`docs/tickets/REACHABILITY_SWEEP.md` for the wider pattern — four capabilities
in one week that existed and could not be reached.

## Decide vs ask (2026-08-27)

DECIDE ALONE — do not ask:

- A PR whose SQL or writes are already applied to production, with CI green. Merging only makes main describe reality. There is no decision in it.
- Docs-only PRs.
- A choice between two implementations where one is measurably a regression. Take the one that is not, and report what you chose and why.
- Rebases, Update-branch, merge ordering, migration renumbering, and conflict resolution you have verified by execution.

ASK only when:

- It sends something to a human
- It spends money
- It is not reversible
- It changes what an operator sees on screen
- A business rule is genuinely ambiguous and the code cannot tell you the answer
- You would be guessing at intent rather than at implementation

If you have several questions, send them in one message with a recommendation on each. Do not stop the line for each in turn.

Test when unsure: would a wrong answer send an email, cost money, or need a database restore? If no to all three, decide it and report it.

You have CI, branch protection, and required checks; use them. Confirm app + scripts green on the rebased head, then merge. Confirm `/api/health` SHA after each merge. Health host is `https://td-hub.vercel.app/api/health` (not hub.pacificcoasttitle.com).

## Production writes

Nothing that writes to production runs from uncommitted code. Not a one-shot, not a backfill, not a repair script. If it touches production it goes through a branch and a review first, even when the change is obviously right.

## Reverting (2026-09-09)

**Revert by naming the files you changed. Never by naming a directory.**

```bash
git checkout -- src/lib src/components        # NO
git checkout -- src/lib/integrations/sitex/client.ts   # yes, one path per file
```

Several agents work in this repo at once and each other's uncommitted changes
sit in the same worktrees. `git checkout -- <dir>` reverts every modified file
underneath it, not only the ones you touched. On 2026-09-09 a cleanup after a
test run destroyed eight files belonging to the hub split-view work — files the
session had spent all day deliberately avoiding.

They were recovered from a dropped autostash git happened to be holding
(`git fsck --unreachable` finds these), and the working tree was restored to
match it exactly. **That recovery was luck, and it was unverifiable**: the
diffstat was compared only after the deletion, so "the stash matches what was
there" is an inference, not a proof. Nobody could tell from inside the repo
whether the stash was six days stale.

The same hazard already had a rule for `git stash` — pushed with a unique tag,
restored with `apply` not `pop`. That rule did not cover `checkout`, and the
hazard is not the command, it is **operating on files you did not touch**.
Before any destructive git operation, list what it will affect and confirm
every path is yours.

If you do destroy something: `git fsck --unreachable --no-progress | grep commit`
and inspect each for the missing files. Autostashes from rebases are the usual
survivor. Say plainly whether you verified the recovery or inferred it.
