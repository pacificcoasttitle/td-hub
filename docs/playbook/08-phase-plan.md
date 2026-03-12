# 08 — Phase Plan

> Agent prompts: See `agent-prompts.md` for complete, paste-ready prompts for each agent role.
> Workflow per feature: Builder → Refactorer → UI Builder → Reviewer → merge.

## Timeline Summary

| Phase | Weeks | What | Status |
|-------|-------|------|--------|
| 0 | Week 1 | Foundation + scaffold | ✅ Complete |
| 1 | Weeks 2–3 | SoftPro sync + order hub | ✅ Complete |
| 2 | Weeks 3–4 | Document pipeline | ✅ Complete |
| 3 | Weeks 4–5 | Contacts, companies, admin | ✅ Complete |
| 4 | Weeks 5–7 | Vendor actions (CPL + TP) | ✅ Complete |
| 5 | Weeks 7–8 | Client portal + polish | ✅ Complete |
| 6 | TBD | Role-based dashboards (Sales Rep, Title Officer, Escrow Officer) | Planned |
| 7 | TBD | Sales Manager dashboard | Planned |
| 8 | TBD | Admin workflow hardening + client portal polish | Planned |

> Phases 6–8 tickets are in `phases-6-7-8.md`.

---

## Phase 0 — Foundation (Week 1)

### What Gets Built
- Repo scaffold (Next.js 15, TypeScript strict, Tailwind, pnpm)
- Supabase project (sandbox)
- Drizzle config + schema v1 applied
- Supabase Auth configured
- Base admin layout (sidebar + header + empty pages)
- Branch + role seed data
- `/docs/canon/` populated with all reference docs
- `/docs/playbook/` populated with this playbook
- Traceability matrix started
- `.env.example` with all required variables
- Vercel deployment (sandbox)
- CI: TypeScript compile + lint

### Tickets

**P0-1: Repo Scaffold**
```
- npx create-next-app@latest td-hub --typescript --tailwind --app
- pnpm add drizzle-orm @supabase/supabase-js @supabase/ssr @aws-sdk/client-s3 zod
- pnpm add -D drizzle-kit vitest
- Configure tsconfig.json: strict: true, noUncheckedIndexedAccess: true
- Configure drizzle.config.ts
- Create .env.example
```
✅ `pnpm build` passes with zero errors

**P0-2: Database Schema**
```
- Copy all schema files from 04-data-model.md into lib/db/schema/
- Create lib/db/client.ts (Drizzle + Supabase connection)
- Create lib/db/seed.ts (branches + roles)
- Run: pnpm db:generate && pnpm db:migrate
- Run seed
```
✅ All tables visible in Supabase dashboard
✅ 5 branches and 7 roles seeded

**P0-3: Auth Skeleton**
```
- Configure Supabase Auth (email/password)
- Create (auth)/login/page.tsx
- Create lib/security/auth.ts (getSession, requireAuth, requireRole helpers)
- Create lib/security/middleware.ts (protect admin routes)
- Create profiles table trigger (auto-create profile on Supabase Auth signup)
```
✅ Can sign up, log in, see session
✅ Unauthenticated users redirected to login

**P0-4: Admin Shell**
```
- Create (admin)/layout.tsx with sidebar navigation
- Create empty pages: dashboard, orders, contacts, documents, vendor-actions, jobs, settings, users
- PCT brand: Navy #1B2A4A, Gold #C5A55A
- Sidebar with active state
- Mobile-responsive (iPad priority)
```
✅ All 8 admin pages load (empty but styled)
✅ Sidebar navigation works
✅ Mobile layout acceptable on 768px

**P0-5: Docs + Canon**
```
- Create /docs/canon/ with all reference docs
- Create /docs/playbook/ with all playbook files
- Create /docs/playbook/10-traceability.md (initial rows)
- Create /docs/legacy/ as placeholder
```
✅ All canon docs accessible in repo
✅ Traceability matrix has at least Phase 0–1 rows

**P0-6: Deploy**
```
- Connect GitHub repo to Vercel
- Set environment variables in Vercel
- Deploy sandbox
```
✅ Sandbox URL loads login page
✅ Can log in on deployed sandbox

---

## Phase 1 — SoftPro-First Order Hub (Weeks 2–3)

### What Gets Built
- SoftPro adapter (client, mapper, types, mock)
- Order domain service (CRUD, upsert from SoftPro, status machine)
- Sync jobs (sync recent orders, sync statuses)
- Order list page with filters and search
- Order workspace (detail tabs)
- Vendor API log writes
- Manual resync action

### Tickets

**P1-1: SoftPro Adapter**
Agent: Builder
Branch: `feature/softpro-sync`
```
Scope: lib/integrations/softpro/

Build:
- client.ts: HTTP client calling SoftPro endpoints
  - getOrders(dateFrom, dateTo, orderNumber?)
  - getOrderStatuses(dateFrom, dateTo)
  - uploadDocument(orderNumber, documentName, folderName, fileUrl)
  - getLookupTable(userType)
  - healthCheck()
- types.ts: SoftProOrderItem, SoftProResponse<T>
- mapper.ts: mapSoftProOrder(item, lookups) → domain order data
- mock.ts: returns fixture data, implements same interface

Critical behaviors from legacy:
- Date parsing: handle 'n/j/Y g:i:s A' and 'm/d/Y h:i:s A'
- Country field contains county name (preserve this mapping)
- Status values come mixed-case → lowercase before storing
- No auth headers in production (verify with Jerry)
- Log every request/response to vendor_api_logs
```
✅ Mock adapter returns fixture data matching real shapes
✅ Real adapter makes HTTP calls to SoftPro (test against sandbox if available)
✅ All errors wrapped in VendorResult, never raw throws
✅ vendor_api_logs populated on every call

Canon: `05-softpro.md`, `softpro-route-extraction.md` §4–6, `td-source-extraction.md` §1

**P1-2: Order Domain Service**
Agent: Builder
Branch: `feature/softpro-sync` (same branch)
```
Scope: lib/domain/orders/

Build:
- service.ts:
  - getOrders(params) → paginated list with property + party joins
  - getOrderById(id) → full detail
  - getOrderByFileNumber(fileNumber) → for sync matching
  - upsertFromSoftPro(item, lookups) → create or update
  - updateStatus(orderId, status, source)
- status-machine.ts:
  - canTransition(from, to) → boolean
  - Allowed: open→in_process→completed→closed, open→canceled, open→duplicate
  - completed→closed (direct)
  - Any→open (reopen, explicit)
- types.ts: Order, OrderDetail, OrderListParams, etc.

Critical sync logic (from legacy fetchSoftproOrders):
- Match by file_number (unique)
- New order: create order + order_properties + map parties
- Existing order: update status/dates/salesPrice ONLY, preserve property data
- MarketingRep → look up contact by officerName match
- TitleOfficer → look up contact by officerName match
```
✅ upsertFromSoftPro creates new orders with all fields
✅ upsertFromSoftPro updates existing without overwriting property data
✅ Status machine rejects invalid transitions
✅ getOrders returns paginated results with joins

Canon: `05-softpro.md` Flow 1, `softpro-route-extraction.md` §6

**P1-3: Sync Jobs**
Agent: Builder
Branch: `feature/softpro-sync` (same branch)
```
Scope: lib/jobs/, app/api/jobs/

Build:
- runner.ts: enqueueJob, claimNextJob (FOR UPDATE SKIP LOCKED), processJob
- retry.ts: exponential backoff (30s, 120s, 480s, max 1hr)
- handlers/sync-orders.ts: calls adapter.getOrders → upsertFromSoftPro for each
- handlers/sync-status.ts: calls adapter.getOrderStatuses, 10-day chunks
- app/api/jobs/run/route.ts: POST endpoint secured by JOB_RUNNER_SECRET

Job config:
- sync_recent_orders: default today, configurable date range
- sync_order_statuses: default last 30 days, 10-day chunks, newest-first
```
✅ POST /api/jobs/run?name=softpro.sync_recent_orders returns 200 with auth
✅ POST /api/jobs/run without auth returns 401
✅ Jobs are idempotent (re-running doesn't duplicate orders)
✅ Failed jobs retry with backoff
✅ Job results visible in jobs table

Canon: `05-softpro.md` Flows 1–2, `td-source-extraction.md` §2 (Cron.php)

**P1-4: Order List UI**
Agent: UI Builder
Branch: `feature/order-workspace`
```
Scope: app/(admin)/orders/page.tsx, components/admin/

Build:
- Server component that fetches from /api/orders
- Table: File #, Address, Status, Type, Sales Rep, Title Officer, Branch, Opened
- Filters: status dropdown, branch dropdown, date range, search input
- Pagination: server-side, 25/page
- Status badges (color-coded)
- "Sync Recent Orders" button
- Click row → /admin/orders/[id]
```
✅ Page loads with real synced data
✅ Filters update URL params and refetch
✅ Pagination works
✅ Mobile layout works on 768px

**P1-5: Order Workspace UI**
Agent: UI Builder
Branch: `feature/order-workspace`
```
Scope: app/(admin)/orders/[id]/page.tsx

Build:
- Tabbed layout: Overview, Parties, Property, Documents (empty), Vendor Actions (empty), History, Logs
- Overview: file number, status, dates, branch, transaction type, financials
- Parties: sales rep, title officer, escrow officer, other parties
- Property: address, APN, county, legal description
- History: status change timeline
- "Resync" button that triggers single-order sync
```
✅ All tabs render with real data
✅ Resync button works
✅ History shows status changes with timestamps and source

---

## Phase 2 — Document Hub (Weeks 3–4)

### Tickets

**P2-1: S3 Client + Document Service**
```
Build: lib/integrations/s3/client.ts, lib/domain/documents/service.ts
- Upload, download, delete, exists, signed URL
- Document audit on every action
- Attach-to-SoftPro flow
```
Canon: `06-documents.md`

**P2-2: Document UI**
```
Build: Documents tab on order workspace, document browser admin page
- Upload form (drag-and-drop, category selector)
- Document list with download/view actions
- Audit log view
```

---

## Phase 3 — Contacts, Companies, Admin (Weeks 4–5)

### Tickets

**P3-1: Contact/Company Services**
```
Build: lib/domain/contacts/service.ts
- CRUD + search + sync from SoftPro
- Unified role-based filtering (replaces 10 legacy pages)
```

**P3-2: Contact/Company UI**
```
Build: Contacts & Companies admin page
- Single page with role filter dropdown
- Company page with linked contacts
```

**P3-3: Admin Basics**
```
Build: Users & Roles, Settings, Branch management
- User invite/disable, role assignment
- Settings key-value editor
- Branch CRUD
```

---

## Phase 4 — Vendor Actions (Weeks 5–7)

### Tickets

**P4-1: CPL Adapters**
```
Build: lib/integrations/cpl/ (westcor, fnf, natic)
- Each adapter with mock
- Shared CPL lifecycle in domain service
- selectCplForm() with name-based matching
```
Canon: `07-vendor-actions.md`, `cpl-underwriters.md`, `td-source-extraction.md` §3

**P4-2: TitlePoint Adapter**
```
Build: lib/integrations/titlepoint/
- Create, poll, fetch, image retrieval
- Job-based lifecycle with visible status
```
Canon: `07-vendor-actions.md`, `titlepoint.md`, `td-source-extraction.md` §4

**P4-3: Vendor Action UI**
```
Build: Vendor Actions admin page + order workspace tab
- CPL generation form
- TitlePoint request initiation + status display
- Retry failed actions
```

---

## Phase 5 — Client Portal + Polish (Weeks 7–8)

### Tickets

**P5-1: Client Portal**
```
Build: app/(client)/ layout + pages
- Login (same Supabase Auth, different layout)
- Order list (scoped to client's orders)
- Order detail (simplified)
- Documents (view/download only)
```

**P5-2: Polish**
```
- Final UX cleanup
- Error states on every page
- Loading skeletons
- Empty states with helpful messages
- Cutover prep checklist
```

---

## Definition of Done (Every Phase)

1. TypeScript compiles (strict, zero errors)
2. All acceptance criteria checked
3. Deployed to Vercel sandbox
4. No hardcoded secrets
5. All vendor actions logged
6. All document actions audited
7. Mobile-responsive
8. Reviewer agent approved
