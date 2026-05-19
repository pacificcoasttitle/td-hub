# Watch-Out: Commit Without Push

## The Trap

Cursor agents report "committed and done" without actually pushing the commit to `origin/main`. The commit exists only on the agent's local machine. Vercel never sees it. The deploy never happens. Director assumes the fix is live and tests against unchanged production.

## Real Incident

On 2026-05-19 during the escrow workspace build, an agent reported:

> "Committed as 8cb4039 — feat: external escrow officers page + flag backfill + scope filter"

Director went to `td-hub.vercel.app/contacts/external-escrow-officers` — 404. Vercel deployments tab — nothing for `8cb4039`. Director asked the agent to verify. Response:

> "All has been pushed and the external clients appear."

But it hadn't been pushed in the first attempt. This happened at least 3 times during the multi-day escrow + enrichment build.

## Why It Happens

1. Agents are trained to think of "commit" as the completion event
2. The Cursor shell sometimes hangs on `git commit` when piping messages
3. Push requires explicit auth/network access the agent may not have
4. Agents conflate "code change ready" with "deployment ready"

## The Fix

### For Director: Always Verify

After every agent reports "Done":

1. Check git log on origin/main:
   ```
   git log origin/main -5 --oneline
   ```
   Confirm the claimed commit hash is there.

2. Check Vercel Deployments tab. Should appear as "Building" or "Ready" within minutes.

3. Only after Vercel shows "Ready" should you test.

### For Agent Prompts: Require Push Verification

Add to every Builder, UI Builder, and API Specialist prompt:

```
COMMIT AND PUSH REQUIREMENT:
- Run `git add` for modified/created files
- Run `git commit -m "..."` with the specified message
- Run `git push origin main`
- Verify push succeeded by running `git log origin/main -1`
- Confirm the output shows YOUR commit on top

In your final report, include:
1. The commit hash
2. The push confirmation
3. The verification: `git log origin/main -1` output

DO NOT report "Done" without push verification.
If push fails (auth error, network issue, branch protection), 
say so explicitly so the Director can resolve it.
```

### For Reviewer Checklist

Before approving:

- [ ] Commit hash is on `origin/main`
- [ ] No "behind origin/main by X commits" status
- [ ] Vercel shows a build triggered by that commit

If commit is only local, BLOCK the review. Re-fire ticket asking the agent to push.

## Detection Patterns

Phrases suggesting commit-but-not-push:

- "Committed as [hash]" without "and pushed"
- "Local main is now ahead of origin/main by N commits"
- "I did not push"
- "Branch is X commits ahead"
- "Want me to push?"

When you see any of these, the answer is YES, push. Don't proceed until push is confirmed.

## Edge Cases

### Unrelated dirty files

Sometimes the agent has unrelated WIP in the working tree:

> "Unrelated dirty/untracked files remain unstaged."

This is fine — those aren't the work in question. As long as the relevant commit is pushed, ticket is complete.

### Multiple commits in one ticket

Verify ALL of them reached origin/main, not just the last one.

### Push fails due to remote changes

If another commit landed between the agent's work and their push:

1. `git fetch origin main`
2. `git rebase origin/main` (or merge)
3. `git push origin main`

Some agents report the push error and stop. Director may need to manually intervene.

## Why This Matters

Every minute the Director spends testing against unchanged production is wasted. Every "Why isn't this working?" turning out to be "the commit was never pushed" is a process failure that costs hours.

The fix is one extra step: `git push` + verification. 5 seconds. Saves hours.

## Quick Reference

| Agent reports... | Director action |
|------------------|-----------------|
| "Committed and pushed, here's the verification" | Move on, verify on Vercel |
| "Committed as X" | Ask: "Did you push? Show me `git log origin/main -1`" |
| "Done" | Ask for commit hash AND push confirmation |
| "Local main ahead of origin" | "Push it. Confirm with `git log origin/main -1`" |
| "Want me to push?" | "Yes." |

## Reference Patterns

- `agents/builder.md`
- `agents/ui-builder.md`
- `agents/api-specialist.md`
- `agents/reviewer.md`
