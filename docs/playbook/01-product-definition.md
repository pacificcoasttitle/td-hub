# 01 — Product Definition

## Working Name
**Transaction Desk Hub vNext**

## One-Line Definition
A modern order, document, and vendor-action hub that sits between SoftPro, internal staff, and clients.

## What It Is
Transaction Desk Hub is a focused replacement of the operational core of the legacy Transaction Desk. It does four things:

1. **Ingests and syncs orders from SoftPro** — the source of truth for PCT's title and escrow orders.
2. **Displays statuses, details, and documents** to internal staff (admins, sales reps, title officers, escrow officers) and external clients.
3. **Triggers operational actions** — CPL generation, TitlePoint property searches, document uploads back to SoftPro.
4. **Provides an admin/ops console** for managing users, entities, jobs, logs, and settings.

## What It Is Not
- Not a 1:1 port of legacy Transaction Desk
- Not a reporting or commissions system
- Not a museum for old routes, controllers, and hidden menu items
- Not a rewrite of every historical feature unless it delivers active operational value

## Why We're Doing This
The legacy codebase is large because it accumulated years of incremental work. The actual operational value is concentrated in a small set of workflows. The rest is duplication, dead code, admin sprawl, and mixed responsibilities.

### The Core Decision
We are **not rebuilding Transaction Desk**. We are building a **lean, modern hub** that replaces the 20% of functionality driving 80% of the real value.

## Scope

### In Scope
| Module | What It Does |
|--------|-------------|
| **Order Hub** | SoftPro inbound sync, order list/search, order detail, status history, branch/assignment visibility |
| **Document Hub** | Upload/tagging, preview/download, S3 storage, attach back to SoftPro, audit trail |
| **Vendor Action Hub** | CPL generation, TitlePoint requests, manual resync, notes/notifications where relevant |
| **Admin/Ops Console** | Users/roles, branches/settings, contacts/companies, vendor controls, logs/job visibility |
| **Client Portal** | Order status, documents, notifications/milestones |

### Explicitly Out of Scope
- Revenue import rebuild
- Reporting and metrics dashboards
- Commission calculations
- Legacy duplicate pages and hidden menus
- Low-value report-adjacent admin tools
- Safewire orders
- Partner API log viewers (legacy vendor integration)

## Success Definition
We win when:
1. SoftPro-connected order data flows reliably into the new hub
2. Internal staff can manage orders, docs, and vendor actions in one clean console
3. Clients can see what they need without confusion
4. The codebase is understandable and maintainable by a small AI-assisted build process
5. We no longer depend on the legacy Transaction Desk shape to move the business forward

## Canon References
- `lean_transaction_desk_hub_plan.md` — The master plan
- `FULL_SYSTEM_AUDIT.md` — What the legacy system actually looks like
- `legacy-admin-extraction.md` — The 236-view admin landfill we're replacing
