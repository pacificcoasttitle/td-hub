# 00 — Playbook Overview

> Transaction Desk Hub vNext — Lean Build Playbook
> Last updated: 2026-03-10

## What This Playbook Is

This is the complete operational guide for building TD Hub vNext. Every file in `/docs/playbook/` is a self-contained reference that Claude Code agents and human builders use during implementation. No file depends on memory from a previous chat session — each one carries its own context.

## Playbook Index

| File | Purpose |
|------|---------|
| `00-overview.md` | This file. Index and orientation. |
| `01-product-definition.md` | What we're building, what we're not, why. |
| `02-architecture.md` | Stack, repo structure, design rules. |
| `03-admin-console.md` | Admin/Ops console navigation, screens, roles. |
| `04-data-model.md` | Complete Drizzle schema with rationale for every table. |
| `05-softpro.md` | SoftPro adapter spec, endpoints, sync logic, data mapping. |
| `06-documents.md` | Document pipeline: upload, storage, audit, SoftPro attach. |
| `07-vendor-actions.md` | CPL (all 4 underwriters) and TitlePoint specs. |
| `08-phase-plan.md` | Phase 0–5 tickets with acceptance criteria. |
| `09-runbook.md` | Setup, local dev, deployment, Claude Code workflow. |
| `10-traceability.md` | Feature → canon doc → legacy ref → vNext module → tests. |
| `agent-prompts.md` | Complete standalone prompts for all 4 Claude Code agents. |

## Agents

There are 4 agents. Full prompts are in `agent-prompts.md` — paste directly into Claude Code terminals.

| Agent | Role | What It Owns |
|-------|------|-------------|
| **Builder** | Implements features per ticket | `lib/domain/`, `lib/integrations/`, `lib/jobs/`, `app/api/` |
| **Refactorer** | Structural cleanup after Builder | Any file, but no behavior changes |
| **UI Builder** | Builds admin and client screens | `app/(admin)/`, `app/(client)/`, `app/(auth)/`, `components/` |
| **Reviewer** | 10-point review before merge | Read-only — reports issues, does not fix them |

Workflow per feature: Builder → Refactorer → UI Builder → Reviewer → merge.

## Canon Documents

These live in `/docs/canon/` and are read-only references:

| Document | What It Contains |
|----------|------------------|
| `FULL_SYSTEM_AUDIT.md` | 59 tables, 15 integrations, all legacy issues |
| `softpro.md` | SoftPro integration overview |
| `softpro-route-extraction.md` | All 21 SoftPro endpoints, 10 core flows, data mappings, route map |
| `titlepoint.md` | TitlePoint/DataTrace integration |
| `cpl-underwriters.md` | Westcor, FNF, NATIC, Doma specs |
| `other-vendors.md` | Twilio, Adobe Sign, SendGrid, etc. |
| `order-lifecycle.md` | Order creation methods, state machine |
| `order-metrics.md` | Historical metrics (not implemented in vNext) |
| `legacy-admin-extraction.md` | 236 views, 15 controllers, role model, all admin workflows |
| `td-source-extraction.md` | 19,806 lines of legacy PHP source code |
| `build-extraction.sh` | Script that generated the source extraction |
| `lean_transaction_desk_hub_plan.md` | The master plan (this playbook implements it) |

## Legacy Extractions

These live in `/docs/legacy/` and are point-in-time snapshots:

| Document | What It Contains |
|----------|------------------|
| `softpro-route-extraction.md` | Symlink or copy from canon |
| `legacy-admin-extraction.md` | Symlink or copy from canon |
| `td-source-extraction.md` | Symlink or copy from canon |

## Rules

1. **Every implementation references a playbook doc.** No building from memory.
2. **Every playbook doc references canon.** No making stuff up.
3. **The traceability matrix is the audit trail.** If a feature isn't in `10-traceability.md`, it doesn't exist yet.
4. **Schema is the law.** `04-data-model.md` defines what the database looks like. Agents don't improvise tables.
5. **Adapters own vendor quirks.** Domain code never knows about SoftPro date formats or Westcor OAuth flows.
