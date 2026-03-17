# Open Order Form Overhaul — Parallel Agent Execution Plan

> **Ticket:** Open Order Form UX Overhaul
> **Full spec:** `open-order-form-overhaul.md`
> **Execution model:** Builder + UI Builder in parallel → Gopher wires conflicts → Refactorer → Reviewer

---

## Phase Map

```
TIME ──────────────────────────────────────────────────────────►

BUILDER (Track A)        ████████████████░░░░░░░░░░░░░░░░░░░░░
  A1: Contact search API
  A2: SoftPro lookup fallback
  A3: Property search fix
  A4: Duplicate check endpoint
  A5: Staff list endpoint
  A6: Submit payload mapping

UI BUILDER (Track B)     ████████████████████████████████░░░░░░
  B1: Progressive reveal shell
  B2: Client search + card
  B3: Property section + grid
  B4: Seller + org toggle
  B5: Transaction + currency
  B6: Party checkboxes + matrix
  B7: Deliverables + upload
  B8: Kill gold → orange

GOPHER (Track C)                                 ██████████░░░░
  C1: Wire Google → SiteX pipeline
  C2: Wire contact search → SoftPro fallback
  C3: Wire submit flow end-to-end
  C4: Smoke test all conditional logic

REFACTORER (Track D)                                    ████░░░
  D1: Split any files > 300 lines
  D2: Extract shared form helpers

REVIEWER (Track E)                                          ████
  E1: Full 10-point review
```

---

## Track A — Builder

**Scope:** `lib/domain/`, `lib/integrations/`, `app/api/`
**Never touches:** `components/`, `app/(hub)/` pages, `lib/db/schema/`

### A1: Enhance Contact Search API

**File:** `app/api/contacts/search/route.ts` (modify existing)

**Current state:** Returns contacts matching a query. May not include company name or client type in response.

**Changes needed:**
- Ensure response shape includes: `id`, `firstName`, `lastName`, `email`, `phone`, `companyName`, `companyId`, `clientType`, `clientLookupCode`, `companyLookupCode`
- Search by: email (primary match), name (secondary), company name (tertiary)
- Debounce is frontend — API just needs to be fast. Add index if not present: `CREATE INDEX idx_contacts_email ON contacts(email)`
- Response capped at 10 results, ordered by relevance (exact email match first, then partial, then name/company)
- Add Zod schema for query params: `q` (string, min 2 chars)

**Acceptance:** `GET /api/contacts/search?q=lp.processor` returns results with company name, client type, phone within 200ms on 18K contacts.

---

### A2: SoftPro Lookup Fallback Endpoint

**File:** `app/api/softpro/lookup/route.ts` (new)

**Purpose:** When local contact search returns < 3 results, the frontend calls this as a fallback.

**Implementation:**
- Call SoftPro `GetLookupTable` with search term
- Map response to same shape as local contact search results
- Log to `vendor_api_logs` (vendor: `softpro`, operation: `lookup_search`)
- Wrap in `VendorResult<Contact[]>`
- Add Zod validation for query param `q`

**Acceptance:** `GET /api/softpro/lookup?q=test@email.com` returns SoftPro contacts in the same shape as `/api/contacts/search`.

---

### A3: Verify Property Search Endpoint

**File:** `app/api/property/search/route.ts` (verify existing)

**Purpose:** Confirm the SiteX property lookup endpoint works correctly.

**Checklist:**
- Accepts `{ address: string, cityStateZip: string }` in POST body
- Formats SiteX params correctly: `addr` = street, `lastLine` = "City, ST, ZIP"
- Returns structured response: `{ status, property: { city, state, zip, county, propertyType, apn, legalDescription, owner1, owner2 } }`
- Handles `success`, `multi_match`, `not_found`, `error` statuses
- Logs to `vendor_api_logs`

**Note:** The UI Builder reported that selecting an address and pressing Search does nothing. Builder should verify the API itself is sound — the Gopher will fix the frontend wiring.

---

### A4: Duplicate APN Check Endpoint

**File:** `app/api/orders/check-duplicate/route.ts` (new)

**Implementation:**
- `POST { apn: string }`
- Query orders table for matching APN
- Return `{ duplicate: boolean, existingOrder?: { id, fileNumber } }`
- Zod validation on body

---

### A5: Staff List Endpoint

**File:** `app/api/staff/list/route.ts` (verify or create)

**Purpose:** Returns staff grouped by role for dropdown population.

**Response shape:**
```json
{
  "salesReps": [{ "id": 1, "name": "John Doe" }],
  "titleOfficers": [...],
  "escrowOfficers": [...]
}
```

Query profiles table filtered by role and `is_active = true`.

---

### A6: Order Submit Payload Mapping

**File:** `lib/domain/orders/create-order.ts` (verify/modify)

**Purpose:** Ensure the create order service maps the new form payload to the SoftPro `create` API shape.

**Verify:**
- Maps `personalDetails`, `propertyDetails`, `transactionDetails`, `sellerDetails`, party details
- Handles `IsOrganization` flag + `OrganizationType`
- Handles borrower organization fields
- Currency fields strip formatting before send (raw numbers)
- Handles document upload as part of creation flow (or queues it)

---

## Track B — UI Builder

**Scope:** `app/(hub)/`, `components/hub/`, `components/shared/`
**Never touches:** `lib/domain/`, `lib/db/`, `lib/integrations/`, `app/api/`

### B1: Progressive Reveal Shell

**File:** `app/(hub)/hub/quick-entry/page.tsx` (overhaul) + new component files

**Build the container that controls section visibility:**
- State machine: `currentStep` tracks which sections are visible
- Steps: `client` → `property` → `seller` → `transaction` → `parties` → `submit`
- Each section wrapped in an animated container (Tailwind + `max-height` transition or CSS `grid-template-rows: 0fr → 1fr`)
- "Skip" link on every section advances to next step
- Floating progress indicator (top-right sticky): "Step 2 of 5" style
- Thin orange `#F26B2B` left-border accent on each section as it appears

**Initial state:** Only client search input visible, large and centered.

---

### B2: Client Search + Selection Card

**Files:**
- `components/hub/client-search.tsx` (new)
- `components/hub/client-card.tsx` (new)

**Client Search:**
- Large input with search icon, placeholder "Search by email, name, or company..."
- Debounced (250ms) — calls `GET /api/contacts/search?q=...`
- If results < 3, also calls `GET /api/softpro/lookup?q=...` and merges (dedupe by email)
- Result dropdown shows per row:
  - **Name** (bold) + **Client Type** pill badge (right-aligned)
  - Email (muted)
  - Company Name + Phone
- "No match — enter details manually" option at bottom of results
- Minimum 2 characters before firing

**Client Card (after selection):**
- Replaces search input (animate: search fades, card slides in)
- Shows: Name, Company, Email, Phone, Client Type badge
- ✕ button to clear and return to search
- "Change Client" link
- Sets hidden state: `clientLookupCode`, `companyLookupCode`, `customerId`, `clientType`
- **On selection, advance `currentStep` to `property`**

---

### B3: Property Section + Detail Grid

**Files:**
- `components/hub/property-search.tsx` (overhaul existing)
- `components/hub/property-details-grid.tsx` (new)

**Property Search:**
- Google Places Autocomplete input (US addresses, `types: ["address"]`)
- On `place_changed` → immediately call `POST /api/property/search` (NO separate "Search" button)
- Show loading skeleton on property detail grid while waiting
- Handle: `success` (auto-fill), `multi_match` (selection modal), `not_found` (empty editable fields), `error` (empty with message)

**Property Details Grid (appears after search or "enter manually"):**
- 2-column layout:

| Left | Right |
|------|-------|
| City (input) | State (input) |
| Zip (input) | County (input) |
| Property Type (input) | APN (input) |
| Legal Description (textarea, full width span) | |

- All fields editable (SiteX pre-fills, user can override)
- Subtle "Auto-filled from property records" fade label if SiteX returned data
- **On confirm or skip, advance to `seller`**

---

### B4: Seller Details + Organization Toggle

**File:** `components/hub/seller-details.tsx` (new)

**Default state:** Two text inputs — Primary Owner, Secondary Owner (pre-filled from SiteX `Owner1`, `Owner2`)

**Organization toggle:**
- Checkbox: "Is Organization"
- When checked: animate collapse of 2 fields → 1 "Organization Name" input + "Organization Type" dropdown
- Organization Type options: Corporation, LLC, Limited Liability Company, Limited Partnership, Partnership, Trust, Estate, Other
- When unchecked: reverse animation, restore 2 name fields

---

### B5: Transaction Details + Currency Formatting

**File:** `components/hub/transaction-details.tsx` (new)

**Dropdowns:**
- Sales Rep (from `/api/staff/list` → `salesReps`)
- Title Officer (from `/api/staff/list` → `titleOfficers`)
- Product Type (from lookup or hardcoded list with IDs)
- Order Type: Title Only (1), Title & Escrow (2), Escrow Only (3)
- Transaction Type: Purchase, Refinance, Equity, Other

**Conditional fields (animate in based on selection):**
- Purchase (Product IDs 20, 32) → Sales Amount, Primary Borrower, Secondary Borrower
- Refinance (Product IDs 19, 33) → Loan Amount
- Purchase transaction → Coverage Amount

**Currency formatting on $ fields:**
- Format as user types: `$1,250,000`
- Strip non-numeric on input
- Use `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`
- Store raw number in form state

**Escrow Officer conditional:**
- Order Type = Title & Escrow or Escrow Only → show Escrow Officer dropdown (required) + Escrow Number + Loan Number fields
- Title Only → hide all three

---

### B6: Party Checkboxes + Visibility Matrix

**File:** `components/hub/party-section.tsx` (new)

**Checkbox bar:** Horizontal row of pill-style checkboxes:
```
[ ] Agent Details   [ ] Lender   [ ] Escrow   [ ] Escrow Officer
```

**Visibility matrix (driven by `clientType` state from B2):**

| Client Type | Agent | Lender | Escrow | Escrow Officer |
|-------------|:---:|:---:|:---:|:---:|
| EscrowCompany | show | show | hide | Order Type driven |
| Lender | show | hide | show | Order Type driven |
| ListingAgentBroker | show | show | show | Order Type driven |
| MortgageBroker | show | show | show | Order Type driven |

Escrow Officer: visible + required only when Order Type = 2 or 3 (from B5 state).

**Expanded sections (when checkbox checked, animate slide-down):**

- **Agent Details:** Side-by-side columns (Buyer's Agent / Listing Agent). Each has: Name, Email, Phone, Company. Each field in a column has contact search (same as client search but smaller). Validation: if any field in a column is filled, all 4 in that column are required.
- **Lender:** Company Name, Contact Name, Email, Phone. All required when checked.
- **Escrow:** Company Name, Contact Name, Email, Phone. All required when checked.
- **Escrow Officer:** Dropdown from `/api/staff/list` → `escrowOfficers`.

---

### B7: Deliverables + Document Upload

**File:** `components/hub/deliverables-upload.tsx` (new)

**Deliverables:**
- Start with 1 email input + "Add another" link (max 5)
- ✕ button on each to remove
- Email format validation on blur
- Pre-populate from selected client's saved deliverables if available

**Document Upload:**
- Drag-and-drop zone OR click to browse
- Label: Non-escrow → "Upload 1003" / Escrow → "Upload RPA" (driven by `clientType`)
- Accepted: PDF, DOC, DOCX, JPG, PNG
- Max: 25MB
- Show filename + size + ✕ after selection

---

### B8: Kill Gold → Orange

**Scope:** All files under `app/(hub)/hub/quick-entry/` and new components from B1–B7

- Replace any gold/amber `#C5A55A` references with orange `#F26B2B`
- Active/focused input borders → orange
- Primary action buttons → orange background
- Section accent borders → orange
- Checkbox accent → orange
- Progress indicator → orange

**Note:** This applies ONLY to the Quick Entry form. The admin sidebar and other admin pages keep their existing navy/gold scheme.

---

## Track C — Gopher

**Scope:** Any file — fix conflicts, wire integrations, debug
**Runs after:** Builder (A1–A5) and UI Builder (B1–B7) have committed their work

### C1: Wire Google → SiteX Pipeline

**The main bug.** Debug why selecting a Google Places result doesn't trigger the SiteX API call.

**Likely issues:**
1. `place_changed` event listener not bound to the autocomplete instance
2. Parsed address not being passed to the SiteX fetch call
3. SiteX endpoint URL mismatch (UAT vs production)
4. The "Search" button had an `onClick` handler but the auto-trigger on selection was never wired

**Fix:** Ensure `place_changed` → `parseAddressComponents()` → `POST /api/property/search` fires automatically. Remove or repurpose the manual "Search" button (could become "Search Again" for re-tries).

**Test:** Type "660 W Vernon Ave, Los Angeles" → select suggestion → SiteX call fires → property grid populates with APN, county, legal description, owner data.

---

### C2: Wire Contact Search → SoftPro Fallback

**Connect B2 (client search component) to A2 (SoftPro lookup endpoint).**

Logic:
1. Frontend calls `/api/contacts/search?q=...`
2. If results < 3 → also call `/api/softpro/lookup?q=...`
3. Merge results, dedupe by email
4. Display combined results in dropdown

Ensure both endpoints return the same shape so the UI doesn't need branching logic.

---

### C3: Wire Submit Flow End-to-End

**Connect the form submit handler to the order creation pipeline.**

1. Collect all form state from B1–B7 components
2. Strip currency formatting from dollar fields
3. Map to SoftPro create payload shape (verify with A6)
4. Call duplicate check (A4) first — show warning modal if duplicate
5. On confirm → `POST /api/orders`
6. On success → redirect to `/hub/orders/[id]` with success toast
7. On error → show inline errors, preserve all form state

---

### C4: Smoke Test All Conditional Logic

Test matrix:

| Test | Steps | Expected |
|------|-------|----------|
| Escrow client opens order | Select escrow client → check parties | Agent + Lender visible, Escrow hidden |
| Lender client opens order | Select lender client → check parties | Agent + Escrow visible, Lender hidden |
| Purchase product type | Select Purchase → check fields | Sales Amount + Primary Borrower appear |
| Refinance product type | Select Refinance → check fields | Loan Amount appears |
| Title & Escrow order type | Select T&E → check escrow officer | Escrow Officer dropdown appears, required |
| Organization seller | Check "Is Organization" | 2 fields collapse to 1 + org type dropdown |
| Skip property search | Click "Skip" on property section | Empty editable fields appear |
| Currency formatting | Type 1250000 in Sales Amount | Displays as $1,250,000 |
| Duplicate APN | Submit order with existing APN | Warning modal appears |

---

## Track D — Refactorer

**Runs after:** Gopher finishes (C1–C4)

### D1: Split Oversized Files
Check all new/modified files. Any over 300 lines gets split. Likely candidates:
- The Quick Entry page itself (if B1 grew too large)
- The party section (B6 has a lot of conditional logic)
- The transaction details (B5 has conditional fields + currency logic)

### D2: Extract Shared Form Helpers
Look for repeated patterns across B2–B7:
- Contact search hook (used in B2 and B6 party sections) → extract `useContactSearch()` hook
- Currency formatting → extract `useCurrencyInput()` hook
- Animated section reveal → extract `<RevealSection>` wrapper component
- Client type visibility matrix → extract `getPartyVisibility(clientType)` utility

---

## Track E — Reviewer

**Runs after:** Refactorer finishes (D1–D2)

### E1: Full 10-Point Checklist

Standard review against the ticket's 15 acceptance criteria plus:
- No gold colors anywhere in Quick Entry
- All API routes have Zod validation
- SiteX calls log to vendor_api_logs
- SoftPro lookup calls log to vendor_api_logs
- No files over 300 lines
- No `any` types
- Auth required on all endpoints
- Currency fields store raw numbers (not formatted strings)
- Progressive reveal doesn't break if user navigates with back button

---

## Handoff Sequence

```
STEP 1 — Director (you) gives this plan to Jerry for approval

STEP 2 — Fire in parallel:
         → Give Track A (A1–A6) to Builder agent in Cursor
         → Give Track B (B1–B8) to UI Builder agent in Cursor

STEP 3 — Both commit. Fire:
         → Give Track C (C1–C4) to Gopher agent in Cursor

STEP 4 — Gopher commits. Fire:
         → Give Track D (D1–D2) to Refactorer agent in Cursor

STEP 5 — Refactorer commits. Fire:
         → Give Track E (E1) to Reviewer agent in Cursor

STEP 6 — Reviewer returns PASS → merge to main → auto-deploy to Vercel
         Reviewer returns BLOCK → route issues back to Builder/UI Builder → re-review
```

---

## Agent Prompt Snippets

### For Builder (paste into Cursor Composer)

```
Read /docs/playbook/open-order-form-overhaul.md for the full spec.

Your track: A1–A6 (backend API endpoints only).

Build these in order:
1. A1: Enhance /api/contacts/search — add company name, client type, phone to response. Ensure email-first search across 18K contacts is fast (<200ms). Add Zod schema.
2. A2: New /api/softpro/lookup — call GetLookupTable, return same shape as contact search. Log to vendor_api_logs.
3. A3: Verify /api/property/search — confirm SiteX integration works. Check addr/lastLine formatting. Confirm response shape has city, state, zip, county, propertyType, apn, legalDescription, owner1, owner2.
4. A4: New /api/orders/check-duplicate — POST { apn }, query orders table, return { duplicate, existingOrder }.
5. A5: Verify or create /api/staff/list — return salesReps, titleOfficers, escrowOfficers from profiles table.
6. A6: Verify create-order service maps new form shape to SoftPro create API.

Do NOT touch any component files or page files. Those belong to the UI Builder.
```

### For UI Builder (paste into Cursor Composer)

```
Read /docs/playbook/open-order-form-overhaul.md for the full spec.

Your track: B1–B8 (frontend components and page only).

Build the Quick Entry form overhaul at app/(hub)/hub/quick-entry/page.tsx:
1. B1: Progressive reveal shell — state machine controlling section visibility. Steps: client → property → seller → transaction → parties → submit. Animated transitions. Skip links on every section.
2. B2: Client search + selection card. Debounced search calling /api/contacts/search. Rich result rows (name, company, email, phone, client type badge). Selection card replaces search.
3. B3: Property search (Google Places) + detail grid. On place_changed → call /api/property/search. 2-column grid: City/State, Zip/County, Type/APN, Legal Desc.
4. B4: Seller details with organization toggle. 2 fields → 1 field + org type dropdown on checkbox.
5. B5: Transaction details with currency formatting. Conditional fields based on Product Type + Order Type. Use Intl.NumberFormat for $ fields.
6. B6: Party checkboxes. Hidden by default. Visibility matrix driven by client type. Contact search in party fields.
7. B7: Deliverables (cloneable emails, max 5) + document upload (drag-drop, type/size validation).
8. B8: Replace ALL gold/amber with orange #F26B2B in Quick Entry.

Brand: Orange #F26B2B for accents. Navy #1B2A4A for text headers. Background #F8F9FA. Cards white with shadow-sm.

Do NOT touch any files in lib/, app/api/, or lib/db/. Those belong to the Builder.
API endpoints you'll call: /api/contacts/search, /api/softpro/lookup, /api/property/search, /api/orders/check-duplicate, /api/staff/list, /api/orders (POST).
```

### For Gopher (paste into Cursor after A + B commit)

```
Read /docs/playbook/open-order-form-overhaul.md for the full spec.

Your track: C1–C4 (wiring and debugging).

1. C1: FIX the Google Places → SiteX pipeline. Selecting an address from Google autocomplete must immediately trigger POST /api/property/search with the parsed address. Debug why this isn't firing. Check the place_changed event binding and the fetch call. Test with "660 W Vernon Ave, Los Angeles".
2. C2: Wire the SoftPro fallback — if /api/contacts/search returns < 3 results, also call /api/softpro/lookup and merge results.
3. C3: Wire the full submit flow: form state → strip currency → duplicate check → POST /api/orders → redirect on success.
4. C4: Smoke test every conditional path (see test matrix in execution plan).
```
