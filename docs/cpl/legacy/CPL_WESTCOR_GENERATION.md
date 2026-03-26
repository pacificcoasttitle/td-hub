# Westcor CPL Generation — Exact Implementation & Issue Log

**Last updated:** 2026-03-26  
**Status:** Fully operational. All steps (A through D) succeed. PDF generated, uploaded to S3, downloadable.  
**Source of truth:** This document reflects the actual code in `src/lib/integrations/cpl/westcor/`.

---

## 1. Architecture overview

```
User clicks "Generate CPL" in CplModal
  ↓
POST /api/vendor-actions/cpl
  ↓ (Zod validates, maps flat fields → lenderOverrides + propertyOverrides)
generateCpl() in src/lib/domain/cpl/service.ts
  ↓ (loads order from DB, merges modal overrides, selects adapter)
westcorAdapter.generateCpl() in src/lib/integrations/cpl/westcor/client.ts
  ↓
  Step 0: getToken()          → OAuth2 password grant → Bearer token
  Step A: createOrUpdateOrder() → POST Order/Update/{partner} → tvid
  Step B: getOrder()           → GET Order/{tvid}/{partner} → full order JSON
  Step C: prepareAddCpl()      → GET ClosingLetters/PrepareAddCPL/{tvid}/{partner} → CPL template + forms
  Step D: generateCplPdf()     → POST Order/Update/{partner} (merged body) → PDF base64
  ↓
Service uploads PDF to S3, stores vendor refs, attaches to SoftPro
```

---

## 2. Environment variables

| Variable | Value (production) | Purpose |
|----------|-------------------|---------|
| `WESTCOR_URL` | `https://services.ewestcor.com/` | Base URL for all Westcor API calls |
| `WESTCOR_USERNAME` | `PacificCTProdInt` | OAuth username |
| `WESTCOR_PASSWORD` | *(set in Vercel)* | OAuth password |
| `WESTCOR_INTEGRATION_PARTNER` | `7758` | Partner code — used in URL paths and as `partnerCode` in payloads |

If `WESTCOR_URL` is unset, the adapter returns a mock CPL (no network calls).

---

## 3. Authentication — Step 0

**File:** `src/lib/integrations/cpl/westcor/auth.ts`  
**Endpoint:** `POST {WESTCOR_URL}Token`  
**Content-Type:** `application/x-www-form-urlencoded`

```
grant_type=password
username=PacificCTProdInt
password=<password>
integrationpartner=7758
```

**Response:** `{ access_token, expires_in, groups }` — token cached in `vendor_tokens` table.  
**Timeout:** 15 seconds.  
**Token reuse:** Cached until `expires_at` minus 2-minute skew. If cache miss, fetches new token.

The `groups` field from the token response contains PCT's Westcor branch/agency list (7 entries). These are cached in `vendor_tokens.metadata` and used for the branch dropdown.

---

## 4. Step A — Create or update order

**File:** `src/lib/integrations/cpl/westcor/payloads.ts` → `createOrUpdateOrder()`  
**Endpoint:** `POST {WESTCOR_URL}VendorApi/Order/Update/7758`  
**Timeout:** 15 seconds

### Tvid handling (retry safety)

Before calling Step A, the client queries `vendor_api_logs` for a previous successful `create_order` with a stored tvid for this order. If found, that tvid is sent (update mode). If not, `tvid: 0` (create mode).

If `tvid: 0` and the agent+file combo already exists in Westcor, the API returns HTTP 500: "Agent Number - Order Number Must be Unique."

### Exact JSON body sent

```json
{
  "tvid": 0,
  "agentnumber": "CA1038",
  "agent_file_number": "20015757-GLT",
  "email_requestor": "cpl@pct.com",
  "purchase_price": 0,
  "property": [
    {
      "PropertyID": 0,
      "tvid": 0,
      "CountyName": "LOS ANGELES County",
      "ShortLegal": null,
      "StreetAddress": "1358 5TH ST",
      "City": "LA VERNE",
      "State": "CA",
      "Zip": "91750",
      "PropertyType": "R"
    }
  ],
  "buyers": [
    {
      "NameID": 0,
      "Last": "-",
      "First": "GERARDO HERNANDEZ",
      "NameType": 1,
      "JoiningPhrase": "single",
      "tvid": 0,
      "Sequence": 1,
      "City": null,
      "State": null,
      "Zip": null,
      "Address": null
    }
  ],
  "sellers": [
    {
      "NameID": 0,
      "Last": "-",
      "First": "TBD TBD",
      "NameType": 2,
      "JoiningPhrase": "single",
      "tvid": 0,
      "Sequence": 1,
      "City": null,
      "State": null,
      "Zip": null,
      "Address": null
    }
  ],
  "lenders": [
    {
      "Id": 0,
      "tvid": 0,
      "name": "<from modal lenderCompany field>",
      "city": "<from modal>",
      "state": "<from modal>",
      "zip": "<from modal>",
      "address": "<from modal>",
      "phone": null,
      "email": null,
      "countyFIPS": null,
      "assignment": "<from modal assignmentClause>",
      "mortgageType": null,
      "amount": 0,
      "loan_number": "<from modal loanNumber>",
      "vendorInternalID": null
    }
  ],
  "search": null,
  "commitment": null,
  "jacket": null,
  "sdn": null,
  "history": null,
  "notes": null,
  "messages": { "success": [], "warning": [], "error": [] },
  "actions": {
    "sdn": false,
    "update_base": true,
    "update_property": true,
    "update_lender": true,
    "update_buyers": true,
    "update_sellers": true,
    "update_attorneys": false,
    "update_cpls": false,
    "update_jacket": false,
    "update_search": false,
    "update_reinsurance": false,
    "update_priors": false
  },
  "partnerCode": 7758,
  "cpl": null,
  "priors": null
}
```

### Expected response

```json
{
  "tvid": 3719520,
  "agentnumber": "CA1038",
  "buyers": [{ "NameID": 12345 }],
  "sellers": [{ "NameID": 12346 }],
  "lenders": [{ "Id": 6789 }],
  "property": [{ "PropertyID": 99999 }],
  "messages": { "success": [...], "warning": [], "error": [] }
}
```

We extract `tvid` and store it in `vendor_api_logs.response_meta` for retry reuse.  
We also extract `lenders[0].Id`, `buyers[*].NameID`, `sellers[*].NameID` for use in Step D.

### Key field origins

| Field | Value | Source |
|-------|-------|--------|
| `agentnumber` | `CA1038` | `cpl_branches.branch_code` for selected branch |
| `agent_file_number` | Order file number | `orders.file_number` |
| `email_requestor` | `cpl@pct.com` | Hardcoded (legacy match) |
| `purchase_price` | Integer | `orders.sales_price` parsed with `parseInt` |
| `partnerCode` | `7758` (integer) | `WESTCOR_INTEGRATION_PARTNER` parsed as int |
| `actions.update_base` | `true` | Required for Westcor to assign a real tvid |
| Property fields | From modal → DB fallback | `propertyOverrides` → `order_properties` |
| Lender fields | From modal → DB fallback | `lenderOverrides` → `order_parties` where role=lender |
| Buyer `First` | Full name | `order_parties` where role=buyer, `external_name` |
| Buyer `Last` | `"-"` | Hardcoded (legacy match) |

---

## 5. Step B — Get full order

**File:** `payloads.ts` → `getOrder()`  
**Endpoint:** `GET {WESTCOR_URL}VendorApi/Order/{tvid}/7758`  
**Timeout:** 15 seconds

Returns the full Westcor order object. This is used as the **base body** for Step D (spread into the final POST). It contains all entity IDs (PropertyID, NameID, lender Id) that Westcor assigned.

If Step A's response doesn't include entity IDs (varies by Westcor behavior), we fall back to IDs from this GET response.

---

## 6. Step C — PrepareAddCPL

**File:** `payloads.ts` → `prepareAddCpl()`  
**Endpoint:** `GET {WESTCOR_URL}VendorApi/ClosingLetters/PrepareAddCPL/{tvid}/7758`  
**Timeout:** 15 seconds

### Response handling

The response contains a `CPL` object with:
- `Forms[]` — available CPL letter types (e.g., "Single Transaction CPL", "Multiple/Blanket Transaction CPL")
- `TVID` — the order tvid (should match)
- Various template fields that get spread into the Step D CPL entry

We extract:
- `forms` — mapped from `FormId`/`FormName`
- `cplTemplate` — the raw `CPL` object, used as the base for the CPL entry in Step D

### Form selection (`selectCplForm`)

- Mode `single` (default): prefer form name matching `/\bsingle\b/i` and NOT `/multiple|blanket/i`
- Mode `multiple`: prefer form name matching `/multiple|blanket/i`
- Falls back to first non-matching form, or throws with available form names

---

## 7. Step D — Generate CPL PDF

**File:** `payloads.ts` → `generateCplPdf()`  
**Endpoint:** `POST {WESTCOR_URL}VendorApi/Order/Update/7758` (same as Step A)  
**Timeout:** 30 seconds

### Body construction (legacy-exact)

The body is built by spreading the Step B GET response and overlaying our data:

```javascript
const body = {
  ...westcorOrder,            // Full GET response as base (has tvid, entity IDs, etc.)
  cpl: [cplEntry],            // Our CPL entry (see below)
  property: buildProperty(),  // Our property data (overwrites GET's)
  lenders: lenders,           // Our lenders with IDs from Step A/B
  buyers: buyers,             // Our buyers with NameIDs from Step A/B
  sellers: sellers,           // Our sellers with NameIDs from Step A/B
  actions: {
    ...existingActions,       // Preserve GET's existing action flags
    update_property: true,
    update_cpls: true,        // Key: tells Westcor to process CPL
    update_buyers: true,
    update_sellers: true,
    update_lender: true,
  },
  purchase_price: "<amount as string>",
};
```

### CPL entry structure

```javascript
const cplEntry = {
  ...cplTemplate,                          // Spread PrepareAddCPL template (has TVID, Forms, etc.)
  LetterName: "Single Transaction CPL",    // Selected form NAME (not ID)
  FileInformation: null,                   // Westcor fills this with the PDF
  CPLID: -1,                              // -1 = new CPL
  LenderID: 6789,                         // From Step A/B lenders[0].Id
  PolicyProducingAgentAddressID: "CA1038", // Branch code
  PolicyProducingAgentAddress: "1111 E. Katella Avenue, #120",
  PolicyProducingAgentCity: "Orange",
  PolicyProducingAgentState: "CA",
  PolicyProducingAgentZip: "92867",
  ProtectLender: true,
  ClosingAgentNumber: "CA1038",            // Hardcoded PCT closing agent
  IsDualCPL: false,
};
```

### Expected response

```json
{
  "cpl": [
    {
      "CPLID": 123456,
      "cplNumber": "CPL-2026-001",
      "FileInformation": {
        "FileAsBase64": "<base64 PDF>",
        "FileAsDataVaultFileID": "..."
      }
    }
  ],
  "messages": { "success": [...], "warning": [], "error": [] }
}
```

We extract the **last** CPL entry (`cpl[cpl.length - 1]`), matching legacy behavior.

---

## 8. Data flow: Modal → API → Adapter

```
CplModal (React)
  sends flat fields: lenderCompany, lenderAddress, propertyAddress, ...
    ↓
POST /api/vendor-actions/cpl (route.ts)
  Zod validates, maps flat fields:
    lenderCompany → lenderOverrides.name
    propertyAddress → propertyOverrides.address
    loanNumber → loanNumberOverride
    loanAmount → loanAmountOverride
    assignmentClause → assignmentClause
    lenderContact → lenderContactName
    ↓
generateCpl() (service.ts)
  buildOrderDetail(order, lenderOverrides, propertyOverrides)
    Property: propertyOverrides ?? DB order_properties
    Lender: lenderOverrides ?? DB order_parties (role=lender)
  After success: persistCplInputToOrder() saves data back to order
    ↓
westcorAdapter.generateCpl(input, orderDetail)
  orderDetail.property.address → buildProperty() → StreetAddress
  orderDetail.lender.name → buildLenders() → name
  input.loanNumberOverride → buildLenders() → loan_number
  input.assignmentClause → buildLenders() → assignment
```

**Critical:** If the user doesn't fill in lender company in the modal AND the order has no lender party in the DB, the lenders array is empty and Westcor crashes with a NullReferenceException. Validation now blocks this at both modal and server level.

---

## 9. Error history — March 25, 2026

| Time | Error | Root cause | Fix |
|------|-------|-----------|-----|
| 17:54–18:45 | `fetch failed` | `WESTCOR_URL` on Vercel pointed to dead host `api.westcor.com` | Updated env var to `https://services.ewestcor.com/` |
| 19:00 | HTTP 500: "Property #1: Street address is a required field" | Modal property fields silently stripped by Zod schema — only DB data used, which was all null for test order | Added `propertyOverrides` to Zod schema, types, and service |
| 19:11 | HTTP 500: "Agent Number - Order Number Must be Unique" | Step A always sent `tvid: 0` (create). Previous attempt already created the order in Westcor. | Added tvid lookup from `vendor_api_logs.response_meta` — reuses stored tvid on retry |
| 19:20 | Same uniqueness error | Tried order 48 — file `20015222-OCT` already existed in Westcor from legacy system | Used new order (50) not in Westcor |
| 19:26 | "Object reference not set to an instance of an object" | Order 50 had no lender party and no lender entered in modal → empty lenders array → `LenderID: 0` → Westcor null ref | Added lender validation (modal + server), but user may not have entered lender |
| 19:34 | Same null reference | Lender was entered (validation passed). Entity IDs from Step A response may be missing — code only used Step A IDs, not Step B GET response as fallback | Added Step B GET response as fallback for lender/buyer/seller IDs; added diagnostic logging per step |

### Resolution (March 25–26)

The null reference and EF update errors were resolved through multiple iterations:

1. **Blind CPL template spread** — Spreading the full `cplTemplate` from PrepareAddCPL sent Westcor's internal/read-only fields back, causing the null reference. Fixed by using the template as a base but overriding all legacy-required fields.
2. **Blind order response spread** — Spreading `...westcorOrder` from the GET response sent Entity Framework tracked entities back, causing "An error occurred while updating the entries." Fixed by using `westcorOrder` as the base body and overriding only the 6 mutable sections (property, buyers, sellers, lenders, cpl, actions).
3. **Missing `PolicyProducingAgentNumber`** — Westcor requires this field on the CPL entry. Added from the template or branch code.
4. **Entity TVID resolution** — Nested entity TVIDs (buyer, seller, lender, property) now resolved from Step A response with Step B GET fallback.
5. **`purchase_price` as string** — Legacy PHP sends `"350000"` not `350000`. Changed to `String(amount)`.
6. **S3 credential mismatch** — AWS credentials on Vercel were incorrect. Updated and confirmed working March 26.

**Final successful test:** March 26, 2026 — all 8 vendor_api_logs entries green (get_token through s3 get_signed_url).

---

## 10. Database tables involved

| Table | Role |
|-------|------|
| `orders` | Source for file_number, sales_price, loan_amount |
| `order_properties` | Source for property address (fallback if modal overrides empty) |
| `order_parties` | Source for buyers, sellers, lender (by role) |
| `cpl_branches` | Branch code, agency name, address for PolicyProducingAgent fields |
| `vendor_tokens` | Cached Westcor bearer token + branch groups |
| `vendor_api_logs` | Per-step logging + tvid storage in `response_meta` |
| `cpl_error_logs` | Final error per failed CPL attempt |
| `order_external_refs` | Stored vendor refs after successful CPL |

### Branch data (cpl_branches)

| id | branch_code | agency_name | address | city | state | zip |
|----|-------------|-------------|---------|------|-------|-----|
| 1 | CA1038 | Pacific Coast Title Company | 1111 E. Katella Avenue, #120 | Orange | CA | 92867 |
| 2 | CA1038.01 | Pacific Coast Title Company | 516 Burchett St. | Glendale | CA | 91203 |
| 3 | CA1038.02 | Pacific Coast Title Company | 1000 Town Center Drive, #300 | Oxnard | CA | 93036 |
| 4 | CA1038.03 | Pacific Coast Title Company | 1849 Willow Pass Road, #304 | Concord | CA | 94520 |
| 5 | CA1038.04 | Pacific Coast Title Company | 2945 Townsgate Road, #200 | Westlake Village | CA | 91361 |

---

## 11. Source file index

| File | Purpose |
|------|---------|
| `src/components/shared/action-modals/cpl-modal.tsx` | UI modal — collects lender, property, branch, sends POST |
| `src/app/api/vendor-actions/cpl/route.ts` | API route — Zod validation, maps flat fields to overrides |
| `src/lib/domain/cpl/service.ts` | Domain service — loads order, merges overrides, dispatches to adapter |
| `src/lib/integrations/cpl/types.ts` | Shared types: CplGenerateInput, CplOrderDetail, CplAdapter |
| `src/lib/integrations/cpl/westcor/client.ts` | Westcor adapter — orchestrates Steps A-D, logging, tvid lookup |
| `src/lib/integrations/cpl/westcor/payloads.ts` | Payload builders — exact JSON bodies for each Westcor API call |
| `src/lib/integrations/cpl/westcor/auth.ts` | OAuth token acquisition and caching |

---

## 12. Legacy comparison

Our implementation is modeled after `TransactionDeskClone/application/libraries/order/Westcor.php` → `generateCplDocument()`. Key differences remaining:

| Aspect | Legacy (PHP) | Current (TD Hub) | Status |
|--------|-------------|-------------------|--------|
| Field names | `StreetAddress`, `CountyName`, `NameType`, etc. | Same | Matched |
| `actions.update_base` | `true` | `true` | Matched |
| `partnerCode` | Integer at top level | Integer at top level | Matched |
| Buyer/seller name format | `Last: '-'`, `First: fullName` | Same | Matched |
| Property as array | `[{ PropertyID, tvid, ... }]` | Same | Matched |
| GET order before Step D | Yes — used as body base | Yes | Matched |
| CPL template from PrepareAddCPL | Spread into CPL entry | Same | Matched |
| `LetterName` (not form ID) | Form name string | Same | Matched |
| `CPLID: -1` for new | Yes | Yes | Matched |
| `ClosingAgentNumber: "CA1038"` | Hardcoded | Same | Matched |
| Lender ID from Step A response | `$res['lenders'][0]['Id']` | `orderResponse.lenders[0].Id` + GET fallback | Matched + improved |
| PDF from last CPL entry | `count($res['cpl']) - 1` | `cpl[cpl.length - 1]` | Matched |

---

## 13. Post-generation: data save-back

After successful CPL generation, the service persists user-entered data back to the order (COALESCE — only writes if the field is currently null):

- `orders.sales_price` ← from `salesAmountOverride`
- `orders.loan_amount` ← from `loanAmountOverride`
- `order_parties` (role=lender) ← upserts `externalCompany` and `externalName` from lender overrides

**Note:** The `orders` table has no `loan_number` column. The loan number is passed through to Westcor's lender `loan_number` field but is not persisted locally.

---

## 14. Known hardcoded values

| Value | Location | Recommendation |
|-------|----------|---------------|
| `CA1038` | `payloads.ts` → `buildCplEntry()` → `ClosingAgentNumber` | Matches legacy. Could be moved to branch data if PCT gets multiple closing agent numbers. |
| `cpl@pct.com` | `payloads.ts` → `createOrUpdateOrder()` → `email_requestor` | Matches legacy. Could be env var if requestor email changes. |
| `services.ewestcor.com` | Read from `WESTCOR_URL` env var | Correct — not hardcoded. |
| `7758` | Read from `WESTCOR_INTEGRATION_PARTNER` env var | Correct — not hardcoded. |
