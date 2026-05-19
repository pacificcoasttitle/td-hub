# Claude Skills for TD Hub vNext

This directory contains role definitions, architectural patterns, and watch-outs that codify hard-won lessons from building TD Hub vNext. Every file references real incidents and concrete code.

## How to use these files

**For the Director (Jerry):** Reference these in agent prompts at session start. Example:

```
You are the Builder agent for TD Hub vNext.

Before writing any code, read:
- /docs/claude-skills/agents/builder.md (your role)
- /docs/claude-skills/patterns/backlog-aware-crons.md (the pattern to follow)
- /docs/claude-skills/watch-outs/commit-without-push.md (avoid this trap)

[ticket body]
```

**For agents:** When loaded, treat these as authoritative. They reflect lessons learned from production incidents. Deviation requires explicit approval from the Director.

**For project knowledge:** Upload this folder to the Claude Project. Then every Claude conversation in the project automatically has these in context.

## Directory structure

```
claude-skills/
├── README.md                          # this file
├── agents/                            # role definitions
│   ├── director.md
│   ├── builder.md
│   ├── ui-builder.md
│   ├── api-specialist.md
│   ├── investigator.md
│   ├── gopher.md
│   └── reviewer.md
├── patterns/                          # the right way to do things
│   ├── backlog-aware-crons.md
│   ├── cooldown-column-per-endpoint.md
│   ├── softpro-integration-rules.md
│   ├── agent-prompt-structure.md
│   ├── migration-and-deploy-checklist.md
│   ├── drizzle-timestamp-coercion.md
│   └── softpro-source-of-truth.md
└── watch-outs/                        # known traps
    ├── commit-without-push.md
    ├── silent-job-failures.md
    ├── enum-migrations-need-manual-sql.md
    ├── mcp-vs-cursor-agent-capabilities.md
    ├── vercel-cron-paths.md
    └── softpro-data-latency.md
```

## Principles

1. **Concrete, not abstract.** Every rule references a real incident with date.
2. **Show the right pattern AND the anti-pattern.** What good looks like, what wrong looks like, what to grep for.
3. **Cross-link.** Watch-outs link to patterns. Patterns link to agent roles.
4. **Living documents.** When a new incident reveals a new lesson, add it.
