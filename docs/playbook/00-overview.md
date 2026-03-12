# 00 — Playbook Overview

> Transaction Desk Hub vNext — Lean Build Playbook
> Last updated: 2026-03-11

## Current Status

**Phases 0–5: COMPLETE.** Deployed to https://td-hub.vercel.app/

| What | Count |
|------|-------|
| Real production orders | 43 (synced from SoftPro) |
| Contacts | 5,696 |
| Companies | 2,748 |
| Order parties | 189 (enriched via GetOrderContacts) |
| Live integrations | 6 (S3, SendGrid, Twilio, SiteX, TitlePoint, SoftPro) + Google Maps |

**Phases 6–8: PLANNED.** Role-based dashboards, sales manager views, admin workflow hardening, client portal polish.

## What This Playbook Is

This is the complete operational guide for building TD Hub vNext. Every file in `/docs/playbook/` is a self-contained reference that AI agents and human builders use during implementation. No file depends on memory from a previous chat session — each one carries its own context.

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
| `phases-6-7-8.md` | Phase 6–8 tickets: dashboards, admin workflows, client portal. |
| `09-runbook.md` | Setup, local dev, deployment, Claude Code workflow. |
| `10-traceability.md` | Feature → canon doc → legacy ref → vNext module → tests. |
| `agent-prompts.md` | Complete standalone prompts for all agent roles. |

## Agents

There are 6 roles. Prompts for the core 4 are in `agent-prompts.md`. The Director and Gopher emerged during build sessions.

| Agent | Role | What It Owns | Where It Runs |
|-------|------|-------------|---------------|
| **Director** | Plans, decides scope, writes tickets, resolves conflicts | The playbook itself | Claude.ai (this chat) |
| **Builder** | Implements backend features per ticket | `src/lib/`, `src/app/api/` | Cursor Composer |
| **UI Builder** | Builds admin and client screens | `src/app/(admin)/`, `src/app/client/`, `src/components/` | Cursor Composer |
| **Gopher** | Debugs, tests, wires up conflicts, runs scripts | Any file — fixes issues | Cursor Composer |
| **Refactorer** | Structural cleanup — splits files, extracts shared code | Any file, but no behavior changes | Cursor Composer |
| **Reviewer** | 10-point checklist before merge | Read-only — reports PASS or BLOCK | Cursor Composer |

Workflow per feature: Builder + UI Builder (parallel) → Gopher (wire up conflicts) → Refactorer → Reviewer → merge.

## Canon Documents

These live in `/docs/canon/` and are read-only references:

| Document | What It Contains |
|----------|------------------|
| `FULL_SYSTEM_AUDIT.md` | 59 tables, 15 integrations, all legacy issues |
| `softpro.md` | SoftPro integration overview |
| `Softpro-API.md` | Real SoftPro API endpoints with request/response shapes (24 endpoints + PowerBI) |
| `softpro-route-extraction.md` | All 21 SoftPro endpoints, 10 core flows, data mappings, route map |
| `SiteX-and-TitlePoint-Complete-Reference.md` | SiteX OAuth flow, TitlePoint SOAP lifecycle, field mappings, gotchas |
| `GOOGLE_MAPS_AND_SITEX_PROPERTY_LOOKUP.md` | Google Maps + SiteX property lookup integration guide |
| `titlepoint.md` | TitlePoint/DataTrace integration |
| `cpl-underwriters.md` | Westcor, FNF, NATIC, Doma specs |
| `other-vendors.md` | Twilio, Adobe Sign, SendGrid, etc. |
| `order-lifecycle.md` | Order creation methods, state machine |
| `order-metrics.md` | Historical metrics (not implemented in vNext) |
| `legacy-admin-extraction.md` | 236 views, 15 controllers, role model, all admin workflows |
| `td-source-extraction.md` | 19,806 lines of legacy PHP source code |
| `build-extraction.sh` | Script that generated the source extraction |
| `lean_transaction_desk_hub_plan.md` | The master plan (this playbook implements it) |

## Live Integration Status

| Integration | Status | Env Vars | Notes |
|-------------|--------|----------|-------|
| SoftPro API | ✅ Live | `SOFTPRO_API_URL`, `SOFTPRO_TOKEN` | `GetOrders` + `GetOrderContacts` working. `GetOrderDetails` returns 404 (dev team notified). `GetOrderMarketingRep` hangs (dev team notified). Token auth via `X-API-KEY` header. |
| AWS S3 | ✅ Live | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BUCKET`, `AWS_PATH` | Bucket: `pct-doc`, region: `us-west-2`. Production key. |
| SendGrid | ✅ Live | `SENDGRID_API_KEY`, `FROM_EMAIL` | Production key. Verified domain: `pct.com`. From: `openorders@pct.com`. |
| Twilio | ✅ Live | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | From: `+18186965791`. SMS tested and working. |
| SiteX (BKI) | ✅ Live (UAT) | `SITEX_BASE_URL`, `SITEX_CLIENT_ID`, `SITEX_CLIENT_SECRET`, `SITEX_FEED_ID` | UAT env (`api.uat.bkitest.com`). OAuth2 working. Limited property data in UAT. Production URL: `api.bkiconnect.com`. |
| TitlePoint | ✅ Connected | `TP_USERNAME`, `TP_PASSWORD`, `TP_BASE_URL` | Server responding. Auth param is `userID` (not `username`). Mock adapter in use — live mode ready. |
| Google Maps | ✅ Live | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Places Autocomplete for address entry. |
| Westcor CPL | 🔑 Creds ready | `WESTCOR_URL`, `WESTCOR_USERNAME`, `WESTCOR_PASSWORD`, `WESTCOR_INTEGRATION_PARTNER` | Production creds. Mock adapter in use. |
| FNF CPL | ⬜ Need creds | `FNF_CLIENT_ID`, `FNF_SECRET_KEY`, etc. | In legacy .env but not yet extracted. |
| NATIC/Doma CPL | ⬜ Need creds | `NATIC_URL`, `NATIC_USERNAME`, etc. | In legacy .env but not yet extracted. |

## Known API Gaps (Dev Team Requested)

| Endpoint | Issue | Impact | Requested |
|----------|-------|--------|-----------|
| `GetOrderDetails` | Returns 404 | No property addresses, sales prices, transaction types on synced orders | 2026-03-11 |
| `GetOrderMarketingRep` | Hangs indefinitely | Can't sync sales rep list automatically | 2026-03-11 |

## External Dependencies

| Dependency | Owner | Status | Blocks |
|------------|-------|--------|--------|
| `GetOrderDetails` API fix | PCT Dev Team | Requested | Addresses, sales prices, transaction types |
| `GetOrderMarketingRep` API fix | PCT Dev Team | Requested | Sales rep auto-sync |
| Managers Report API spec | Jerry | Pending | Phase 6 sales dashboards |
| SiteX production URL | Jerry/BKI | UAT working | Better property enrichment |
| TESSA analysis API | Separate project | Exists | Phase 8 prelim analysis |

## Rules

1. **Every implementation references a playbook doc.** No building from memory.
2. **Every playbook doc references canon.** No making stuff up.
3. **The traceability matrix is the audit trail.** If a feature isn't in `10-traceability.md`, it doesn't exist yet.
4. **Schema is the law.** `04-data-model.md` defines what the database looks like. Agents don't improvise tables.
5. **Adapters own vendor quirks.** Domain code never knows about SoftPro date formats or Westcor OAuth flows.
6. **Gopher wires up conflicts.** When Builder and UI Builder both create the same route, the Gopher decides which version wins.
7. **Reviewer gates every merge.** No push without a PASS.
