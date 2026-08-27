# Agent notes

- One-off audit and diagnostic scripts go in `scripts/`, which is excluded from the tsconfig the Vercel build uses — they cannot fail a deploy, and `npm run typecheck:scripts` (run in CI) is what keeps them honest.
- Throwaway probes and scratch output go in `_scratch_untracked/`, which is also excluded from that tsconfig — a half-finished scratch file cannot fail a deploy or a local `npm run typecheck`. It is gitignored and per-machine, so it deliberately has no tsconfig of its own and is not typechecked in CI.
- Chrome user-data profiles for browser automation go in a temp directory outside the repository (`$env:TEMP` on Windows), never under `_scratch_untracked/` — a profile holds a live cookie store, so the concern is session credentials sitting at rest inside a working tree, not repo tidiness. The gitignore stops such a profile being committed, not being created.
