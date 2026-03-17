# Open Order Form — UX Overhaul Ticket

> **Priority:** High
> **Owner:** UI Builder (lead) + Builder (API endpoints) + Gopher (wiring)
> **Target:** `/(hub)/hub/` Quick Entry form used by Open Order Team
> **Reference:** Legacy form spec (views/order/home.php, master_order.php), SiteX integration guide, SoftPro create order API

---

## Context

The Open Order Team uses Quick Entry as their primary workflow — this is where 95% of orders originate. The current vNext form works but feels like a large static form. The legacy system had the same problem. We're fixing that now.

**Design principle:** This form is a speed tool. Every pixel should serve the goal of opening an order in under 60 seconds. Fields appear only when needed. Search is instant. The form flows like a conversation, not a tax return.

---

## 1. Visual: Kill Gold, Use Orange

**Remove all gold/amber accent colors from the Quick Entry form.** Replace with PCT orange `#F26B2B` for:
- Section headers and dividers
- Active/focused input borders
- Buttons (primary actions)
- Progress indicators
- Checkbox accents

The Hub already uses orange as its accent. Quick Entry should match.

---

## 2. Client Lookup — Smart Search

**Current problem:** Search works but results don't show enough context. The team searches by email and needs to immediately see who they're selecting.

### Search Behavior
- **Debounced input** (250ms) — fires search as user types
- **Search fields:** email (primary), company name (secondary), contact name (tertiary)
- **Search source:** Local contacts DB first (18K+ records), SoftPro `GetLookupTable` fallback if local returns < 3 results
- **Minimum 2 characters** before search fires

### Result Display
Each result row must show:
```
┌─────────────────────────────────────────────┐
│  Lilly Pinedo              EscrowCompany 🏷️ │
│  lp.processor@gmail.com                      │
│  C & C Financial Corp      (714) 676-6181    │
└─────────────────────────────────────────────┘
```
- **Name** (bold) + **Client Type** badge (right-aligned, colored pill)
- **Email** (second line, muted text)
- **Company Name** + **Phone** (third line)

If no results, show "No match found — enter details manually" with inline manual entry option.

### "Opening on Behalf of" Card
When a client is selected, display a summary card (not just filled form fields):

```
┌─────────────────────────────────────────────┐
│  Opening on Behalf of:                       │
│                                              │
│  Lilly Pinedo                          ✕    │
│  C & C Financial Corp                        │
│  lp.processor@gmail.com                      │
│  (714) 676-6181                              │
│  Client Type: Escrow Company                 │
│                                              │
│  [Change Client]                             │
└─────────────────────────────────────────────┘
```

The ✕ clears selection and returns to search. The card replaces the search input (progressive reveal — search disappears, card appears).

### Hidden Fields (set on selection)
- `clientLookupCode`
- `companyLookupCode`
- `customerId`
- `clientType` (drives party visibility — see Section 7)

---

## 3. Property Search — Fix Google → SiteX Pipeline

**Current bugs:**
1. Google autocomplete feels sluggish
2. Selecting an address and pressing "Search" does nothing — no SiteX API call fires
3. Property detail fields don't appear after search

### Fix: Google Places → SiteX Flow
1. User types address → Google Places Autocomplete suggests (US addresses only, `types: ["address"]`)
2. User selects suggestion → `place_changed` event fires
3. **Immediately** (no "Search" button needed) → parse address components and call SiteX:
   - `POST /api/property/search` with `{ address: streetAddress, cityStateZip: "City, ST, ZIP" }`
   - SiteX params: `addr` = street, `lastLine` = "City, ST, ZIP" (comma-separated)
4. Show loading spinner on the property section
5. On SiteX response:
   - **`success` (single match):** Auto-fill all property fields, animate section open
   - **`multi_match`:** Show selection modal with address list, user picks, then auto-fill
   - **`not_found`:** Show property fields as empty editables with "No property data found — enter manually" message
   - **`error`:** Show property fields as empty editables with "Property lookup unavailable" message

### Property Detail Fields (appear after search or manual trigger)
Two-column grid layout:

| Row | Left Column | Right Column |
|-----|-------------|--------------|
| 1 | City | State |
| 2 | Zip | County |
| 3 | Property Type | APN |
| 4 | Legal Description (full width, spanning both columns) | |

All fields are editable (SiteX data pre-fills but user can override). If SiteX returned data, show a subtle "Auto-filled from property records" label that fades after 3 seconds.

**SiteX field mapping:**
| Display Field | SiteX Path (`Feed.PropertyProfile`) |
|---------------|-------------------------------------|
| City | `SitusCity` |
| State | `SitusState` |
| Zip | `SitusZIP` (truncate to 5 digits) |
| County | `CountyName` |
| Property Type | `UseCode` → mapped to display label |
| APN | `ParcelNumberFormatted` or `ParcelNumberRaw` |
| Legal Description | `LegalBriefDescription` |
| Owner 1 | `Owner1` → Seller section |
| Owner 2 | `Owner2` → Seller section |

---

## 4. Seller Details — SiteX Enrichment + Organization Toggle

### Auto-fill from SiteX
When property search returns owner data, auto-fill:
- **Primary Owner** ← `Owner1`
- **Secondary Owner** ← `Owner2`

### Organization Toggle
- **Default:** Two fields — Primary Owner, Secondary Owner (text inputs)
- **"Is Organization" checkbox** checked → **Collapse to:**
  - Single field: **Organization Name** (full width)
  - Dropdown: **Organization Type** (required when checked)
    - Corporation
    - Limited Liability Corp
    - Limited Liability Company
    - Limited Partnership
    - Partnership
    - Trust
    - Estate
    - Other

The toggle should animate — two fields collapse into one, organization type dropdown slides in.

---

## 5. Transaction Details — Currency Formatting + Conditional Fields

### Dropdowns
| Field | Source | Required |
|-------|--------|----------|
| Sales Rep | Staff list (from profiles table, role = sales_rep) | No |
| Title Officer | Staff list (from profiles table, role = title_officer) | No |
| Escrow Officer | Staff list (from profiles table, role = escrow_officer) | Conditional (see below) |
| Product Type | `product_types` lookup table | Yes |
| Order Type | Title Only, Title & Escrow, Escrow Only | Yes |
| Transaction Type | Purchase, Refinance, Equity, Other | Yes |

### Conditional Fields (appear based on Product Type + Transaction Type)
When Product Type is Purchase-related (IDs 20, 32):
- **Sales Amount** — appears, required
- **Primary Borrower** — appears, required
- **Secondary Borrower** — appears, optional

When Product Type is Refinance-related (IDs 19, 33):
- **Loan Amount** — appears, required

When Transaction Type = Purchase:
- **Coverage Amount** — appears

### Currency Formatting
All dollar fields (`salesAmount`, `loanAmount`, `coverageAmount`) must:
- Display with `$` prefix and comma separators as user types (e.g., `$1,250,000`)
- Accept numeric input only (strip non-numeric on input)
- Store raw number (no formatting) on submit
- Use `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })` for display

### Escrow Officer Conditional
- **Order Type = "Title Only"**: Escrow Officer hidden
- **Order Type = "Title & Escrow" or "Escrow Only"**: Escrow Officer dropdown appears and is required
- Also show: Escrow Number, Loan Number fields

---

## 6. Deliverables — Email List

Cloneable email input fields (max 5). Pre-populate from the selected client's saved deliverables if available.

- Start with 1 field + "Add another" link
- Each field has a ✕ to remove
- Validate email format on blur

---

## 7. Parties — Conditional Checkboxes (Hidden by Default)

**This is the biggest UX win.** Parties are currently always visible. They should be hidden behind small, inline checkboxes that only expand when checked.

### Checkbox Bar
A horizontal row of small pill-style checkboxes:

```
[ ] Agent Details   [ ] Lender   [ ] Escrow   [ ] Escrow Officer
```

### Visibility Matrix (driven by Client Type from Section 1)

| Client Type | Agent Details | Lender | Escrow | Escrow Officer |
|-------------|:---:|:---:|:---:|:---:|
| Escrow Company | ✓ show | ✓ show | ✗ hide | Depends on Order Type |
| Lender | ✓ show | ✗ hide | ✓ show | Depends on Order Type |
| Listing Agent/Broker | ✓ show | ✓ show | ✓ show | Depends on Order Type |
| Mortgage Broker | ✓ show | ✓ show | ✓ show | Depends on Order Type |

Escrow Officer checkbox visibility + required state is driven by **Order Type**, not Client Type:
- Title Only → hidden
- Title & Escrow → visible + required
- Escrow Only → visible + required

### Party Section Fields (when expanded)

**Agent Details** — side by side columns:

| Buyer's Agent | Listing Agent |
|---------------|---------------|
| Agent Name | Agent Name |
| Agent Email | Agent Email |
| Agent Phone | Agent Phone |
| Agent Company | Agent Company |

Validation: if any field in a column is filled, all fields in that column become required. Both columns are independent.

**Lender Details:**
- Company Name, Contact Name, Email, Phone
- All required if "Add Lender" is checked

**Escrow Details:**
- Company Name, Contact Name, Email, Phone
- All required if "Add Escrow" is checked

**Escrow Officer:**
- Dropdown from staff list
- Required if Order Type = "Title & Escrow" or "Escrow Only"

Each party section should support **contact search** (same as client lookup — type email/name, see results with company context, select to auto-fill).

---

## 8. Document Upload

Keep in form. Single file upload zone:
- Label changes based on client type:
  - Non-escrow: "Upload 1003"
  - Escrow: "Upload RPA"
- Drag-and-drop zone or click to browse
- Accepted: PDF, DOC, DOCX, JPG, PNG
- Max size: 25MB
- Show filename + size after selection with ✕ to remove

---

## 9. Progressive Reveal — The UX Flow

The form should NOT show all sections at once. Instead:

### Initial State (page load)
Only visible:
1. **Client Search** input (large, centered, prominent)
2. Subtle "or enter details manually" link below

### After Client Selected
Animate in:
3. **"Opening on Behalf of"** summary card
4. **Property Search** input (Google autocomplete)

### After Property Found (or "Skip — enter manually")
Animate in:
5. **Property Details** grid (pre-filled or empty)
6. **Seller Details** (pre-filled from SiteX or empty)

### After Property + Seller Confirmed
Animate in:
7. **Transaction Details** (dropdowns + conditional fields)

### After Transaction Type Selected
Animate in:
8. **Party Checkboxes** bar (filtered by client type)
9. **Deliverables** section
10. **Document Upload** zone
11. **Submit Button**

### Animation
- Each section slides down with a gentle ease-out (200ms)
- Use `max-height` transition or Framer Motion `AnimatePresence`
- Sections should have a thin orange left-border accent as they appear
- A subtle floating progress indicator (top-right or sticky) showing: "Step 2 of 5" or similar

### Skip / Manual Override
Every section should have a "Skip" or "Enter manually" escape hatch so the form never blocks the user. If they skip property search, the property fields appear empty and editable.

---

## 10. Submit Flow

1. Client-side validation (required fields based on current state)
2. Format payload to match SoftPro `create` API shape:
   ```json
   {
     "personalDetails": { ... },
     "propertyDetails": { ... },
     "transactionDetails": { ... },
     "sellerDetails": { ... },
     "lenderDetails": { ... },
     "escrowDetails": { ... },
     "listingAgentDetails": { ... },
     "buyerAgentDetails": { ... }
   }
   ```
3. `POST /api/orders` → creates in local DB + pushes to SoftPro
4. On success → redirect to order detail page with confirmation toast
5. On error → inline error messages, don't lose form state

### Duplicate Check
Before submit, check APN against existing orders. If duplicate found, show warning modal: "An order with this APN already exists (File #20003483-GLT). Continue anyway?"

---

## 11. Validation Summary

### Always Required
- Client selection (or manual: first name, last name, email)
- Transaction Type
- Order Type
- Product Type

### Conditionally Required
| Field | Required When |
|-------|---------------|
| Sales Amount | Product Type = Purchase (20, 32) |
| Primary Borrower | Product Type = Purchase (20, 32) |
| Loan Amount | Product Type = Refinance (19, 33) |
| Escrow Officer | Order Type = Title & Escrow (2) or Escrow Only (3) |
| Organization Type | "Is Organization" checked |
| Lender fields (all 4) | "Add Lender" checkbox checked |
| Agent fields (per column) | Any field in that column is filled |

---

## API Endpoints Needed

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/contacts/search` | GET | Debounced contact search (email, name, company) | Exists — verify returns company + client type |
| `/api/softpro/lookup` | GET | SoftPro GetLookupTable fallback | May need to be built |
| `/api/property/search` | POST | SiteX property lookup | Exists — verify event wiring |
| `/api/orders` | POST | Create order (local + SoftPro) | Exists |
| `/api/orders/check-duplicate` | POST | APN duplicate check | May need to be built |
| `/api/staff/list` | GET | Sales reps, title officers, escrow officers | Verify exists |

---

## Acceptance Criteria

1. ✅ No gold anywhere in Quick Entry — all orange
2. ✅ Client search shows name + company + client type + phone in results within 300ms of typing
3. ✅ SoftPro fallback fires if local search returns < 3 results
4. ✅ Google Places selection immediately triggers SiteX call (no manual "Search" button needed)
5. ✅ Property details appear in 2-column grid: City/State, Zip/County, Type/APN, Legal Desc
6. ✅ Seller fields auto-fill from SiteX owner data
7. ✅ Organization checkbox collapses 2 name fields into 1 + org type dropdown
8. ✅ All $ fields show live currency formatting with commas
9. ✅ Party checkboxes hidden by default, visibility follows client type matrix
10. ✅ Form uses progressive reveal — sections animate in as prior sections complete
11. ✅ Every section has a "skip/manual" escape hatch
12. ✅ Document upload works (drag-drop, file picker, size/type validation)
13. ✅ Duplicate APN check fires before submit
14. ✅ Successful submit creates order in local DB + SoftPro, redirects to order detail
15. ✅ No form state lost on validation error
