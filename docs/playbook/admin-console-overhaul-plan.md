# Admin Console Overhaul — Parallel Agent Execution Plan

> **Scope:** 4 workstreams — Dashboard fixes, Orders table rework, Contacts/Companies overhaul, Sales Management wiring
> **Execution model:** Builder + UI Builder in parallel → Gopher wires → Refactorer → Reviewer

---

## Phase Map

```
TIME ──────────────────────────────────────────────────────────────────────►

BUILDER (Track A)        ████████████████████████████████░░░░░░░░░░░░░░░░░░
  A1: Contact CRUD APIs (create/update → SoftPro + local)
  A2: Company CRUD APIs (create/update → SoftPro + local)
  A3: Contact sync endpoint (GetLookupTable by type)
  A4: Orders table API (add columns: createdBy, emailStatus, dupOverride)
  A5: Duplicate override toggle API
  A6: Operations dashboard — debug 500 error
  A7: Sales Management — verify Managers Report API wiring

UI BUILDER (Track B)     ████████████████████████████████████████░░░░░░░░░░
  B1: Sidebar nav — add separate contact type items
  B2: Internal Staff pages (Title Officers, Escrow Officers, Sales Reps)
  B3: External Clients pages (Agents, Escrow, Lenders, Mortgage Brokers)
  B4: Companies page (with inline assignment dropdowns)
  B5: Contact/Company create + edit forms
  B6: Sync buttons on each listing page
  B7: Orders table — add missing columns + dup override checkbox
  B8: Operations dashboard — fix UI (pending A6 data)
  B9: Sales Management — verify leaderboard renders from Managers Report API

GOPHER (Track C)                                              ██████████░░░░
  C1: Wire contact CRUD forms → SoftPro dual-write
  C2: Wire sync buttons → GetLookupTable by type
  C3: Wire dup override checkbox → order form validation
  C4: Debug Operations dashboard 500 error end-to-end
  C5: Smoke test all CRUD flows

REFACTORER (Track D)                                                  ████░░
  D1: Split oversized files
  D2: Extract shared contact listing patterns

REVIEWER (Track E)                                                        ████
  E1: Full 10-point review
```

---

## Track A — Builder

**Scope:** `lib/domain/`, `lib/integrations/`, `app/api/`

### A1: Contact CRUD APIs

**Files:**
- `app/api/contacts/route.ts` — POST (create)
- `app/api/contacts/[id]/route.ts` — PUT (update)
- `lib/integrations/softpro/contacts.ts` — SoftPro CreateUser / UpdateUser adapter
- `lib/domain/contacts/service.ts` — domain service (verify/extend)

**Create Contact Flow (dual-write):**
1. Validate input with Zod schema:
   ```
   { firstName, lastName, email, phone, companyName, companyLookupCode,
     address, city, state, zip, userType: 'escrow' | 'lender' | 'mortgage_broker' | 'realtor',
     lookupCode (auto-generated) }
   ```
2. Generate lookup code: `generateLookupCode(firstName, lastName, companyName)` → deterministic, min 10 chars
3. Build SoftPro payload:
   ```json
   {
     "FirstName": "", "LastName": "", "Phone": "", "Email": "",
     "ClientLookupCode": "", "CompanyLookupCode": "",
     "Address1": "", "City": "", "State": "", "Zip": ""
   }
   ```
4. Call SoftPro `ordercreation/CreateUser` via adapter
5. Log to `vendor_api_logs` (vendor: `softpro`, operation: `create_user`)
6. **Only on SoftPro success** → insert into local `contacts` table with type flags:
   - `userType: 'escrow'` → `is_escrow = true`
   - `userType: 'lender'` → `is_lender = true`
   - `userType: 'mortgage_broker'` → `is_mortgage_broker = true`
   - `userType: 'realtor'` → `is_selling_agent = true`
7. Return created contact with ID

**Update Contact Flow:**
1. Validate input (same shape, plus `id`)
2. Build SoftPro payload
3. Call SoftPro `ordercreation/UpdateUser`
4. Log to `vendor_api_logs`
5. **Only on success** → update local DB
6. Return updated contact

**Acceptance:**
- `POST /api/contacts` creates in SoftPro AND local DB
- `PUT /api/contacts/123` updates in SoftPro AND local DB
- SoftPro failure → local DB untouched, error returned to frontend
- Both endpoints log to `vendor_api_logs`

---

### A2: Company CRUD APIs

**Files:**
- `app/api/companies/route.ts` — POST (create)
- `app/api/companies/[id]/route.ts` — PUT (update), PATCH (inline assignments)
- `lib/integrations/softpro/companies.ts` — SoftPro AddCompany / UpdateCompany adapter

**Create Company Flow:**
1. Validate: `{ name, email, phone, address, city, state, zip, userType, lookupCode (auto-generated) }`
2. Map `userType` to SoftPro `UserType`:
   - `escrow` → `"Escrow Company"`
   - `lender` → `"Lender"`
   - `mortgage_broker` → `"Mortgage Broker"`
   - `realtor` → `"Selling Agent/Broker"`
3. Build payload:
   ```json
   {
     "Name": "", "Phone": "", "Email": "", "LookupCode": "",
     "Address1": "", "City": "", "State": "", "Zip": "", "UserType": ""
   }
   ```
4. Call SoftPro `ordercreation/AddCompany`
5. Log to `vendor_api_logs`
6. On success → insert local `companies` table with type flags

**Update Company:** Same pattern → `ordercreation/UpdateCompany`

**PATCH (inline assignments):** For the Companies listing inline dropdowns:
- `PATCH /api/companies/[id]` with `{ salesRepId?, titleOfficerId?, loanUnderwriter?, salesUnderwriter? }`
- Updates local DB only (assignments are local metadata, not synced to SoftPro)

---

### A3: Contact Sync Endpoint

**File:** `app/api/contacts/sync/route.ts` (new)

**Purpose:** Pull full lookup table from SoftPro for a specific user type, upsert into local DB.

**Implementation:**
1. `POST /api/contacts/sync` with `{ userType: 'escrow' | 'lender' | 'mortgage_broker' | 'selling_agent' | 'escrow_officer' | 'title_officer' | 'sales_rep' }`
2. Call SoftPro `lookup/GetLookuptable?userType={type}`
3. Parse response → array of contacts
4. Upsert into local `contacts` table (match on `lookupCode`)
5. Log to `vendor_api_logs`
6. Return `{ synced: count, created: count, updated: count }`

**Auth:** Requires admin role. This replaces the 9 separate cron routes from legacy with 1 parameterized endpoint.

**Also expose as cron job:** `GET /api/jobs/sync-contacts` (with `CRON_SECRET`) that runs all types sequentially. Schedule daily.

---

### A4: Orders Table API Enhancements

**File:** `app/api/orders/route.ts` (modify existing GET)

**Add to response shape per order:**
| New Field | Source | Notes |
|-----------|--------|-------|
| `productType` | `transaction_details` or local field | Product type display name |
| `salesRepName` | JOIN to contacts/profiles on `salesRepId` | Display name |
| `createdByName` | JOIN to profiles on `createdBy` user ID | Which master user opened it |
| `emailStatus` | `email_notification` field or notification outbox | Whether confirmation email was sent |
| `dupOverride` | `dup_override` boolean on order | Whether duplicate validation is overridden |

**Schema check:** If `dup_override` doesn't exist on orders table, this requires a migration (Director approval needed). Flag it.

---

### A5: Duplicate Override Toggle API

**File:** `app/api/orders/[id]/dup-override/route.ts` (new)

**Implementation:**
- `PATCH /api/orders/[id]/dup-override` with `{ enabled: boolean }`
- Updates `dup_override` flag on the order
- When `dup_override = true` for any order with a given property address, the Open Order form's duplicate check should allow submission for that address
- Requires admin role

**Connection to Open Order form:** The duplicate check endpoint (from the other ticket, A4) should query: "Is there an existing order with this APN WHERE `dup_override = false`?" If all matching orders have `dup_override = true`, allow submission.

---

### A6: Operations Dashboard — Debug 500 Error

**File:** `app/(admin)/dashboard/page.tsx` + related API routes

**Task:** Find and fix the 500 error. Likely causes:
- API route called by the dashboard is failing (check all fetch calls)
- Missing data in DB that the dashboard expects
- Unhandled null/undefined in aggregation queries

**Deliverable:** Dashboard loads without error. If data is empty, show empty states (not errors).

---

### A7: Sales Management — Verify Managers Report API

**File:** `app/api/managers-report/route.ts` (verify existing)

**Check:**
- Endpoint calls `manager-reports.onrender.com` correctly
- Auth header `x-api-key` is set
- Response for 20 reps with revenue data is parsed and returned
- If it was working during Phase 7 build but is now broken, it's likely a Render cold start or API key issue

**Deliverable:** `GET /api/managers-report/leaderboard` returns live sales rep data.

---

## Track B — UI Builder

**Scope:** `app/(admin)/`, `components/admin/`

### B1: Sidebar Navigation — Add Contact Type Items

**File:** `components/admin/sidebar.tsx` (modify)

**Current sidebar (from handoff doc):**
```
Dashboard | Orders | Hub | Contacts | Documents | Vendor Actions | Jobs & Logs | Settings | Users
```

**New sidebar structure:**
```
Dashboard
Orders
Hub
─── Contacts ───        ← Section header, not a link
  Internal Staff
    ├── Title Officers
    ├── Escrow Officers
    └── Sales Reps
  External Clients
    ├── Agents (Realtors)
    ├── Escrow Companies
    ├── Lenders
    └── Mortgage Brokers
  Companies              ← The "big" page with assignment dropdowns
─── End Contacts ───
Documents
Vendor Actions
Jobs & Logs
Settings
Users
```

Each item is a separate route under `app/(admin)/contacts/`.

---

### B2: Internal Staff Pages

**Files:**
- `app/(admin)/contacts/title-officers/page.tsx`
- `app/(admin)/contacts/escrow-officers/page.tsx`
- `app/(admin)/contacts/sales-reps/page.tsx`

**These are internal PCT staff.** They come from the profiles table (app users) AND/OR contacts table where they have internal role flags.

**Shared columns for all three:**
| Column | Description |
|--------|-------------|
| Name | Full name |
| Email | Email address |
| Phone | Phone number |
| Lookup Code | SoftPro lookup code |
| Status | Active/Inactive badge |
| Actions | Edit button |

**Sales Reps additional columns:**
- Email Notification toggle (inline checkbox → calls API)
- Profile image (if set)

**Each page has:**
- DataTable with search, pagination (server-side)
- "Sync from SoftPro" button (top-right) → calls `/api/contacts/sync` with the appropriate type
- "Add New" button → opens create form (B5)
- Row click → opens edit form (B5)

---

### B3: External Client Pages

**Files:**
- `app/(admin)/contacts/agents/page.tsx` — Realtors / Selling Agents (`is_selling_agent = true`)
- `app/(admin)/contacts/escrow/page.tsx` — External Escrow Companies (`is_escrow = true`)
- `app/(admin)/contacts/lenders/page.tsx` — Lenders (`is_lender = true`)
- `app/(admin)/contacts/mortgage-brokers/page.tsx` — Mortgage Brokers (`is_mortgage_broker = true`)

**Shared columns:**
| Column | Description |
|--------|-------------|
| Lookup Code | SoftPro client lookup code |
| First Name | |
| Last Name | |
| Email | |
| Phone | |
| Company Name | Linked company |
| Address | Full address (city, state, zip) |
| Actions | Edit |

**Each page has:**
- DataTable with search, pagination
- "Sync from SoftPro" button
- "Add New" button → create form (B5)
- Row click → edit form (B5)

**Data source:** `GET /api/contacts?type=escrow` (or `lender`, `mortgage_broker`, `selling_agent`)
The existing contacts search API needs a `type` filter param added (Builder handles this).

---

### B4: Companies Page

**File:** `app/(admin)/contacts/companies/page.tsx`

**This is the power page.** Replicates the legacy SoftPro Companies listing with inline assignment dropdowns.

**Columns:**
| Column | Description | Editable |
|--------|-------------|----------|
| Lookup Code | Company identifier | No |
| Name | Company name | No (click for edit form) |
| Address | Full address | No |
| Sales Rep | Inline dropdown → staff list | Yes (PATCH on change) |
| Title Officer | Inline dropdown → staff list | Yes (PATCH on change) |
| Loan Underwriter | Inline dropdown (Westcor / NATIC / FNF) | Yes (PATCH on change) |
| Sales Underwriter | Inline dropdown (Westcor / NATIC / FNF) | Yes (PATCH on change) |
| Deliverables | Show count + "Edit" link → modal | Yes (modal) |
| Actions | Edit, Delete (soft) | |

**Inline dropdown behavior:**
- On change → `PATCH /api/companies/[id]` with `{ salesRepId: newValue }`
- Show subtle green flash on success
- Show red flash on error

**Sync button, Add New button, DataTable — same pattern as B2/B3.**

---

### B5: Contact + Company Create/Edit Forms

**Files:**
- `components/admin/contact-form-modal.tsx` (new — shared modal for create + edit)
- `components/admin/company-form-modal.tsx` (new)

**Contact Form Fields:**
| Field | Required | Notes |
|-------|----------|-------|
| First Name | Yes | |
| Last Name | Yes | |
| Email | Yes | Validated format |
| Phone | Yes | |
| Company | Yes | Autocomplete from companies list |
| User Type | Yes | Dropdown: Escrow, Lender, Mortgage Broker, Realtor |
| Lookup Code | Yes | Auto-generated on create, read-only on edit |
| Address | Yes | |
| City | Yes | |
| State | Yes | |
| Zip | Yes | |

**Company Form Fields:**
| Field | Required | Notes |
|-------|----------|-------|
| Name | Yes | |
| Email | No | |
| Phone | No | |
| User Type | Yes | Dropdown: Escrow, Lender, Mortgage Broker, Realtor |
| Lookup Code | Yes | Auto-generated on create, read-only on edit |
| Address | Yes | |
| City | Yes | |
| State | Yes | |
| Zip | Yes | |

**Behavior:**
- Create mode: POST to `/api/contacts` or `/api/companies` (dual-write to SoftPro + local)
- Edit mode: PUT to `/api/contacts/[id]` or `/api/companies/[id]`
- Show loading state during SoftPro call (can take 1-3 seconds)
- On success: close modal, refresh table, show success toast
- On error: show inline error from SoftPro response (don't close modal)

---

### B6: Sync Buttons

**Component:** `components/admin/sync-button.tsx` (new — reusable)

**Behavior:**
- Button text: "Sync from SoftPro"
- On click → POST `/api/contacts/sync` with `{ userType: <pageType> }`
- Show spinner + "Syncing..." during call
- On success → show toast: "Synced 247 contacts (12 new, 3 updated)"
- On error → show error toast
- Refresh table data after sync

Place this button in the top-right of every listing page (B2, B3, B4).

---

### B7: Orders Table — Add Missing Columns

**File:** `app/(admin)/orders/page.tsx` (modify)

**Current columns** (approximate): Order#, Status, File Number, Property Address, Created Date

**New columns:**
| Column | Source | Notes |
|--------|--------|-------|
| Order # | `fileNumber` | Existing |
| Property Address | `propertyAddress` | Existing |
| Product Type | New from A4 | Badge style |
| Sales Rep | New from A4 | Name |
| Created By | New from A4 | Which master user opened it |
| Email Status | New from A4 | Green ✓ if sent, gray ○ if not |
| Dup Override | New from A5 | Checkbox, inline toggle |

**Dup Override Checkbox:**
- Inline checkbox in each row
- On toggle → `PATCH /api/orders/[id]/dup-override` with `{ enabled: true/false }`
- When checked, the Open Order form allows duplicate APNs for this property address
- Show subtle confirmation toast on toggle

---

### B8: Operations Dashboard — Fix UI

**File:** `app/(admin)/dashboard/page.tsx` (modify)

**Current state:** Shows 500 error.

**After Builder (A6) fixes the API:**
- Render the dashboard with whatever data the API returns
- If data is empty or partially missing, show empty state cards (not errors)
- Cards should show: Open Orders count, Closed This Month, Pending Documents, Failed Jobs
- The specific content depends on what A6 discovers

---

### B9: Sales Management — Verify Leaderboard

**File:** `app/(admin)/dashboard/page.tsx` or `app/(admin)/sales/page.tsx` (verify)

**Current state:** Phase 7 built a Sales Manager dashboard with a real leaderboard from the Managers Report API.

**Verify:**
- The "Sales Management" tab/page loads
- Leaderboard shows 20 reps with revenue data
- Data comes from `/api/managers-report/leaderboard`
- If it's broken, it's likely a rendering issue or the API route lost its wiring

---

## Track C — Gopher

**Runs after Builder + UI Builder commit**

### C1: Wire Contact CRUD Forms → SoftPro Dual-Write

Test the full create flow:
1. Open Agents page → click "Add New"
2. Fill form → submit
3. Verify SoftPro `CreateUser` was called (check `vendor_api_logs`)
4. Verify local contact was created
5. Verify new contact appears in the listing

Test the edit flow:
1. Click existing agent → edit form opens with data
2. Change email → submit
3. Verify SoftPro `UpdateUser` was called
4. Verify local contact was updated

Test the error path:
1. Disconnect SoftPro (wrong URL) → submit create
2. Verify error shown in form
3. Verify local DB was NOT modified

Same tests for Companies.

---

### C2: Wire Sync Buttons → GetLookupTable

Test each sync button:
1. Click "Sync from SoftPro" on Agents page
2. Verify `GetLookupTable?userType=SellingAgent` was called
3. Verify contacts upserted (new ones created, existing ones updated)
4. Verify table refreshes with new data

Repeat for all 7 types: escrow, lender, mortgage_broker, selling_agent, escrow_officer, title_officer, sales_rep.

---

### C3: Wire Dup Override Checkbox → Order Form

Test the integration:
1. Create an order with APN "1234-567-890"
2. Try to create another order with same APN → should be blocked
3. Go to Orders table → check "Dup Override" on the first order
4. Try to create order with same APN again → should now be allowed
5. Uncheck override → should be blocked again

---

### C4: Debug Operations Dashboard End-to-End

Work with Builder (A6) output:
1. Verify the API route(s) that the dashboard calls
2. Check for null/undefined data handling
3. Ensure dashboard renders with empty data (empty state, not 500)
4. Ensure dashboard renders with real data

---

### C5: Smoke Test All CRUD Flows

| Test | Steps | Expected |
|------|-------|----------|
| Create Agent | Add New → fill form → submit | SoftPro CreateUser called, local row created, appears in list |
| Edit Agent | Click row → change email → save | SoftPro UpdateUser called, local row updated |
| Create Company | Add New → fill form → submit | SoftPro AddCompany called, local row created |
| Edit Company | Click row → change address → save | SoftPro UpdateCompany called, local row updated |
| Assign Sales Rep | Companies page → change dropdown | PATCH called, value persisted on refresh |
| Assign Title Officer | Companies page → change dropdown | PATCH called, value persisted |
| Sync Agents | Click Sync → wait | GetLookupTable called, count shown in toast |
| Dup Override | Check checkbox on order → verify form allows dup | Form submits successfully |
| Sales Leaderboard | Load Sales Management tab | 20 reps with revenue data displayed |

---

## Track D — Refactorer

### D1: Split Oversized Files
Likely candidates:
- Contact listing pages (B2/B3) if they share too much inline logic
- Companies page (B4) with inline dropdowns might grow large
- Contact CRUD service (A1) if create + update + generate-lookup-code all live in one file

### D2: Extract Shared Contact Listing Pattern
All 7 contact type pages share the same structure:
- DataTable with search + pagination
- Sync button
- Add New button
- Row click → edit modal

Extract a `<ContactListingPage>` wrapper component that accepts:
- `type` (filter value)
- `columns` (column config)
- `title` (page title)
- `apiEndpoint` (base URL)

This could reduce 7 pages to 7 thin config files + 1 shared component.

---

## Track E — Reviewer

### E1: Full 10-Point Checklist

Plus specific checks for this ticket:
- All SoftPro CRUD calls log to `vendor_api_logs`
- Dual-write pattern: SoftPro failure → local DB untouched
- Sync endpoint parameterized (1 endpoint, not 9)
- Inline dropdowns on Companies page persist on refresh
- Dup override checkbox state persists
- No 500 errors on any admin page
- All new API routes have Zod validation
- All new pages require admin auth

---

## Handoff Sequence

```
STEP 1 — Director gives this plan + spec for approval

STEP 2 — Fire in parallel:
         → Track A (A1–A7) to Builder
         → Track B (B1–B9) to UI Builder

STEP 3 — Both commit → Track C (C1–C5) to Gopher

STEP 4 → Track D to Refactorer

STEP 5 → Track E to Reviewer

STEP 6 → PASS → merge → deploy
```

---

## Agent Prompt Snippets

### For Builder (paste into Cursor Composer)

```
Read this ticket for full spec: Admin Console Overhaul.

Your track: A1–A7 (backend APIs only).

1. A1: Contact CRUD — POST /api/contacts (create) + PUT /api/contacts/[id] (update). Dual-write: SoftPro CreateUser/UpdateUser first, local DB second. Only write local on SoftPro success. Generate lookup codes. Log to vendor_api_logs. Zod validation.

2. A2: Company CRUD — POST /api/companies (create) + PUT /api/companies/[id] (update) + PATCH for inline assignments (salesRepId, titleOfficerId, underwriters). Dual-write for create/update. Local-only for assignments. SoftPro AddCompany/UpdateCompany.

3. A3: Contact sync — POST /api/contacts/sync with { userType }. Calls SoftPro GetLookupTable, upserts local. Also expose as daily cron job. Replaces legacy's 9 separate sync endpoints with 1 parameterized.

4. A4: Orders GET — add productType, salesRepName, createdByName, emailStatus, dupOverride to response. JOINs needed.

5. A5: Dup override toggle — PATCH /api/orders/[id]/dup-override. Connect to open order form's duplicate check.

6. A6: Debug Operations dashboard 500 error. Find failing API route, fix it. Ensure empty data = empty state, not error.

7. A7: Verify Managers Report API wiring. GET /api/managers-report/leaderboard should return live data from manager-reports.onrender.com.

Do NOT touch component files or page files.
```

### For UI Builder (paste into Cursor Composer)

```
Read this ticket for full spec: Admin Console Overhaul.

Your track: B1–B9 (frontend pages and components only).

1. B1: Sidebar — add separate nav items under a "Contacts" section header. Split into Internal Staff (Title Officers, Escrow Officers, Sales Reps) and External Clients (Agents, Escrow, Lenders, Mortgage Brokers) plus Companies.

2. B2: Internal Staff pages — 3 new pages under /contacts/. DataTable with search, pagination, Sync button, Add New button.

3. B3: External Client pages — 4 new pages. Same pattern. Filter contacts by type flag (is_escrow, is_lender, etc).

4. B4: Companies page — DataTable with inline assignment dropdowns (Sales Rep, Title Officer, Loan Underwriter, Sales Underwriter). PATCH on change. Deliverables column.

5. B5: Contact + Company create/edit form modals. Shared modal component. Create = POST, Edit = PUT. Show loading during SoftPro call. Inline errors on failure.

6. B6: Reusable Sync button component. Shows spinner + result toast.

7. B7: Orders table — add columns: Product Type, Sales Rep, Created By, Email Status, Dup Override checkbox (inline toggle).

8. B8: Operations dashboard — fix 500 error UI. Show empty states, not errors.

9. B9: Sales Management — verify leaderboard renders from Managers Report API.

API endpoints you'll call:
- GET /api/contacts?type=escrow (etc)
- POST /api/contacts + PUT /api/contacts/[id]
- POST /api/companies + PUT /api/companies/[id] + PATCH /api/companies/[id]
- POST /api/contacts/sync
- PATCH /api/orders/[id]/dup-override
- GET /api/managers-report/leaderboard

Do NOT touch lib/, app/api/, or lib/db/ files.
```

### For Gopher (paste into Cursor after A + B commit)

```
Read Admin Console Overhaul spec.

Your track: C1–C5 (wiring and testing).

1. C1: Test full contact CRUD → SoftPro dual-write. Create agent, verify SoftPro called + local created. Edit agent, verify SoftPro called + local updated. Disconnect SoftPro, verify error shown + local untouched.

2. C2: Test all 7 sync buttons. Each should call GetLookupTable with correct userType, upsert contacts, show count in toast.

3. C3: Wire dup override checkbox to open order form. Check override → form allows duplicate APN. Uncheck → form blocks.

4. C4: Debug Operations dashboard end-to-end. Find the 500 root cause with Builder output and ensure it renders.

5. C5: Run full smoke test matrix (see spec).
```

---

## Schema Note for Director

**Potential migration needed:** The `dup_override` boolean may not exist on the orders table. If it doesn't:

```sql
ALTER TABLE orders ADD COLUMN dup_override BOOLEAN DEFAULT FALSE;
```

This needs Director approval before Builder proceeds with A4/A5. Also verify that the contacts table has the type flag columns (`is_escrow`, `is_lender`, `is_selling_agent`, `is_mortgage_broker`) — if it was designed differently (e.g., a single `type` enum), the query patterns in B2/B3 need to adapt.
