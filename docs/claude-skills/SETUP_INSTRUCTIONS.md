# Claude Skills — Setup and Usage Instructions

## What You're Getting

A complete `claude-skills/` folder with 22 markdown files organized into:

- **README.md** — overview and structure
- **7 agent role files** (`agents/`) — director, builder, ui-builder, api-specialist, investigator, gopher, reviewer
- **7 architectural patterns** (`patterns/`) — backlog-aware crons, cooldown columns, SoftPro rules, agent prompts, migrations, Drizzle timestamps, SoftPro as source of truth
- **7 watch-out warnings** (`watch-outs/`) — commit-without-push, silent job failures, enum migrations, MCP vs Cursor capabilities, shape mismatches, SoftPro data latency, Vercel cron paths

Every file references real incidents from this build with concrete code examples, anti-patterns, and detection greps.

---

## Where to Place the Files

### Step 1: Add to the repo

Place the entire `claude-skills/` folder at:

```
td-hub/
├── docs/
│   ├── claude-skills/        ← HERE
│   │   ├── README.md
│   │   ├── agents/
│   │   ├── patterns/
│   │   └── watch-outs/
│   ├── playbook/             (existing)
│   └── canon/                (existing if you have it)
├── src/
└── ...
```

Commit them to the repo:

```bash
cp -r claude-skills/ docs/
git add docs/claude-skills/
git commit -m "docs: add claude skills (agent roles, patterns, watch-outs)"
git push origin main
```

### Step 2: Upload to the Claude Project

In claude.ai:

1. Open this TD Hub vNext project
2. Click "Project knowledge" → "Add content"
3. Upload each file individually, OR upload the `.tar.gz` archive
4. Recommended: upload at minimum these 7 most-impactful files first:
   - `README.md`
   - `agents/builder.md`
   - `agents/investigator.md`
   - `patterns/backlog-aware-crons.md`
   - `patterns/cooldown-column-per-endpoint.md`
   - `watch-outs/commit-without-push.md`
   - `watch-outs/silent-job-failures.md`

Once uploaded, every conversation in this project automatically has them in context. Claude (in the Director role) will reference them automatically.

---

## How to Use Them With Cursor Agents

### Pattern 1: Reference in ticket prompts

Every ticket the Director fires to a Cursor agent should reference the relevant skill files at the top. Example:

```
You are the Builder agent for TD Hub vNext.

REQUIRED READING BEFORE STARTING:
- /docs/claude-skills/agents/builder.md (your role)
- /docs/claude-skills/patterns/backlog-aware-crons.md (the pattern)
- /docs/claude-skills/watch-outs/silent-job-failures.md (the trap to avoid)
- /docs/claude-skills/watch-outs/commit-without-push.md (REQUIRED)

TASK: [the ticket body]
```

The agent reads them from the repo before writing code. The patterns and rules become part of their working context.

### Pattern 2: Use as the standard ticket template

You can build a ticket template that auto-includes:

```
You are the [ROLE] agent for TD Hub vNext.

REQUIRED READING:
- /docs/claude-skills/agents/[role].md
[other relevant skills based on ticket type]

ROLE / TASK
[...]

STRICT RULES
[...]

[etc. — using the agent-prompt-structure.md template]
```

See `patterns/agent-prompt-structure.md` for the full template.

### Pattern 3: When agents deviate

If an agent's output doesn't follow the rules in their role file (e.g., commits without pushing, uses date-range SoftPro calls, doesn't throw on total failure):

1. Point them to the specific skill file
2. Ask them to re-do the work following it

The skill files become the standard the Director enforces.

---

## How to Use Them With Claude.ai (Project Conversations)

Once uploaded to Project knowledge:

- Every new chat in this project automatically has them in context
- The Director (Claude) will reference the right skill when relevant
- Ask "Which pattern applies here?" and Claude can pull the right one
- When drafting tickets, Claude will incorporate the patterns automatically

---

## Maintenance — Living Documents

These are not write-once. Add to them as new incidents reveal new lessons.

### When to add a new file

After any significant production incident or architectural realization:

1. What was broken? (the symptom)
2. Why was it broken? (the root cause)
3. What's the rule to prevent recurrence?

If the answer crystallizes into a clear pattern or warning, write a new file:

- `patterns/<concept>.md` — for "the right way to do X"
- `watch-outs/<trap-name>.md` — for "don't fall for this trap"

### Format for new entries

Follow the structure of existing files:

```
# Pattern/Watch-Out: [Name]

## Summary
[One-paragraph plain-English explanation]

## Real incidents
[Date and what happened, with file/commit references]

## The Pattern / The Trap
[Code examples — good and bad]

## Detection
[Grep commands or queries to find the issue]

## Cross-references
[Links to related skills]
```

### Update existing files

When patterns evolve, edit them. The original incident references stay; add new ones to the bottom of the "Real incidents" section.

---

## Suggested Workflow Going Forward

### For every new significant build

1. **Director writes the ticket** using the structure in `patterns/agent-prompt-structure.md`
2. **Director references relevant skill files** at the top of the ticket
3. **Agent reads skills first, then implements**
4. **Reviewer checks against the rules in skill files**
5. **If new lessons emerge, add to skills**

### For every production incident

1. **Investigator diagnoses** referencing existing patterns
2. **Director fires fix ticket** with explicit reference to the relevant pattern
3. **After resolution**, ask: is there a NEW skill file to write?

---

## What You Should Do Right Now

1. **Download the archive:** `claude-skills.tar.gz` from outputs
2. **Extract it into your repo's `docs/` folder**
3. **Commit and push** so the files are in the codebase
4. **Upload to the Claude Project knowledge** — at minimum the 7 high-impact files listed in Step 2
5. **Update your next ticket template** to reference the relevant skill files

Once in place, every future ticket gets the benefit of every lesson learned in this build. Future Cursor agents start at the level we ended at today, not from scratch.

---

## File Locations in Your Outputs

```
/mnt/user-data/outputs/
├── claude-skills/                     ← the folder, ready to drop into your repo
│   ├── README.md
│   ├── agents/
│   ├── patterns/
│   └── watch-outs/
└── claude-skills.tar.gz               ← compressed archive if you prefer
```

Both contain identical content. Use whichever is easier.
