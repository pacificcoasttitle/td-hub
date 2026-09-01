# Agent notes

- One-off audit and diagnostic scripts go in `scripts/`, which is excluded from the tsconfig the Vercel build uses — they cannot fail a deploy, and `npm run typecheck:scripts` (run in CI) is what keeps them honest.
- Throwaway probes and scratch output go in `_scratch_untracked/`, which is also excluded from that tsconfig — a half-finished scratch file cannot fail a deploy or a local `npm run typecheck`. It is gitignored and per-machine, so it deliberately has no tsconfig of its own and is not typechecked in CI.
- Chrome user-data profiles for browser automation go in a temp directory outside the repository (`$env:TEMP` on Windows), never under `_scratch_untracked/` — a profile holds a live cookie store, so the concern is session credentials sitting at rest inside a working tree, not repo tidiness. The gitignore stops such a profile being committed, not being created.

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
