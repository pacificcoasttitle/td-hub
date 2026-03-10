# 07 — Vendor Actions

## Principle
Vendor-specific quirks live inside adapters. Domain code calls a clean interface. The UI never talks to vendors directly.

## Shared Adapter Interface

```typescript
// lib/integrations/types.ts

interface VendorAdapter {
  readonly vendorName: string;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
}

interface VendorResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
  requestId?: string;
  durationMs?: number;
}
```

Every adapter wraps results in `VendorResult<T>`. Never throws raw errors.

---

## CPL Generation

### Supported Underwriters
| Underwriter | Auth | Protocol | Legacy File |
|-------------|------|----------|-------------|
| Westcor | OAuth2 (password grant) | REST/JSON | `Westcor.php` |
| FNF/Commonwealth | Two-tier JWT (vendor + user) | SOAP/XML | `Fnf.php` |
| NATIC | Plaintext in XML body | XML/HTTP | `Natic.php` |
| Doma | Same as NATIC (different env vars) | XML/HTTP | `Natic.php` |

### Shared CPL Lifecycle
```
1. User selects underwriter + branch on order
2. System builds payload from local order data (property, parties, lender)
3. System calls underwriter adapter
4. Adapter returns base64 PDF (or error)
5. Decode PDF → save to S3 as cpl_documents/{underwriter}_{fileNumber}_{count}.pdf
6. Create document record
7. Attach to SoftPro via AddDocuments
8. Update order external_refs with vendor CPL/order IDs
9. Log everything to vendor_api_logs
10. On error: store in cpl_error_logs, notify user
```

### Critical Rule: Form Selection
**Legacy bug:** Westcor CPL form was selected by hard-coded array index `[1]`. When Westcor reordered their forms, it silently generated "Multiple Transactions" CPLs instead of "Single Transaction".

**vNext rule:** Form selection MUST be by form name matching, never by position. Use `selectCplForm()` logic:
- Single mode (default): prefer name containing "Single", reject "Multiple"/"Blanket"
- Multiple mode (explicit): prefer name containing "Multiple"/"Blanket"
- If no match: **fail loudly** with available form names in error

### Westcor Adapter
```
Auth: POST /Token
  body: grant_type=password&username=X&password=Y&integrationpartner=Z
  → { access_token, expires_in, agentNumber, groups[] }
  Cache token in vendor_tokens, check expiry before each call

Create order: POST /VendorApi/Order/Update/{partnerCode}
  → Returns tvid (Westcor order ID), buyer/seller/lender IDs

PrepareAddCPL: GET /VendorApi/ClosingLetters/PrepareAddCPL/{orderId}/{partnerCode}
  → Returns CPL.Forms[] array — apply selectCplForm()

Generate CPL: POST /VendorApi/Order/Update/{partnerCode}
  (with cpl data in body after PrepareAddCPL)
  → Returns cpl[].FileInformation.FileAsBase64
```

### FNF Adapter
```
Auth tier 1 — Vendor token:
  POST /api/FnfAuthIdentityProvider/GetToken
  body: { clientId, secretKey }
  → { jwtToken, expiresAt }

Auth tier 2 — User token:
  POST /api/FnfAuthIdentityProvider/GetUserToken
  body: { jwtToken (vendor), username, password }
  → { jwtToken (user) }

Get CPL forms:
  POST /v3/CPLManagement.svc
  SOAPAction: GetCPLList
  Headers: Authorization: Bearer {vendorToken}, ClientID: {clientId}

Generate CPL:
  POST /v3/CPLManagement.svc
  SOAPAction: CreateCPL
  Body: SOAP XML with all form fields (buyer, lender, property, agent info)
  → Response XML with CPLLetters.CPLLetter.DocumentContent (base64)
```

### NATIC/Doma Adapter (Shared)
```
Auth: plaintext username + password in XML body
  IMPORTANT: password has '#' suffix (legacy: $password . "#")

Get branches:
  POST /Authorize
  → ApprovedSettlementOfficeList with UniqueId per branch
  Parse branch name: "Pacific Coast Title Company, {address}, {city}, CA {zip}"

Generate CPL:
  POST /GetDocuments
  XML body with Field elements (BuyerBorrower, LenderName, PropertyAddress, etc.)
  → DocumentCollection.DocumentList.Document.Content (base64 PDF)

Doma uses identical code with different env vars:
  DOMA_USERNAME, DOMA_PASSWORD, DOMA_COMPANY, DOMA_URL, DOMA_DOCUMENT_ID
```

---

## TitlePoint Integration

### Purpose
Property search, legal vesting documents, grant deeds, tax data.

### Auth
Username + password as query string parameters (legacy pattern).
```
TP_USERNAME, TP_PASSWORD, TP_BASE_URL, TP_IMAGE_ENDPOINT
```

### Lifecycle (runs as a job with polling)
```
1. CreateService3 — initiate property search
   GET TpsService.asmx/CreateService3?username=X&password=Y&...
   → { RequestID, OrderID, ReturnStatus }

2. GetRequestSummaries — poll for completion
   GET TpsService.asmx/GetRequestSummaries?RequestID=X
   → { Status: 'Success'|'Pending', ServiceIds[] }

3. GetResultByID3 — fetch result data
   GET TpsService.asmx/GetResultByID3?ServiceID=X
   → Result data (XML parsed to JSON)

4. Image retrieval — get document PDFs
   POST TP_IMAGE_ENDPOINT
   body: { username, password, serviceId1, fileType: 'pdf' }
   → { Data: base64, ReturnStatus, Status }

5. Decode base64 → save PDF → upload to S3 → create document record
```

### Service Types
| Type | Legacy Constant | Purpose |
|------|----------------|---------|
| Geo/Address | `TitlePoint.Geo.Address` | Property search by address |
| Legal Vesting | (via generateImg) | LV document retrieval |
| Grant Deed | (via generateGrantDeed) | Deed image by instrument number |
| Tax | (via generateTax) | Tax document retrieval |

### vNext Rule
TitlePoint runs as a visible job. User sees: request initiated → polling → result ready → documents attached. Status and errors visible in the order workspace Vendor Actions tab.

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/vendor-actions/cpl` | POST | Generate CPL |
| `GET /api/vendor-actions/cpl/branches` | GET | Get CPL branches by underwriter |
| `POST /api/vendor-actions/titlepoint` | POST | Create TitlePoint request |
| `GET /api/vendor-actions/titlepoint/[id]` | GET | Check TitlePoint request status |
| `POST /api/vendor-actions/[id]/retry` | POST | Retry failed vendor action |

## Canon References
- `cpl-underwriters.md` — Westcor, FNF, NATIC, Doma specs
- `td-source-extraction.md` §3 — All CPL underwriter source code
- `td-source-extraction.md` §4 — TitlePoint.php source code
- `titlepoint.md` — TitlePoint integration overview
- `lean_transaction_desk_hub_plan.md` §10, §11
