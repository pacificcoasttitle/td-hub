# Watch-Out: MCP vs Cursor Agent Capabilities

## The Trap

The Director (Claude in claude.ai project) has Supabase MCP access. Cursor agents do NOT.

This means:

- An Investigator agent in Cursor can READ files but CANNOT run SQL against production
- A Gopher agent in Cursor cannot connect to Supabase directly unless explicitly given credentials
- When Cursor agents say "I checked the database," verify HOW they checked
- The Director or the Director's Claude session is the bridge between agents and production data

## Real Incident

During the 2026-05-19 enrichment investigation, the Director asked the Investigator to run a series of queries. The Investigator (running in Cursor) replied:

> "Supabase SQL isn't reachable from this session (no MCP execute tool available), so database counts below combine verified code/schema behavior with numbers from the earlier investigator run where noted — re-run your Part 1 / 4c / 5c SQL in Supabase to refresh counts."

The Investigator did the right thing: it explicitly said "I can't run this" and provided the SQL for the Director to run.

But later, a different agent in a different session reported:

> "Trying Supabase via MCP and, if that's unavailable, the shell (Supabase CLI or psql)."
> 
> "Supabase MCP responded successfully. Running the escrow investigation queries..."

It turned out this agent's environment DID have MCP access in some sessions but not others. The capability was inconsistent.

## The Right Pattern

### When You're The Director (claude.ai project)

You have the Supabase MCP. You can:

- Run SELECT queries
- Run UPDATE/INSERT (with appropriate caution)
- Verify schema state
- Check job runs and vendor logs

When an investigation or fix needs production data, YOU run the SQL or delegate to Gopher.

### When You're An Agent In Cursor

Default assumption: you don't have direct DB access.

- Write SQL queries as copy-paste-ready blocks
- State explicitly: "Director or Gopher must run these"
- Don't fabricate results
- Don't assume what the queries would return

If you DO have MCP access:
- Confirm it's working before relying on it
- Run queries, return real results
- Note clearly: "Ran via Supabase MCP"

## Detection Patterns

### Good agent behavior

> "I cannot execute SQL against the production database from this environment. Below is a copy-paste-ready query for Supabase SQL editor:"
> ```sql
> SELECT ...
> ```

### Bad agent behavior

> "Based on the schema, this would likely return about 100 rows..."

(Without actually running it.)

> "I'll check the database... [some delay] ...looks like everything is fine."

(Without showing the query, the result, or how they checked.)

## What This Means For Workflow

### Investigation tickets

The Director writes the SQL when sending an Investigator into Cursor. Or the Investigator writes the SQL and returns it. Either way, the SQL gets run by:

1. The Director in their claude.ai session via MCP
2. The Gopher agent (if available with MCP)
3. The Director manually in Supabase SQL editor

### Backfill operations

Browser-console drain scripts work universally because they hit the deployed API. Use this pattern when the operation can be expressed as an HTTP request:

```javascript
async function drain() {
  while (true) {
    const r = await fetch('/api/admin/backfill/order-details?limit=50', { method: 'POST' });
    const data = await r.json();
    if (data.eligible < 50) break;
    await new Promise(r => setTimeout(r, 2000));
  }
}
drain();
```

This works from any browser logged into td-hub.vercel.app — no special tooling.

### Production fixes

When an investigation reveals a data issue that needs UPDATE/INSERT/DELETE:

1. Investigator returns the SQL and the preview count
2. Director reviews the SQL
3. Director runs in Supabase OR delegates to Gopher
4. Gopher follows the "preview then confirm" pattern (see `agents/gopher.md`)
5. Director verifies via a follow-up SELECT

Never let an agent run mutations without explicit Director confirmation.

## Capability Matrix

| Operation | Director (claude.ai) | Cursor Agent | Notes |
|-----------|---------------------|--------------|-------|
| SELECT from production | YES (MCP) | Usually NO | Some Cursor agents have MCP, varies by setup |
| INSERT/UPDATE/DELETE | YES (with caution) | NEVER without explicit user confirmation | Even Gopher confirms before mutating |
| Read repo files | YES (project files) | YES (Cursor IDE access) | Both can read code |
| Run typecheck | NO (no Node in claude.ai) | Maybe (some Cursor shells lack pnpm) | Sometimes neither can; rely on IDE diagnostics |
| Deploy to Vercel | NO directly | NO directly | Both push to GitHub, Vercel auto-deploys |
| Push to GitHub | NO | YES (with proper setup) | Cursor agents need `git push` access |
| Run cron manually | YES (via /api/jobs/run) | YES (same endpoint) | Both can trigger via HTTP |
| Browser console scripts | NO | NO (suggests them) | Director executes in their browser |

## When Capabilities Aren't Clear

If you're not sure what an agent can do:

1. Ask explicitly: "Do you have Supabase MCP in this session?"
2. Have them prove it: "Run `SELECT 1` and show me the result"
3. Don't assume capabilities based on previous sessions

## Communication Pattern

When the Director gives a task that requires DB access:

**To Cursor agent without MCP:**
> "Write the SQL you'd need. I'll run it and share the results back."

**To Cursor agent with MCP:**
> "Run this SQL and report the result grid."

**To Gopher specifically:**
> "Run this query. If it's a mutation, preview the count first."

Being explicit about who runs the SQL prevents the confusion of "wait, I thought you ran that?"

## Reference Patterns

- `agents/gopher.md` — Gopher's role for SQL execution
- `agents/investigator.md` — Investigator's no-mutation rule
- `agents/director.md` — Director's coordination role
