# TD Hub — two-day sprint synopsis & SoftPro payload

**This repo:** `td-hub` — paths below are under `src/`.  
**Mirror:** `TransactionDeskClone/docs/HUB_ORDER_FLOW_AND_PAYLOAD_REFERENCE.md` (keep in sync).

---

## 1. Synopsis — two-day sprint

### Migration and deployment

- Generated and tracked migration **`0005_modern_maelstrom`** for `title_point_data` schema changes (nullable `orderId`, `sessionId` column, index). Manually inserted hash into `drizzle.__drizzle_migrations` because changes were already in production.
- Pushed **Hub Overhaul** commit to `origin/main` — UI changes (70/30 layout, summary panel, 2×2 grid, checkbox parties) were **local-only and not deployed**.
- Deleted dead **`SiteXConfirmModal.tsx`** (form uses **`PropertyConfirmModal`** instead).

### SiteX integration fixes

- Fixed property search returning **“not found”** — SiteX UAT API has **no top-level `MatchCode`**. Added **`inferMatchCode()`** to deduce match status from response structure.
- Fixed field autofill (seller name, legal description, county, property type) — rewrote **`mapProfile`** in **`parsers.ts`** to match actual SiteX nested paths (`LegalDescriptionInfo.LegalBriefDescription`, `PropertyCharacteristics.UseCodeDescription`, `PrimaryOwnerName`, `CountyName`, etc.).
- Fixed **seller name parsing** — SiteX returns **“LAST FIRST MIDDLE”** (public records format). Previously parsed as FIRST MIDDLE LAST.
- Fixed **name placement by transaction type** — **Refinance / Equity:** SiteX owner names → **borrower** fields. **Purchase:** → **seller** fields.

### Form field alignment (tickets 32–39)

- **Product types:** Changed from 11 `snake_case` values to **9 SoftPro-canonical names**: Residential Resale, Full ALTA, Short Form, Junior Loan, Prelim, Hard Money, Shortsale, Mobile Home, Title Report.
- **Order types:** Added **Sub Escrow** and **Title Search** (5 total).
- **Sales Rep / Title Officer / Escrow Officer queries:** Switched from `roles::jsonb @>` to **boolean flag columns** (`is_sales_rep`, `is_title_officer`, `is_escrow_officer`). Added **deduplication** by `officer_name`.
- **Escrow Officer** conditional: visible only when order type is **“Title & Escrow”** or **“Escrow Only”**.
- **Underwriter auto-assignment:** **Full ALTA → CW** (Commonwealth), everything else → **WC** (Westcor). Fixed from **FNF** (not present in `companies` table).
- **Transaction conditionals:** **Purchase** shows all fields; **Refinance** hides borrower / sales amount; **Equity / Other** hide all financial fields. **Coverage auto-calc:** Full ALTA = loan × 1.25, else loan × 1.

### Confirmation page and email (tickets 40–43)

- New page **`/hub/order-confirm/[fileNumber]`** with API route, auth check, and **`OrderConfirmation`** component.
- Enhanced email template with conditional **FinCEN** section (**Purchase** only), order summary, property / tax / seller / transaction / party details.
- **Redirect** after successful order creation to confirmation page.

### SoftPro `create_order` payload restructure (Day 2 — six rounds of 422/400 debugging)

| Round | Root cause | Fix |
|-------|------------|-----|
| 1 | Product type sent as `full_alta` not **Full ALTA** | Aligned form values with SoftPro canonical strings |
| 2 | Underwriter code **FNF** missing in `companies` | **CW** (Commonwealth) for Full ALTA path |
| 3 | **SalesRep** sent as DB ID `"5"`, not lookup code | Resolve contact ID → **lookupCode** (e.g. `PCT\elasmarias`) |
| 4 | **personalDetails** empty, **UserType** `open_contact` invalid, **CompanyName** blank | Resolve opener contact + company from DB; derive **UserType** from `companies.is_escrow_company`, etc.; **CompanyName** from `companies` |
| 5 | Borrower names empty on **Refinance** (SiteX names went to seller) | Transaction-type-aware name placement |
| 6 | Empty contact sections / **IsOrganization** type mismatch | Omit sections when empty; stringify **both** `IsOrganization` fields |

### Contact resolution pipeline (`create-order.ts`)

- **`resolveContactIds()`** — batch-queries `contacts` for `salesRep`, `titleOfficer`, `escrowOfficer`, `opener` IDs in one `SELECT`.
- For **opener:** additional query resolves company via **`flookup_code` → `companies`**, then branch via **`branchId` → `branches`**.
- Returns resolved data to the payload builder (lookup codes, names, company flags, branch code).

---

## 2. Current payload structure (annotated)

Example shape as sent to SoftPro after **`buildSoftProPayload`**. Comments document field meaning, quirks, and known gaps.

```jsonc
{
  "baseDetails": {
    "OrderType": "Title only",
    // Valid: "Title only" | "Title & Escrow" | "Escrow only"
    // Zod also accepts "Sub Escrow" | "Title Search" — confirm with IT if SoftPro handles these
    "ProjectName": "PCT",
    // Always "PCT" — parent company identifier
    "IsRushOrder": false
    // Boolean from form checkbox
  },
  "personalDetails": {
    // OPENER — person placing the order. Resolved from onBehalfOfContactId → contacts
    "CompanyLookupCode": "Newpo3700",
    // opener.flookup_code → company's lookup_code
    "ClientLookupCode": "JerHerNewp",
    // opener.lookup_code
    "UserType": "EscrowCompany",
    // Derived: is_escrow_company → "EscrowCompany", is_lender → "Lender",
    // is_selling_agent → "ListingAgentBroker", is_mortgage_broker → "MortgageBroker"
    // Fallback: softpro_user_type mapping, then clientType mapping
    // IMPROVEMENT: explicit Client Type dropdown (4 SoftPro values) when flags are ambiguous
    "CompanyName": "Newport Financial Associates, Escrow Division",
    // opener.flookup_code → companies.name
    // IMPROVEMENT: if company missing via flookup, fall back to opener.companyName
    "Email": "gerardoh@gmail.com",
    "FirstName": "Jerry",
    "LastName": "Hernandez",
    "Telephone": "(949) 851-2200",
    // IMPROVEMENT: strip to digits — spec example uses "9493338788"
    "Address": "3700 Campus Drive #107",
    "City": "Newport Beach",
    "ZipCode": "92660",
    "State": "CA",
    "EmailNotifications": true,
    "SalesRep": "PCT\\ghernandez"
    // salesRep contact ID → contacts.lookup_code
    // IMPROVEMENT: validate lookup_code via SoftPro GetLookupTable before submit (fail fast)
  },
  "propertyDetails": [
    {
      "Address1": "1358 5TH ST",
      "Address2": "",
      // Unit if present
      "APNNumberParcelID": "8381-021-001",
      "Country": "LOS ANGELES",
      // County — SoftPro field name "Country" (legacy quirk)
      "Description": "TRACT NO 6654 LOT 44",
      "IsPrimaryResidence": true,
      // IMPROVEMENT: form toggle — not always primary residence
      "City": "LA VERNE",
      "Zip": "91750",
      "State": "CA",
      "EscrowBriefLegalLookupCode": null,
      "EscrowBriefLegal": "TRACT NO 6654 LOT 44"
    }
  ],
  "sellerDetails": {
    // Purchase: SiteX owners. Refinance/Equity: TBD; owners → borrower block
    "PrimaryOwnerFirstName": "TBD",
    "PrimaryOwnerMiddleName": "",
    "PrimaryOwnerLastName": "TBD",
    "SecondaryOwnerFirstName": "",
    "SecondaryOwnerMiddleName": "",
    "SecondaryOwnerLastName": "",
    "OrganizationType": "",
    // When IsOrganization="true": LLC, Corporation, Partnership, Trust, Other
    "IsOrganization": "false"
    // String "true"/"false" per sellerDetails spec
  },
  "transactionDetails": {
    "LookUpCodeTitleOffice": "PCT",
    // KNOWN GAP: should be branch code (OCT, GLT, ONT, PRV, TSG).
    // Current: company.branchCode ?? titleOfficer.officeLookupCode ?? "PCT"
    // Often null on company.branch_id and titleOfficer.office_lookup_code
    // FIX: (1) Branch dropdown on form, (2) populate office_lookup_code on contacts,
    //      (3) assign branch_id on opener companies
    "TitleOffice": "PCT\\elasmarias",
    // titleOfficer contact ID → lookup_code
    "Product": "Short Form",
    "EscrowNumber": "32434",
    "SalesAmount": 0,
    // 0 for Refinance; populated for Purchase
    "TransactionType": "Refinance",
    // "Purchase" | "Refinance" | "Equity" | "Other"
    "LoanNumber": "32234234",
    "LoanAmount": 323000,
    "UnderwriterLookUpCode": "WC",
    // "Full ALTA" → "CW", else "WC"
    "CoverageAmount": 323000,
    // Full ALTA: loan × 1.25; else loan × 1
    "PrimaryBorrowerFirstName": "GERARDO",
    // Refinance: SiteX owner (LAST FIRST MIDDLE parsed). Purchase: form borrower
    "PrimaryBorrowerMiddleName": "J",
    "PrimaryBorrowerLastName": "HERNANDEZ",
    "SecondaryBorrowerFirstName": "YESSICA",
    "SecondaryBorrowerMiddleName": "S",
    "SecondaryBorrowerLastName": "MENDOZA",
    "IsOrganization": "false",
    // String for parity; spec may show boolean — test boolean if 400s persist
    "OrganizationType": "",
    "LookUpCodeEscrowOfficer": null,
    "EscrowOfficerName": null
  }
  // CONTACT SECTIONS — only when lookup codes, email, or company name present.
  // Omitted when empty (avoids validation on half-filled parties).
  //
  // "buyersAgentDetails": { "CompanyLookUpCode", "ClientLookUpCode", ... }
  // "listingAgentDetails": { ... }
  // "escrowDetails": { ... }
  // "lenderDetails": { ... }
  // "mortgageDetails": { ... }
  //
  // IMPROVEMENT: when party checkboxes + contact search, pass companyLookupCode /
  // clientLookupCode from contacts/search API response
}
```

### Improvement backlog (not yet built)

| Priority | Item | Effort |
|----------|------|--------|
| High | Branch dropdown on form (`LookUpCodeTitleOffice`) | Small — 5 branches; form-options + form |
| High | Validate lookup codes against SoftPro before submit | Medium — pre-flight |
| Medium | Client Type dropdown (4 SoftPro `UserType`s) | Small |
| Medium | `IsPrimaryResidence` toggle | Small |
| Low | Strip phone formatting to digits | Small — regex at boundary |
| Low | Test boolean vs string `IsOrganization` in `transactionDetails` | Quick test |

---

## Related code (this repo)

| Area | Path |
|------|------|
| Zod schema & create pipeline | `src/lib/domain/orders/create-order.ts` |
| SoftPro JSON build | `src/lib/domain/orders/softpro-payload.ts` |
| SiteX parsing | `src/lib/integrations/sitex/` (e.g. `parsers.ts`) |

---

*Sprint notes consolidated from TD Hub delivery; keep this file aligned with production behavior as the form evolves.*
