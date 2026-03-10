# 03 — Admin/Ops Console

## Purpose
Replace the legacy admin module (180-method Home.php, 236 PHP views, 15 subdirectories) with a clean, consolidated admin/ops console. The legacy admin had 10+ nearly identical entity listing pages, hidden menus, dead sidebar items, and publicly accessible cron endpoints. We're building something a human can use.

## Navigation

```
Admin Console
├── Dashboard
├── Orders
│   ├── Order List (filterable, searchable)
│   └── Order Workspace (detail, tabs)
├── Contacts & Companies
│   ├── Contacts (unified — replaces 10+ legacy entity pages)
│   └── Companies
├── Documents
│   ├── Document Browser (all types, filterable)
│   └── Upload
├── Vendor Actions
│   ├── CPL Generation
│   ├── TitlePoint Requests
│   └── Retry Failed Actions
├── Jobs & Logs
│   ├── Recent Jobs
│   ├── Failed Jobs
│   ├── Vendor API Logs
│   └── Admin Activity Logs
├── Settings
│   ├── Branches
│   ├── Feature Flags
│   ├── Notification Templates
│   └── Provider Mappings
└── Users & Roles
    ├── Users
    └── Roles
```

## Dashboard
**What it shows (operational awareness only — not reporting):**
- Sync health: last successful SoftPro sync timestamp + any recent failures
- Failed jobs count with link to failed jobs view
- Pending vendor actions (CPLs requested but not completed, TitlePoint polls pending)
- Document pipeline errors (failed S3 uploads, failed SoftPro attaches)
- Quick counts: open orders, orders synced today, orders closed today

**What it does NOT show:** Revenue, commissions, production metrics, rankings. Those are out of scope.

## Orders Area

### Order List
- **Columns:** File #, Address, Status, Type, Sales Rep, Title Officer, Branch, Opened, Closed
- **Filters:** Status dropdown, branch dropdown, sales rep, title officer, date range, free-text search
- **Search:** Matches file_number, address, party names, company names
- **Pagination:** Server-side, 25 per page
- **Actions:** Click row → Order Workspace. "Resync" button on individual orders.
- **Bulk:** "Sync Recent Orders" button (triggers the sync job)

### Order Workspace
Tabbed layout replacing the legacy order detail page:

| Tab | Contents |
|-----|----------|
| **Overview** | File number, status badge, key dates (opened, completed, closed), branch, transaction type, sales price/loan amount |
| **Parties** | All parties: sales rep, title officer, escrow officer, buyer agent, listing agent, lender, with contact details |
| **Property** | Address, APN, county, legal description, CPL address overrides |
| **Documents** | Documents tab (see §06-documents.md) |
| **Vendor Actions** | CPL generation controls, TitlePoint request status (see §07-vendor-actions.md) |
| **History** | Status change timeline with source (SoftPro sync vs manual), timestamps |
| **Logs** | Vendor API logs filtered to this order |

**Actions on Order Workspace:**
- Resync from SoftPro (re-fetch this specific order)
- Edit party assignments (if admin)
- Upload document
- Generate CPL
- Create TitlePoint request

## Contacts & Companies

### Contacts (replaces 10+ legacy pages)
The legacy system had separate pages for: Agents, Escrow, Lenders, Mortgage Brokers, New Users, Escrow Officers, Title Officers, Sales Reps — all querying the same `pct_softpro_lookup_table` with different boolean filters.

**vNext:** One Contacts page with a **role filter dropdown**.

- **Columns:** Name, Company, Email, Phone, Role(s), Source, Status
- **Filters:** Role dropdown (Sales Rep, Title Officer, Escrow Officer, Agent, Lender, Mortgage Broker, etc.), search, active/inactive
- **Actions:** View detail, edit (if admin), sync from SoftPro
- **Source indicator:** Shows whether contact was synced from SoftPro or manually created

### Companies
- **Columns:** Name, Type, Lookup Code, City, State, Status
- **Filters:** Type dropdown, search, active/inactive
- **Actions:** View detail, edit, view linked contacts

## Documents
- **Document Browser:** All documents across all orders, filterable by type (CPL, prelim, policy, LV, grant deed, tax, general), date range, file number
- **Upload:** Drag-and-drop to a specific order, with category selection
- **Each row:** Filename, order (linked), category, uploaded by, date, size, actions (view, download, retry SoftPro attach)

## Vendor Actions
- **CPL Generation:** Select order → select underwriter → select branch → generate. Shows status and result.
- **TitlePoint:** Select order → initiate search → shows polling status → download results when ready.
- **Retry Failed:** List of failed vendor actions with retry button.
- **All vendor actions log to `vendor_api_logs`** and show in Jobs & Logs.

## Jobs & Logs
- **Recent Jobs:** Table of all jobs with type, status, order (linked), started, completed, duration
- **Failed Jobs:** Filtered view showing only failed/retrying jobs with error message and retry button
- **Vendor API Logs:** Searchable by vendor, operation, order, date. Shows request/response metadata (sanitized).
- **Admin Activity Logs:** Who did what, when (Super Admin only)

## Settings
- **Branches:** CRUD for PCT branches (GLT, OCT, ONT, PRV, TSG)
- **Feature Flags:** Toggle features on/off (e.g., enable/disable specific webhook receivers)
- **Notification Templates:** View/edit email templates for order events
- **Provider Mappings:** Map underwriter branches, SoftPro task codes, etc.

## Users & Roles
- **Users:** List of system users with role, branch, status. Invite new user, disable existing.
- **Roles:** CRUD for roles. Minimum set: Super Admin, Admin, CS Admin, Sales Rep, Title Officer, Escrow Officer, Client.
- **Branch scoping:** Assign users to branches for scoped visibility.

## Role Permissions (vNext)

| Capability | Super Admin | Admin | CS Admin | Staff (SR/TO/EO) | Client |
|-----------|:-----------:|:-----:|:--------:|:-----------------:|:------:|
| Full admin console | ✓ | ✓ | limited | — | — |
| Order list (all) | ✓ | ✓ | ✓ | — | — |
| Order list (own) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Order detail | ✓ | ✓ | ✓ | ✓ (own) | ✓ (own) |
| Edit parties | ✓ | ✓ | — | — | — |
| Generate CPL | ✓ | ✓ | ✓ | ✓ | — |
| Upload documents | ✓ | ✓ | ✓ | ✓ | limited |
| Manage contacts | ✓ | ✓ | — | — | — |
| Manage users/roles | ✓ | — | — | — | — |
| View logs | ✓ | ✓ | — | — | — |
| Manage settings | ✓ | ✓ | — | — | — |
| Trigger sync jobs | ✓ | ✓ | — | — | — |

## What Changed from Legacy

| Legacy | vNext | Why |
|--------|-------|-----|
| 10+ entity listing pages (sp_agents, sp_escrows, sp_lenders...) | 1 Contacts page with role filter | They all query the same table with different boolean flags |
| "Clients" + "SoftPro Clients" + "PCT Users" + "SoftPro PCT Users" (4 sections) | 2 sections: Contacts & Companies, Users & Roles | Legacy had 4 overlapping sections due to migration history |
| 236 PHP views | ~20 React pages | Consolidation, not feature removal |
| Public cron endpoints | Authenticated job endpoints only | Security |
| Home.php (9,940 lines, 180 methods) | Domain services + API routes + UI components | No god files |
| Session-only auth, no CSRF | Supabase Auth + JWT + server-side validation | Security |

## Canon References
- `legacy-admin-extraction.md` — Full admin module audit (the "before" picture)
- `legacy-admin-extraction.md` §2 — Menu structure we're replacing
- `legacy-admin-extraction.md` §3 — Role/permission model we're cleaning up
- `legacy-admin-extraction.md` §5 — All 50+ admin screens inventory
- `legacy-admin-extraction.md` §6 — Danger buttons we need to secure
- `lean_transaction_desk_hub_plan.md` §5.4, §12
