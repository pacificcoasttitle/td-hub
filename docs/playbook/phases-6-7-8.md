# Phases 6–8: Dashboards, Admin Workflows, Client Portal Enhancement

> Appended to 08-phase-plan.md
> Agent prompts: See `agent-prompts.md`
> Workflow per feature: Builder → Refactorer → UI Builder → Reviewer → merge.
> External dependency: Managers Report API (https://manager-reports-one.vercel.app/) — Jerry to provide API spec.

---

## Updated Timeline Summary

| Phase | Sessions | What | Success Criteria |
|-------|----------|------|-----------------|
| 0–5 | Done | Foundation through client portal | ✅ Complete — 43 real orders, 5,696 contacts, live integrations |
| 6 | 2–3 sessions | Sales Rep + Title/Escrow Officer Dashboards | Reps see their pipeline, officers see their workload |
| 7 | 1–2 sessions | Sales Manager Dashboard | Managers see all reps, branch comparisons, team metrics |
| 8 | 1–2 sessions | Admin Workflow Hardening + Client Portal Polish | Full order entry lifecycle, prelim retrieval, client timeline |

---

## Phase 6 — Role-Based Dashboards (Sales Rep, Title Officer, Escrow Officer)

### What Gets Built
- Sales rep dashboard (my orders, my pipeline, my closed, my production)
- Title officer dashboard (my assigned orders, my production, pending tasks)
- Escrow officer dashboard (my assigned orders, documents, CPL status)
- Managers Report API integration (adapter + types)
- Role-aware routing (dashboard redirects to the right view based on profile.role)

### Dependencies
- Managers Report API spec from Jerry (URL, auth, response shape)
- `GetOrderDetails` API fix from dev team (for sales price, property address — gracefully degrades without it)

### Tickets

**P6-1: Managers Report API Adapter**
Agent: Builder
Branch: `feature/sales-dashboards`
```
Scope: src/lib/integrations/managers-report/

Build:
- client.ts: HTTP client calling the Managers Report API
  - getSalesRepFigures(repId?, dateFrom?, dateTo?, branch?): sales figures
  - getTeamFigures(branch?, dateFrom?, dateTo?): aggregated team data
  - Auth: TBD (Jerry to provide — API key, token, or password)
- types.ts: ManagersReportResponse, SalesRepFigure, etc.
- mock.ts: returns fixture data when API URL is not set

The Managers Report API is the source of truth for:
- Closed order count by rep
- Revenue/premium totals by rep
- Production metrics

TD Hub does NOT recalculate these — it consumes them from the external API.

Env vars:
- MANAGERS_REPORT_API_URL=https://manager-reports-one.vercel.app/api/...
- MANAGERS_REPORT_API_KEY=TBD
```
✅ Mock adapter returns realistic sales figures
✅ Real adapter calls the Managers Report API when credentials are set
✅ All calls logged to vendor_api_logs
✅ Graceful fallback when API is unavailable

**P6-2: Sales Rep Dashboard**
Agent: UI Builder
Branch: `feature/sales-dashboards`
```
Scope: src/app/(admin)/dashboard/ (role-aware rendering)

When profile.role === 'sales_rep', the dashboard shows:

Row 1 — Key Metrics (4 cards):
- My Open Orders (count, from orders where salesRepId = me)
- My Closed This Month (from Managers Report API or local count)
- Pipeline Value (sum of salesPrice on open orders — shows "—" until GetOrderDetails is fixed)
- Production This Month (from Managers Report API — revenue/premium total)

Row 2 — Two columns:
Left: My Recent Orders (10 most recent, clickable to detail)
  - File #, Address, Status, Opened date
  - Status badges
Right: My Activity (recent status changes on my orders)

Row 3 — My Open Orders table (full list, paginated):
- File #, Address, Status, Type, Escrow Company, Opened
- Sort by opened date desc
- Status filter
- Click to navigate to order detail

No branch filter — sales reps only see their own orders.
No admin nav items — reps don't see Jobs, Settings, Users, Vendor Actions.
```
✅ Sales rep user sees only their orders
✅ Metric cards show real data from local DB + Managers Report API
✅ Production metric pulls from Managers Report API (or shows "—" if unavailable)
✅ No admin-only nav items visible

**P6-3: Sales Rep API Routes**
Agent: Builder
Branch: `feature/sales-dashboards`
```
Scope: src/app/api/dashboard/sales-rep/

Build:
- GET /api/dashboard/sales-rep/stats:
  - Requires auth, returns data scoped to the current user's contactId/salesRepId
  - openOrders: count where salesRepId = current user
  - closedThisMonth: count where salesRepId = current user AND closedAt in current month
  - pipelineValue: sum(salesPrice) on open orders (null-safe — returns 0 if no prices)
  - Calls Managers Report API for production figures (async, non-blocking)

- GET /api/dashboard/sales-rep/orders:
  - Paginated list of orders where salesRepId = current user
  - Same response shape as /api/orders but pre-filtered

- GET /api/dashboard/sales-rep/activity:
  - Recent status changes on the rep's orders
  - Same shape as /api/dashboard/activity but scoped
```
✅ Each endpoint returns data scoped to the authenticated user only
✅ Cannot see other reps' data
✅ Managers Report API failure doesn't break the dashboard

**P6-4: Title Officer Dashboard**
Agent: UI Builder
Branch: `feature/officer-dashboards`
```
Scope: src/app/(admin)/dashboard/ (role-aware rendering)

When profile.role === 'title_officer', the dashboard shows:

Row 1 — Key Metrics (4 cards):
- My Assigned Orders (count where titleOfficerId = me)
- Open Orders (subset that are open/in_process)
- Completed This Month
- Pending TitlePoint Requests (count from title_point_data where status = 'pending' on my orders)

Row 2 — Two columns:
Left: My Recent Orders (same pattern as sales rep)
Right: Pending Tasks
  - TitlePoint requests awaiting results
  - Documents pending SoftPro attach
  - Orders needing prelim

Row 3 — My Orders table:
- File #, Address, Status, Type, Sales Rep, Opened
- Filtered to titleOfficerId = me
- Paginated

Nav: show Orders, Documents, Vendor Actions (TitlePoint). Hide Settings, Users, Jobs.
```
✅ Title officer sees only their assigned orders
✅ Pending tasks show actionable items
✅ TitlePoint pending count is accurate

**P6-5: Title Officer API Routes**
Agent: Builder
Branch: `feature/officer-dashboards`
```
Scope: src/app/api/dashboard/title-officer/

Build:
- GET /api/dashboard/title-officer/stats:
  - Scoped to current user's contactId → orders.titleOfficerId
  - assignedOrders, openOrders, completedThisMonth, pendingTitlePoint

- GET /api/dashboard/title-officer/orders:
  - Paginated, scoped to titleOfficerId = current user

- GET /api/dashboard/title-officer/pending:
  - TitlePoint requests in 'pending' status on the officer's orders
  - Documents with isSyncedToSoftpro = false on their orders
```
✅ Scoped to authenticated user
✅ Pending items are accurate and actionable

**P6-6: Escrow Officer Dashboard**
Agent: UI Builder
Branch: `feature/officer-dashboards`
```
Scope: src/app/(admin)/dashboard/ (role-aware rendering)

When profile.role === 'escrow_officer', the dashboard shows:

Row 1 — Key Metrics (4 cards):
- My Assigned Orders (where escrowOfficerId = me)
- Open Orders (subset)
- Documents Pending (documents on my orders not synced to SoftPro)
- CPL Documents Generated (count of category='cpl' docs on my orders)

Row 2 — Two columns:
Left: My Recent Orders
Right: Document Activity
  - Recent uploads on my orders
  - Recent webhook-received documents (prelims, policies)
  - Documents needing SoftPro attach

Row 3 — My Orders table:
- File #, Address, Status, Type, Escrow Company, CPL Status, Opened
- CPL Status column: "Generated" (green) or "Pending" (amber) or "—"
- Filtered to escrowOfficerId = me

Nav: show Orders, Documents, Vendor Actions (CPL). Hide Settings, Users.
```
✅ Escrow officer sees only their assigned orders
✅ CPL status visible per order
✅ Document pipeline activity visible

**P6-7: Escrow Officer API Routes**
Agent: Builder
Branch: `feature/officer-dashboards`
```
Scope: src/app/api/dashboard/escrow-officer/

Build:
- GET /api/dashboard/escrow-officer/stats:
  - Scoped to escrowOfficerId = current user
  - assignedOrders, openOrders, pendingDocuments, cplGenerated

- GET /api/dashboard/escrow-officer/orders:
  - Paginated, scoped

- GET /api/dashboard/escrow-officer/documents:
  - Recent document activity on their orders (uploads, webhooks, attach status)
```
✅ Scoped correctly
✅ CPL count accurate

**P6-8: Role-Aware Dashboard Router**
Agent: Builder
Branch: `feature/dashboard-router`
```
Scope: src/app/(admin)/dashboard/page.tsx

Update the dashboard page to check session.role and render the right view:
- super_admin, admin, cs_admin → Admin Ops Dashboard (current)
- sales_rep → Sales Rep Dashboard (P6-2)
- title_officer → Title Officer Dashboard (P6-4)
- escrow_officer → Escrow Officer Dashboard (P6-6)
- client → redirect to /client/orders

Update the sidebar navigation to show/hide items based on role:
- super_admin, admin: all nav items
- cs_admin: all except Settings
- sales_rep: Dashboard, Orders, Contacts
- title_officer: Dashboard, Orders, Documents, Vendor Actions
- escrow_officer: Dashboard, Orders, Documents, Vendor Actions
- client: redirect to client layout

Create src/lib/security/permissions.ts:
- NAV_BY_ROLE: maps role → visible nav items
- canAccess(role, feature): boolean check
```
✅ Each role sees the right dashboard on login
✅ Sidebar shows only permitted nav items
✅ No role can see another role's dashboard data

**P6-9: Refactorer Pass**
Agent: Refactorer
```
After P6-1 through P6-8 land:
- Check all new files are under 300 lines
- Extract shared dashboard components (StatCard, ActivityFeed, OrderTable) into src/components/admin/dashboard/
- Ensure role-scoped API routes share common query patterns (don't duplicate 6 versions of "get my orders")
- Extract scoping logic into a shared helper: getMyOrders(userId, role) that handles the role→FK mapping
```
✅ No files over 300 lines
✅ Shared components extracted
✅ No duplicated query logic

**P6-10: Reviewer Pass**
Agent: Reviewer
```
Full 10-point checklist on feature/sales-dashboards and feature/officer-dashboards before merge.
Focus:
- Every dashboard API route is scoped to the authenticated user
- No cross-role data leakage (sales rep can't see title officer's pending tasks)
- Role-based nav is enforced (not just hidden — API routes reject unauthorized roles)
- Managers Report API errors handled gracefully (dashboard still loads)
```
✅ PASS or BLOCK with specific issues

---

## Phase 7 — Sales Manager Dashboard

### What Gets Built
- Manager dashboard: all reps' performance, team metrics, branch comparisons
- Consumes Managers Report API for production/revenue data
- Rep comparison charts
- Branch-level aggregation

### Dependencies
- Phase 6 complete (shared components, API adapter)
- Managers Report API spec from Jerry

### Tickets

**P7-1: Sales Manager Dashboard**
Agent: UI Builder
Branch: `feature/manager-dashboard`
```
Scope: src/app/(admin)/dashboard/ (role-aware — managers are typically admin or super_admin)

Accessible to: super_admin, admin roles.
Separate tab or toggle on the admin dashboard: "Ops View" vs "Sales View"

Sales View shows:

Row 1 — Team Metrics (4 cards):
- Total Open Orders (all reps)
- Total Closed This Month (all reps)
- Team Pipeline Value
- Team Revenue This Month (from Managers Report API)

Row 2 — Rep Performance Table:
- Table: Rep Name, Open Orders, Closed This Month, Pipeline Value, Revenue, Avg Days to Close
- Data from local DB (orders) + Managers Report API (revenue)
- Sortable by any column
- Click rep name to see their order list
- Filter by branch dropdown

Row 3 — Branch Comparison:
- Cards or bar chart: orders by branch (GLT, OCT, ONT, PRV, TSG)
- Open vs Closed breakdown per branch

Row 4 — Recent Closings:
- Last 20 closed orders across all reps
- File #, Address, Rep, Closed Date
```
✅ Managers see all reps' data
✅ Branch filter works
✅ Revenue data from Managers Report API (or "—" if unavailable)
✅ Sortable rep performance table

**P7-2: Manager API Routes**
Agent: Builder
Branch: `feature/manager-dashboard`
```
Scope: src/app/api/dashboard/manager/

Build:
- GET /api/dashboard/manager/team-stats:
  - Requires admin role
  - totalOpen, totalClosedThisMonth, teamPipelineValue, teamRevenue (from Managers Report API)
  - Optional ?branch= filter

- GET /api/dashboard/manager/rep-performance:
  - Returns array of { repId, repName, openOrders, closedThisMonth, pipelineValue, revenue, avgDaysToClose }
  - Joins orders → contacts for rep names
  - Revenue from Managers Report API (merged by rep lookup code or name)
  - Optional ?branch= filter

- GET /api/dashboard/manager/branch-stats:
  - Returns array of { branchId, branchCode, branchName, openOrders, closedOrders }

- GET /api/dashboard/manager/recent-closings:
  - Last N closed orders with rep name, address, closed date
  - Requires admin role
```
✅ Admin role required on all endpoints
✅ Branch filter works
✅ Managers Report API data merged correctly with local order data

**P7-3: Reviewer Pass**
Agent: Reviewer
```
Focus:
- Manager endpoints require admin role (not sales_rep or officer)
- Managers Report API errors handled gracefully
- No N+1 queries in rep performance aggregation
- Branch filter is SQL-safe (no injection)
```
✅ PASS or BLOCK

---

## Phase 8 — Admin Workflow Hardening + Client Portal Polish

### What Gets Built
- Complete admin order entry lifecycle (form → SoftPro → TitlePoint → prelim → CPL)
- Prelim retrieval automation (fetch from SoftPro, store, trigger TESSA analysis)
- Client portal timeline and document request workflow
- Mobile-responsive client views

### Dependencies
- `GetOrderDetails` API fix from dev team (for full order entry lifecycle)
- TitlePoint live mode tested and confirmed

### Tickets

**P8-1: Order Entry → TitlePoint Auto-Trigger**
Agent: Builder
Branch: `feature/order-lifecycle`
```
Scope: src/lib/domain/orders/create-order.ts, src/lib/domain/titlepoint/

After a new order is created via the Open Order form:
1. If property has address + state + county:
   - Auto-initiate TitlePoint Geo search
   - Auto-initiate TitlePoint Tax search (using APN if available)
   - Auto-initiate TitlePoint Legal Vesting search
2. Each search creates a title_point_data record and enqueues a titlepoint.poll job
3. When results come back:
   - Tax PDF → S3 tax/{fileNumber}.pdf → document record
   - LV PDF → S3 legal-vesting/{fileNumber}.pdf → document record
   - Grant Deed PDF → S3 grant-deed/{fileNumber}.pdf → document record
4. Store all results in title_point_data metadata (FIPS, brief legal, vesting, tax data)

This happens automatically after order creation — no manual trigger needed.
Admin can also trigger manually from the order detail Vendor Actions tab.
```
✅ TitlePoint searches auto-trigger on new order creation
✅ PDFs appear in Documents tab within minutes
✅ Failure doesn't block order creation
✅ Manual trigger works from order detail

**P8-2: Prelim Retrieval + TESSA Analysis**
Agent: Builder
Branch: `feature/prelim-flow`
```
Scope: src/lib/domain/documents/, src/lib/domain/tessa/

Build the prelim retrieval flow:
1. Create src/lib/jobs/handlers/fetch-prelims.ts:
   - Job that calls SoftPro GetAttachedDocuments for orders without prelim documents
   - Downloads each PDF URL
   - Uploads to S3 prelim-upload-doc/{fileNumber}/{filename}
   - Creates document record (category: 'prelim')
   - Register as 'softpro.fetch_prelims' in job runner

2. Create src/lib/domain/tessa/service.ts (placeholder):
   - analyzePrelim(documentId): sends prelim PDF to TESSA for analysis
   - Stores analysis result in a new tessa_analyses table (or JSON in document metadata)
   - This is a placeholder for TESSA integration — the analysis engine exists separately
   - For now: mark the prelim as "analysis_pending" and log

3. Wire prelim webhook to TESSA:
   - When handlePrelimWebhook receives a prelim, after storing the document:
   - Enqueue a tessa.analyze job with the documentId
   - TESSA job calls analyzePrelim (placeholder for now)

Add cron to vercel.json:
- softpro.fetch_prelims — every 30 minutes
```
✅ Prelim PDFs auto-fetched from SoftPro for new orders
✅ Webhook-received prelims also queued for TESSA
✅ TESSA placeholder ready for integration
✅ Cron runs every 30 minutes

**P8-3: Admin Order Entry Polish**
Agent: UI Builder
Branch: `feature/order-lifecycle`
```
Scope: src/app/(admin)/orders/new/, src/app/(admin)/orders/[id]/

Enhance the Open Order wizard with post-creation workflow:

1. After successful order creation, show a "What's Next" panel:
   - "TitlePoint searches initiated" (with status indicators)
   - "Waiting for prelim report" (pending)
   - "Generate CPL when ready" (link to vendor actions with orderId pre-filled)

2. Add to order detail page:
   - TitlePoint status indicators on the Property tab (searching → complete → PDFs available)
   - Prelim status on the Documents tab (not received → received → analyzed by TESSA)
   - Order timeline: consolidated view of all activity (status changes, documents, TitlePoint, CPL)

3. Add "Retrieve Prelim" button on order detail:
   - Manually triggers GetAttachedDocuments for this order
   - Downloads and stores any new documents
   - Refreshes the documents list
```
✅ Post-creation workflow guides the admin
✅ TitlePoint progress visible on order detail
✅ Manual prelim retrieval works
✅ Order timeline shows full lifecycle

**P8-4: Client Portal Timeline**
Agent: UI Builder
Branch: `feature/client-portal-v2`
```
Scope: src/app/client/orders/[id]/

Add a visual timeline to the client order detail:

1. Timeline tab (or replace the Overview tab with a timeline-first view):
   - Visual vertical timeline showing milestones:
     - Order opened (date)
     - Prelim received (date, with "View" link)
     - Title search complete (date)
     - CPL generated (date, with "Download" link)
     - Policy issued (date, with "Download" link)
     - Recording confirmation (date)
     - Closed (date)
   - Each milestone: green check if complete, gray if pending, amber if in progress
   - Milestone data comes from order_status_history + documents + title_point_data

2. Clean, professional design — this is customer-facing
   - Navy and white, no gold (matching existing client portal)
   - Large clear status indicator at top: "Your order is [IN PROGRESS / COMPLETE]"
   - Estimated timeline if data supports it

3. Mobile-responsive — clients use phones
   - Stack timeline vertically
   - Large tap targets
   - Readable on 375px width
```
✅ Timeline renders with real milestone data
✅ Document links work (download via signed URL)
✅ Mobile layout works on 375px
✅ No admin-only data exposed

**P8-5: Client Document Request Workflow**
Agent: Builder + UI Builder
Branch: `feature/client-portal-v2`
```
Builder scope: src/lib/domain/documents/, src/app/api/client/

Build:
- document_requests table (or add fields to documents):
  - orderId, requestedBy (userId), requestType, message, status (pending/fulfilled/canceled), createdAt
- POST /api/client/orders/[id]/documents/request: client submits a document request
- GET /api/client/orders/[id]/documents/requests: client sees their requests
- Admin view: show pending document requests on the order detail page
- When admin uploads a document matching a request, auto-mark the request as fulfilled
- Send notification email to client when their requested document is uploaded

UI Builder scope: src/app/client/orders/[id]/, src/components/admin/

- Client: "Request Document" button on documents tab
  - Simple form: document type dropdown, optional message
  - Shows list of pending requests with status
- Admin: "Pending Requests" badge on order detail documents tab
  - Shows client requests with "Upload to fulfill" action
```
✅ Client can request a document
✅ Admin sees pending requests
✅ Fulfillment auto-links and notifies
✅ No admin data exposed to client

**P8-6: Refactorer + Reviewer Pass**
Agent: Refactorer then Reviewer
```
Refactorer:
- All new files under 300 lines
- Shared timeline component (used by both admin and client views)
- Shared milestone logic extracted from timeline rendering

Reviewer:
- Full 10-point checklist
- Client portal: no admin data leakage
- Document requests: proper scoping
- TitlePoint auto-trigger: failure doesn't block order creation
- TESSA placeholder: no real API calls until integration is complete
```
✅ PASS or BLOCK

---

## Summary: Agent Assignments by Phase

### Phase 6 (10 tickets)
| Agent | Tickets |
|-------|---------|
| Builder | P6-1, P6-3, P6-5, P6-7, P6-8 |
| UI Builder | P6-2, P6-4, P6-6 |
| Refactorer | P6-9 |
| Reviewer | P6-10 |

### Phase 7 (3 tickets)
| Agent | Tickets |
|-------|---------|
| Builder | P7-2 |
| UI Builder | P7-1 |
| Reviewer | P7-3 |

### Phase 8 (6 tickets)
| Agent | Tickets |
|-------|---------|
| Builder | P8-1, P8-2, P8-5 (builder portion) |
| UI Builder | P8-3, P8-4, P8-5 (UI portion) |
| Refactorer + Reviewer | P8-6 |

### Gopher Role (All Phases)
The Gopher is on standby for:
- Testing live API connections (Managers Report API, TitlePoint live mode)
- Debugging integration issues between Builder and UI Builder outputs
- Running enrichment scripts
- Verifying data after syncs
- Testing mobile views for client portal

---

## External Dependencies Tracker

| Dependency | Owner | Status | Blocks |
|------------|-------|--------|--------|
| `GetOrderDetails` API fix | PCT Dev Team | Requested | Sales price, addresses, transaction types on all orders |
| `GetOrderMarketingRep` API fix | PCT Dev Team | Requested | Automatic sales rep sync |
| Managers Report API spec | Jerry | Pending — Jerry to provide endpoints, auth, response shapes | P6-1, P6-2, P7-1, P7-2 |
| TESSA analysis integration | Separate project | Existing — needs API endpoint | P8-2 |
| SiteX production URL switch | Jerry/BKI | UAT works, need production `api.bkiconnect.com` access | Better property enrichment results |
| Westcor sandbox credentials | Westcor | Have production creds, need sandbox for testing | P4 live CPL generation |
