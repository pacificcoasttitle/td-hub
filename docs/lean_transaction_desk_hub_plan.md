# Lean Transaction Desk Hub Plan

## 1. Product Definition

### Working name
**Transaction Desk Hub vNext**

### One-line definition
A modern order, document, and vendor-action hub that sits between **SoftPro**, **internal staff**, and **clients**.

### What it is
Transaction Desk Hub is not a full rebuild of the legacy Transaction Desk codebase. It is a **focused replacement of the operational core**:
- ingest and sync orders from SoftPro
- display statuses, details, and documents to internal staff and clients
- trigger operational actions such as CPL generation and TitlePoint requests
- provide a clean admin/ops console for managing users, entities, jobs, logs, and settings

### What it is not
- not a 1:1 port of legacy Transaction Desk
- not a reporting or commissions system
- not a museum for old routes, controllers, and hidden menu items
- not a rewrite of every historical feature unless it delivers active operational value

## 2. Strategic Framing

### Why we are doing this
The legacy codebase is large because it accumulated years of incremental work, duplication, dead code, admin sprawl, and mixed responsibilities. The actual operational value is concentrated in a much smaller set of workflows:
- SoftPro sync and order visibility
- documents and notifications
- vendor actions such as CPL and TitlePoint
- internal admin/ops workflows

### Core decision
We are **not rebuilding Transaction Desk**.
We are building a **lean, modern Transaction Desk Hub** that replaces the 20% of functionality driving 80% of the real value.

## 3. Scope

### In scope for Hub vNext
1. **Order Hub**
   - SoftPro inbound sync
   - order list and search
   - order detail view
   - operational status history
   - branch and assignment visibility

2. **Document Hub**
   - upload and tagging
   - preview and download
   - storage in S3/R2
   - attach back to SoftPro where applicable
   - audit trail for all document actions

3. **Vendor Action Hub**
   - CPL generation
   - TitlePoint requests and polling
   - notes and notifications where still operationally relevant
   - manual resync actions

4. **Admin/Ops Console**
   - users and roles
   - branches and settings
   - contacts and companies
   - vendor controls
   - logs and job visibility

5. **Client Portal**
   - order status visibility
   - documents
   - notifications/milestones where useful

### Explicitly out of scope
- revenue import rebuild
- reporting and metrics dashboards
- commission calculations
- legacy duplicate pages and hidden menus
- low-value report-adjacent admin tools

## 4. Canon and Source of Truth

We will not allow the new build to drift away from the reality of the existing system. The following documents become the canonical reference set under `/docs/canon/`:
- FULL_SYSTEM_AUDIT.md
- softpro.md
- titlepoint.md
- cpl-underwriters.md
- other-vendors.md
- order-lifecycle.md
- order-metrics.md (historical only; not implemented)
- td-vnext-phase-plan.md
- softpro-route-extraction.md
- legacy-admin-extraction.md
- td-source-extraction.md
- build-extraction.sh

### How canon is used
Every implementation area gets a playbook doc that references:
- canon docs
- extracted legacy files/methods
- preserved behaviors
- intentionally changed behaviors

### Traceability matrix
We will maintain `/docs/playbook/traceability.md` with rows like:
- Feature
- Canon docs
- Legacy extracted references
- vNext modules
- Acceptance tests

## 5. Product Modules

## 5.1 Order Hub
### Purpose
Provide a reliable operational view of orders sourced from SoftPro.

### Required capabilities
- pull new and updated orders from SoftPro
- store core order, party, property, and assignment data
- track operational statuses over time
- support fast search by file number, address, party, company, or rep
- show a clean order detail workspace

### MVP screens
- Orders list
- Order detail
- Activity/status history

## 5.2 Document Hub
### Purpose
Centralize all order-related documents in one modern pipeline.

### Required capabilities
- upload documents manually
- ingest vendor-produced docs
- classify by type
- store with storage key and metadata
- preview/download securely
- attach to SoftPro when required
- log every action

### MVP screens
- Documents tab inside order workspace
- Document viewer
- Document audit list

## 5.3 Vendor Action Hub
### Purpose
Run the operational actions that make Transaction Desk useful beyond passive visibility.

### Initial vendor actions
- CPL generation
- TitlePoint request lifecycle
- manual SoftPro resync
- note or notification actions if still relevant

### Principle
Vendor-specific quirks live inside adapters, not inside the rest of the system.

## 5.4 Admin/Ops Console
### Purpose
Replace the bloated legacy admin module with a smaller, more powerful operational console.

### Core navigation
- Dashboard
- Orders
- Contacts & Companies
- Documents
- Vendor Actions
- Jobs & Logs
- Settings
- Users & Roles

### What Admin/Ops must do
- manage users and roles
- manage branches
- manage SoftPro-facing contacts/companies/entities
- trigger manual resyncs and retries
- inspect logs, jobs, and failures
- manage settings and feature flags
- manage notification templates and relevant vendor mappings

## 5.5 Client Portal
### Purpose
Expose the subset of order data and documents that clients actually care about.

### MVP client capabilities
- log in securely
- view order status and milestones
- view order basics
- view/download documents
- receive notifications

## 6. Lean Architecture

## 6.1 Final stack
- **Next.js (App Router)** on Vercel
- **Supabase** for Postgres, Auth, and supporting functions
- **Drizzle ORM** for schema and migrations
- **S3 or Cloudflare R2** for document storage
- **Vercel Cron or Supabase pg_cron** for scheduled jobs

### Why this stack
- one core app surface
- lower ceremony for a solo builder with AI leverage
- typed schema and migrations
- easy preview/deploy workflow
- modern auth and role support

## 6.2 High-level architecture
- UI routes and server handlers in Next.js
- domain logic in `/lib/domain`
- database access in `/lib/db`
- vendor adapters in `/lib/integrations`
- job/task logic in `/lib/jobs`
- document pipeline in `/lib/documents`
- security helpers in `/lib/security`
- event/outbox hooks in `/lib/events`

## 6.3 Design rules
- keep domain logic separate from adapters
- no direct vendor calls from UI code
- every vendor action logs request/result metadata
- every document action is auditable
- no public job endpoints
- no hardcoded secrets
- no legacy-style god files

## 7. Proposed Repo Structure

```text
/app
  /(ui)
  /api
/lib
  /domain
    /orders
    /contacts
    /documents
    /settings
  /db
    /schema
    /migrations
    /queries
  /integrations
    /softpro
    /titlepoint
    /cpl
      /westcor
      /fnf
      /natic
  /jobs
  /documents
  /security
  /events
/components
/tests
/docs
  /canon
  /legacy
  /playbook
```

## 8. Core Data Model

## 8.1 Operational entities
### branches
- id
- code
- name
- active

### profiles
- user_id
- display_name
- role
- branch_id
- status

### orders
- id
- file_number
- branch_id
- operational_status
- opened_at
- closed_at
- created_at
- updated_at
- softpro_last_synced_at
- sales_rep_id
- title_officer_id
- escrow_officer_id

### order_status_history
- id
- order_id
- status
- source
- at
- notes

### order_parties
- id
- order_id
- role
- name
- entity_type
- email
- phone
- address fields

### order_properties
- id
- order_id
- apn
- address
- city
- state
- zip
- county
- legal_description

### order_external_refs
- order_id
- softpro identifiers
- titlepoint request ids
- cpl provider references
- other vendor refs

## 8.2 People and company entities
### contacts
- id
- source_system
- source_id
- type
- first_name
- last_name
- company_name
- email
- phone
- role classification
- active

### companies
- id
- source_system
- source_id
- name
- company_type
- branch association
- active

### contact_company_links
- id
- contact_id
- company_id
- relationship_type

## 8.3 Documents
### documents
- id
- order_id
- doc_type
- storage_provider
- storage_key
- filename
- content_type
- size_bytes
- checksum
- status
- created_by
- created_at

### document_audit
- id
- document_id
- action
- by_user_id
- at
- meta

## 8.4 Logging and jobs
### vendor_api_logs
- id
- order_id
- vendor
- operation
- request_id
- started_at
- ended_at
- success
- retryable
- http_status
- error_category
- request_meta
- response_meta

### jobs
- id
- job_type
- order_id
- payload
- status
- attempts
- started_at
- ended_at
- error

### admin_activity_logs
- id
- user_id
- action
- entity_type
- entity_id
- created_at
- meta

## 8.5 Event outbox
### event_outbox
- id
- event_type
- order_id
- payload
- created_at
- published_at
- fail_count

## 9. SoftPro Module

## 9.1 What SoftPro does in the hub
SoftPro is the operational source of truth for orders, statuses, and many core entities.

## 9.2 Must-have launch capabilities
- fetch and sync orders
- update statuses
- map parties/property and assignments
- create outbound order actions where actively needed
- attach documents back to SoftPro
- receive and process relevant webhooks

## 9.3 vNext SoftPro shape
### Internal job-driven flows
- sync recent orders
- sync one order by file number
- refresh contacts or companies if needed
- attach document to SoftPro

### Admin-triggered actions
- force resync order
- view raw sync result/log
- retry failed sync

### Client/internal UI usage
- display synced data from local DB
- never query SoftPro directly from the browser

## 10. CPL Module

### Scope
- Westcor
- FNF/Commonwealth
- NATIC/Doma

### Shared lifecycle
1. choose provider/form
2. build payload from local order data
3. call provider adapter
4. receive PDF
5. store document
6. attach to SoftPro if applicable
7. update order and logs

### vNext rule
Form selection must be deterministic by code or explicit business choice, never by list position.

## 11. TitlePoint Module

### Scope
- create request
- poll for completion
- fetch result/data
- fetch/store generated documents

### vNext rule
TitlePoint runs as a task/job flow with visible status, retries, and logs.

## 12. Admin/Ops Console Specification

## 12.1 Dashboard
Show:
- recent sync health
- failed jobs
- pending vendor actions
- document errors
- quick metrics for operational awareness only

## 12.2 Orders area
- list with filters
- order detail workspace
- manual resync
- assignment edits where allowed
- activity timeline

## 12.3 Contacts & Companies
- SoftPro-backed contacts
- companies
- company/contact linking
- search and edit as permitted

## 12.4 Documents
- document listing
- view/download
- upload
- reattach/retry
- audit log

## 12.5 Vendor Actions
- CPL generation
- TitlePoint request initiation
- retry failed vendor action
- inspect vendor logs

## 12.6 Jobs & Logs
- recent jobs
- failed jobs
- vendor logs
- notification logs
- admin activity logs

## 12.7 Settings
- branch settings
- provider mappings
- feature flags
- notification templates
- endpoint mode toggles for sandbox/prod where appropriate

## 12.8 Users & Roles
- user invite/disable
- role assignment
- branch scoping
- permission overview

## 13. Client Portal Specification

### MVP
- secure login
- order list relevant to user
- order detail summary
- status/milestone visibility
- documents
- notification visibility if applicable

### Phase 2 polish
- uploads requested from clients
- improved timelines
- prettier notifications and messaging

## 14. Security and Governance

### Non-negotiables
- authenticated job endpoints only
- all secrets stored in env/secret manager
- service role use is server-side only
- role-based access enforced consistently
- document access is signed and scoped
- destructive admin actions are audited
- no public cron routes
- no legacy hidden bypasses

## 15. Build Strategy

### Overall strategy
Build the hub in lean phases. Keep the legacy app running. Replace high-value operational surfaces first.

## Phase 0 — Setup and foundation (Week 1)
### Deliverables
- repo scaffold
- Supabase sandbox and prod projects
- auth skeleton
- branch/profile tables
- base layout and admin shell
- docs canon copied into repo
- traceability matrix started

### Success criteria
- can log into sandbox
- empty orders page loads
- migrations run cleanly

## Phase 1 — SoftPro-first order hub (Weeks 2–3)
### Deliverables
- orders schema
- parties/properties/status history
- SoftPro adapter
- sync recent orders job
- order list and detail UI
- vendor log writes

### Success criteria
- orders sync from SoftPro into sandbox DB
- order detail renders real synced data
- resync action works from admin

## Phase 2 — Documents hub (Weeks 3–4)
### Deliverables
- document tables
- upload flow
- storage integration
- preview/download
- document audit
- attach-to-SoftPro flow if endpoint confirmed

### Success criteria
- upload document, view it, audit it
- attach pipeline logged correctly

## Phase 3 — Contacts, companies, and admin basics (Weeks 4–5)
### Deliverables
- contacts and companies model
- management screens
- branch management
- user/role management
- settings shell

### Success criteria
- admin can search and manage entities cleanly
- no duplicate legacy-style pages

## Phase 4 — Vendor actions (Weeks 5–7)
### Deliverables
- CPL adapters
- TitlePoint adapter
- vendor action UI
- retries and logs

### Success criteria
- generate CPL via sandbox/mock
- create and poll TitlePoint request via fixture/mock

## Phase 5 — Client portal and polish (Weeks 7–8)
### Deliverables
- client-facing order and doc views
- notification visibility
- final UX cleanup
- cutover prep checklist

### Success criteria
- client can log in and see the right order/doc experience
- ops can support daily workflows without legacy UI for covered features

## 16. Reduced Agent Operating Model

We do not need a fake 12-person company. We need focused AI leverage.

### Agent 1 — Builder
Implements the feature/module for the current phase.

### Agent 2 — Refactorer
Keeps files small, extracts shared utilities, protects code quality.

### Agent 3 — UI Builder
Builds admin and client-facing screens.

### Agent 4 — Reviewer
Checks tests, auth/security, and acceptance criteria.

### How we use them
- one active build thread per major area
- one refactor pass after feature delivery
- one UI pass for polish and usability
- one reviewer pass before merge

## 17. Idiot-Proof Run Guide

## 17.1 One-time setup
1. install Node 20+
2. install pnpm
3. install Supabase CLI
4. create Supabase sandbox and prod projects
5. create Vercel project
6. create S3/R2 bucket
7. gather vendor credentials

## 17.2 Local boot
```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## 17.3 Environment variables
Minimum expected variables:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL
- storage variables for S3/R2
- SOFTPRO_* variables
- TITLEPOINT_* variables
- CPL provider variables
- JOB_RUNNER_SECRET

## 17.4 Database flow
```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```
If migrations fail, fix the database config before doing anything else.

## 17.5 Running jobs locally
Example secured endpoint pattern:
```bash
curl -X POST "http://localhost:3000/api/jobs/run?name=softpro.sync_recent_orders" \
  -H "Authorization: Bearer $JOB_RUNNER_SECRET"
```

## 17.6 Claude Code workflow
### Step 1
Refresh legacy extraction when needed and store under `/docs/legacy/`.

### Step 2
Open terminals for:
- builder
- refactorer
- ui builder
- reviewer

### Step 3
Create branch per task:
- feature/softpro-sync
- feature/order-workspace
- feature/documents
- feature/cpl
- feature/titlepoint

### Step 4
Use scoped prompts so each session owns only its lane.

### Step 5
Run reviewer before every merge:
- tests
- auth checks
- job endpoint checks
- secret scan sanity pass

## 17.7 Sandbox-first deployment
1. merge to sandbox branch
2. run migrations on sandbox
3. deploy preview
4. run sync job
5. validate UI and logs
6. only then promote to prod

## 18. What We Will Not Copy from Legacy
- public cron endpoints
- giant admin landfill controllers
- duplicate contact/company pages
- hardcoded credentials
- route sprawl for similar actions
- hidden menu hacks
- mixed UI/controller/job logic
- report-related baggage

## 19. Success Definition
We win when:
- SoftPro-connected order data flows reliably into the new hub
- internal staff can manage orders, docs, and vendor actions in one clean console
- clients can see what they need without confusion
- the codebase is understandable and maintainable by a small AI-assisted build process
- we no longer depend on the legacy Transaction Desk shape to move the business forward

## 20. Immediate Next Deliverables
1. Split this plan into `/docs/playbook/` files
2. Create traceability matrix
3. Write Drizzle schema v1
4. Write Phase 0 tickets
5. Write Phase 1 SoftPro-first tickets
6. Build admin shell and order workspace

