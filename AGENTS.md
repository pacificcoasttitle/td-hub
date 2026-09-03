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

## Staging probes: prove separation, do not assert it (2026-09-03)

Any script that writes to SoftPro refuses to run until it has **evidence** the profile is separate, not a claim that it is.

- **Check the port, then prove it with a query.** `SOFTPRO_API_URL` on `:8081` is a claim about configuration. The check that means something is to ask staging for a **known production order number** and refuse unless the answer is **zero records**. A port can be right while the profile behind it is shared; an empty result for a real production file cannot. Reference implementation: `proveSeparation()` in `scripts/audit/update-prelim-staging-order-probe.ts`; the older form is `scripts/audit/staging-run.ts`.
- **Create your own orders.** Staging prefixes what it creates with `TEST-`, so a fresh order cannot collide with a production file number and nobody has to volunteer a file they mind marking up. Do not probe a production number on the assumption it will not resolve.
- **Refuse rather than default.** Missing `SOFTPRO_USER_ID`, missing URL, wrong port: exit non-zero with the reason. A probe that guesses is worse than one that stops.
- **Guard the inputs against the defect you are documenting.** The prelim probe rejects a `--file-url` over 200 characters and validates the last path segment through `cleanSoftProFileUrl`, because SoftPro downloads on a Windows host and rejects long URLs with *"The specified path, file name, or both are too long"* (MAX_PATH 260 — that is the real error behind the presigned-S3 failures, **not** illegal characters). A probe that exists to document a failure must not be able to reproduce it by accident.
- **Verify the refusals by running them.** All three guards above were confirmed by execution before the script was trusted, including against a production-shaped URL.

Corollary on credentials: a production-capable SoftPro token does not go in a `.env.local` on a machine carrying sixty-odd worktrees. The probe refuses to point at production; nothing else on that machine does. Where a run needs the token, a human runs it and pastes the output back.

## A vendor 200 is not a result (2026-09-03)

SoftPro accepts fields it cannot resolve, returns success, and silently drops or substitutes them — five proven instances across five different fields, enumerated with order numbers in `docs/tickets/SOFTPRO_ACCEPTS_AND_SILENTLY_DROPS_FIELDS.md`.

So: never record an outcome from a request payload or a `200`. Read the thing back, and store "we were told it worked" and "we saw it" as two different states. Where a read-back is impossible, say so in the copy rather than collapsing it into the good state.
