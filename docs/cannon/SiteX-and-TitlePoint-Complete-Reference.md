# SiteX & Title Point — Complete Reference

This document covers everything about the two property data integrations used across our projects: **SiteX (BKI)** for property lookups and **Title Point (First American)** for title searches, tax data, legal vesting, and grant deeds.

---

## Table of Contents

1. [SiteX (BKI) — Property Data](#sitex-bki--property-data)
   - [What It Does](#what-sitex-does)
   - [How It Works](#how-sitex-works)
   - [Credentials & Environment Variables](#sitex-credentials--environment-variables)
   - [API Endpoints & Parameters](#sitex-api-endpoints--parameters)
   - [Critical Gotchas](#sitex-critical-gotchas)
   - [Backend Setup](#sitex-backend-setup)
   - [Frontend Setup](#sitex-frontend-setup)
   - [Match Handling](#sitex-match-handling)
   - [Caching](#sitex-caching)
   - [Troubleshooting](#sitex-troubleshooting)
2. [Title Point (First American) — Title Searches](#title-point-first-american--title-searches)
   - [What It Does](#what-title-point-does)
   - [How It Works](#how-title-point-works)
   - [Credentials & Environment Variables](#title-point-credentials--environment-variables)
   - [API Endpoints Reference](#title-point-api-endpoints-reference)
   - [Service Types](#title-point-service-types)
   - [Full Order Flow](#title-point-full-order-flow)
   - [Data Retrieved](#title-point-data-retrieved)
   - [TypeScript Tax Integration Module](#title-point-typescript-tax-integration)
   - [Database & Storage](#title-point-database--storage)
   - [Configuration Flags](#title-point-configuration-flags)
   - [Troubleshooting](#title-point-troubleshooting)

---

# SiteX (BKI) — Property Data

## What SiteX Does

SiteX is a BKI (Black Knight / ICE) API that provides **property data lookups by address**. Given a street address, it returns:

- APN (Assessor Parcel Number)
- Owner name(s)
- Mailing address
- Legal description
- County name
- Property type
- Bedrooms, bathrooms, square footage, lot size
- Year built
- Assessed value
- Last sale date and price

It is used in our order wizards to **auto-fill property fields** when a user types an address (via Google Places autocomplete on the frontend, then SiteX on the backend).

---

## How SiteX Works

```
User types address in form
    ↓
Google Places autocomplete (frontend)
    ↓
User selects address
    ↓
Frontend calls POST /property/lookup
    ↓
Backend authenticates via OAuth2 (client_credentials grant)
    ↓
Backend calls GET /realestatedata/search with addr + lastLine + feedId
    ↓
SiteX returns match code: S (single), M (multi), N (no match)
    ↓
Backend parses Feed.PropertyProfile, returns normalized data
    ↓
Frontend auto-fills APN, county, legal description, owner, etc.
```

**Authentication flow:**
1. `POST` to `{BASE_URL}/ls/apigwy/oauth2/v1/token` with `client_id` and `client_secret` (OAuth2 client credentials)
2. Receive `access_token` (cached until expiry minus 60-second buffer)
3. Use `Bearer {token}` header on all subsequent search requests

**Search flow:**
1. `GET` to `{BASE_URL}/realestatedata/search` with query params `addr`, `lastLine`, and `feedId`
2. Parse response `MatchCode` (S / M / N)
3. For single match (S): extract property data from `Feed.PropertyProfile`
4. For multi match (M): return `Locations[]` for user to pick
5. For no match (N): allow manual entry

**Graceful degradation rule:** SiteX failure must NEVER block the user. If credentials are missing, the API is down, or no match is found, the user can always enter data manually.

---

## SiteX Credentials & Environment Variables

### Required Credentials (get from BKI/SiteX)

| Variable | Description | Example |
|----------|-------------|---------|
| `SITEX_CLIENT_ID` | OAuth2 client ID | (provided by BKI) |
| `SITEX_CLIENT_SECRET` | OAuth2 client secret | (provided by BKI) |
| `SITEX_FEED_ID` | Data feed identifier | (provided by BKI) |

### Full Environment Variable List

```env
# Required — Backend (Render / Railway)
SITEX_BASE_URL=https://api.bkiconnect.com
SITEX_CLIENT_ID=your_client_id
SITEX_CLIENT_SECRET=your_client_secret
SITEX_FEED_ID=your_feed_id

# Optional — Backend
SITEX_TIMEOUT=30                # Request timeout in seconds (default: 30)
SITEX_CACHE_TTL=1800            # Cache TTL in seconds (default: 1800 = 30 min)
SITEX_DEBUG=false               # Enable debug logging (default: false)

# Required — Frontend (Vercel)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_key
NEXT_PUBLIC_API_BASE_URL=https://your-api.com
```

### API Base URLs

| Environment | Base URL |
|-------------|----------|
| **Production** | `https://api.bkiconnect.com` |
| **UAT / Sandbox** | `https://api.uat.bkitest.com` |

---

## SiteX API Endpoints & Parameters

### Token Endpoint

```
POST {BASE_URL}/ls/apigwy/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id={SITEX_CLIENT_ID}
client_secret={SITEX_CLIENT_SECRET}
```

Returns: `{ "access_token": "...", "expires_in": 3600, ... }`

### Property Search Endpoint

```
GET {BASE_URL}/realestatedata/search
Authorization: Bearer {access_token}

Query params:
  addr      = street address (e.g., "123 Main St")
  lastLine  = "City, ST, ZIP" with commas (e.g., "Los Angeles, CA, 90001")
  feedId    = SITEX_FEED_ID
```

Returns JSON with `MatchCode` and `Feed.PropertyProfile`.

### Internal FastAPI Endpoints (our backend)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/property/lookup` | POST | Search by address |
| `/property/lookup-by-apn` | POST | Search by APN (stub) |
| `/property/status` | GET | Check SiteX configuration status |
| `/property/clear-cache` | POST | Invalidate all cached results |

---

## SiteX Critical Gotchas

These are the exact issues that caused past integration failures. **Do not deviate from these.**

| Item | Wrong | Correct |
|------|-------|---------|
| Token endpoint | `/oauth/token` | `/ls/apigwy/oauth2/v1/token` |
| Search endpoint | `/publicsearch` | `/realestatedata/search` |
| Address param name | `address1` | `addr` |
| City/State/ZIP param name | `address2` | `lastLine` |
| lastLine format | `Los Angeles CA 90001` (spaces) | `Los Angeles, CA, 90001` (commas) |
| feedId location | In URL path | As query parameter |
| Property data location | `response.property` | `Feed.PropertyProfile` |
| Legal description field | `LegalDescription` | `LegalBriefDescription` |
| ZIP code format | `91750-2401` | `91750` (truncate to 5 digits) |

---

## SiteX Backend Setup

### Step 1: Set Environment Variables

Add to your backend hosting (Render, Railway, etc.):

```env
SITEX_BASE_URL=https://api.bkiconnect.com
SITEX_CLIENT_ID=your_client_id
SITEX_CLIENT_SECRET=your_client_secret
SITEX_FEED_ID=your_feed_id
```

### Step 2: Copy Integration Files

From the toolkit into your project:

| Source (toolkit) | Destination (your project) |
|------------------|---------------------------|
| `integrations/sitex/sitex_client.py` | `api/app/services/sitex_client.py` |
| `integrations/sitex/sitex_models.py` | `api/app/services/sitex_models.py` |
| `integrations/sitex/property_routes.py` | `api/app/routes/property_routes.py` |

### Step 3: Register Routes

```python
# api/app/main.py
from app.routes.property_routes import router as property_router

app.include_router(property_router, prefix="/property", tags=["property"])
```

### Step 4: Verify

```bash
# Should return { "sitex_configured": true }
curl https://your-api.com/property/status

# Should return property data
curl -X POST https://your-api.com/property/lookup \
  -H "Content-Type: application/json" \
  -d '{"street":"123 Main St","city":"Los Angeles","state":"CA","zip":"90001"}'
```

---

## SiteX Frontend Setup

### Step 1: Set Environment Variables

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_key
NEXT_PUBLIC_API_BASE_URL=https://your-api.com
```

### Step 2: Copy Component Files

From the toolkit:
- `AddressAutocomplete.tsx` → `components/`
- `google-places.ts` → `lib/`
- `types.ts` → `lib/`

### Step 3: Use in Your Form

```tsx
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

<AddressAutocomplete
  onSelect={(address, property) => {
    setApn(property?.apn);
    setCounty(property?.county);
    setLegalDescription(property?.legalDescription);
    setOwnerName(property?.ownerName);
  }}
  fetchPropertyData={true}
/>
```

---

## SiteX Match Handling

| Match Code | Meaning | What Happens |
|------------|---------|-------------|
| `S` | Single match | Auto-fill from `Feed.PropertyProfile` |
| `M` | Multiple matches | Show list of `Locations[]` for user to pick |
| `N` | No match | Allow manual entry |

### Status Values Returned by Our API

| Status | Meaning | UI Behavior |
|--------|---------|-------------|
| `success` | Found one property | Auto-fill fields |
| `multi_match` | Multiple properties found | Show selection UI |
| `not_found` | No match in SiteX | Allow manual entry |
| `not_configured` | Missing credentials | Hide feature, manual entry |
| `error` | API failure | Show message, manual entry |

---

## SiteX Caching

- **TTL:** 30 minutes (configurable via `SITEX_CACHE_TTL`)
- **Key:** MD5 hash of `street|city|state|zip` (lowercased)
- **Scope:** Per-process (in-memory)
- **Clear:** `POST /property/clear-cache`

---

## SiteX Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 401 Unauthorized | Bad credentials | Verify `SITEX_CLIENT_ID` and `SITEX_CLIENT_SECRET` |
| 404 Not Found | Wrong endpoint | Use `/realestatedata/search`, not `/publicsearch` |
| Empty response | Wrong param names | Use `addr` + `lastLine`, not `address1` + `address2` |
| No property data | Wrong parsing path | Look in `Feed.PropertyProfile`, not response root |
| Missing legal description | Wrong field name | Use `LegalBriefDescription`, not `LegalDescription` |
| ZIP mismatch | Not truncated | Truncate to 5 digits (`91750-2401` → `91750`) |
| lastLine error | Missing commas | Format must be `City, ST, ZIP` with commas |

---

# Title Point (First American) — Title Searches

## What Title Point Does

Title Point (titlepoint.com) is a **First American** title search API used during the **Open Order** process. It retrieves:

1. **Geo/Property Data** — Property address/APN lookup, document records (deeds, liens)
2. **Legal Vesting (LV)** — Legal description, vesting information, deed history
3. **Tax Data** — Property tax installments, rates, valuations, assessments, flood zone, zoning
4. **Grant Deed** — The actual recorded Grant Deed as a PDF

All generated PDFs are uploaded to **AWS S3** for persistent storage.

---

## How Title Point Works

Title Point uses a **SOAP/REST hybrid API** with XML responses. The general pattern for every service is:

```
1. CreateService  →  Submit a search request (returns RequestID)
2. GetRequestSummaries  →  Poll until status = "Complete" (returns ServiceID, ResultID)
3. GetResultByID  →  Fetch the actual data
4. (Optional) CreateRequest3 + GetGeneratedImage  →  Generate and download a PDF
```

### Full Order Lifecycle Sequence

```
User fills Open Order form
  │
  ├── AJAX: CreateService(methodId=3) → Title Point CreateService3 (Tax)
  ├── AJAX: CreateService(methodId=4) → Title Point CreateService4 (Legal Vesting)
  │
  ├── AJAX: GetRequestSummaries(3) → Poll until complete
  ├── AJAX: GetRequestSummaries(4) → Poll until complete
  │
  ├── AJAX: GetResultById(4) → LV Data (BriefLegal, Vesting, Deeds)
  └── AJAX: GetResultById(3) → Tax Data (Installments, Rates, etc.)

User submits order → Order number assigned
  │
  ├── generateGeoDoc()
  │     CreateService3 (Geo.Address) → GetSummary → GetResult
  │     └── Stores document records in pct_title_point_document_records
  │
  ├── generateTaxDoc()
  │     CreateRequest3 → GetGeneratedImage → Tax PDF → AWS S3
  │
  ├── generateImg()   (Legal Vesting)
  │     CreateRequest3 → GetGeneratedImage → LV PDF → AWS S3
  │
  └── generateGrantDeed()
        GetDocumentsByParameters3 → Grant Deed PDF → AWS S3
```

### Authentication

All API calls use **query-string parameters** for auth:
- `userID` or `username` — Title Point username
- `password` — Title Point password

(Not OAuth — just query params on every request.)

### Response Format

All responses are **XML**, parsed via:
```php
$xmlData = simplexml_load_string($response);
$result  = json_decode(json_encode($xmlData), true);
```

Standard fields:
- `ReturnStatus`: `"Success"` or `"Failed"`
- `ReturnErrors > ReturnError > ErrorDescription`: Error details
- `RequestID`: Used for polling
- `OrderID`: Title Point's internal order reference

---

## Title Point Credentials & Environment Variables

### Credentials Needed

| Item | Description |
|------|-------------|
| `TP_USERNAME` | Title Point API username |
| `TP_PASSWORD` | Title Point API password |

These are provided by First American / Title Point account management.

### Full Environment Variable List (PHP / Legacy System)

```env
# Authentication
TP_USERNAME=your_username
TP_PASSWORD=your_password

# Base URL
TP_SERVICE_ENDPOINT=https://www.titlepoint.com/TitlePointServices/

# Service Endpoints
TP_CREATE_SERVICE_ENDPOINT=TpsService.asmx/CreateService4          # Legal Vesting
TP_TAX_INSTRUMENT_CREATE_SERVICE_ENDPOINT=TpsService.asmx/CreateService3  # Tax & Instrument
TP_REQUEST_SUMMARY_ENDPOINT=TpsService.asmx/GetRequestSummaries
TP_GET_RESULT_BY_ID=TpsService.asmx/GetResultByID
TP_GET_RESULT_BY_ID_3=TpsService.asmx/GetResultByID3               # With TPXML support

# PDF Generation Endpoints
TP_IMAGE_ENDPOINT=TpsGenerateImage.asmx/CreateRequest3
TP_IMAGE_REQUEST_STATUS=TpsGenerateImage.asmx/GetRequestStatus
TP_GENERATE_IMAGE=TpsGenerateImage.asmx/GetGeneratedImage

# Grant Deed
GRANT_DEED_ENDPOINT=TpsImage.asmx/GetDocumentsByParameters3

# Service Types
SERVICE_TYPE=TitlePoint.LegalAndVesting2
TAX_SEARCH_SERVICE_TYPE=TitlePoint.TaxSearch
INSTRUMENT_SEARCH_SERVICE_TYPE=your_instrument_type
```

### TypeScript Tax Module Environment Variables

```env
TITLEPOINT_MODE=mock                              # "mock" or "live"
TP_BASE_URL=https://www.titlepoint.com/TitlePointServices/
TP_USERNAME=your_username
TP_PASSWORD=your_password
TP_TAX_SERVICE_TYPE=TitlePoint.TaxSearch
TP_FIXTURES_DIR=                                  # Optional: override fixture path
```

### Constants (defined in `constants.php`)

```
TP_GEO_CREATE_SERVICE_URL   = TpsService.asmx/CreateService3?
TP_GEO_SERVICE_TYPE          = TitlePoint.Geo.Address
TP_GEO_REQUEST_SUMMARY_URL  = TpsService.asmx/GetRequestSummaries?
TP_GEO_GET_RESULT_URL       = TpsService.asmx/GetResultByID3?
```

---

## Title Point API Endpoints Reference

| Endpoint | ASMX Method | Used For |
|----------|-------------|----------|
| `TpsService.asmx/CreateService3` | CreateService3 | Tax search, Geo search, Instrument search |
| `TpsService.asmx/CreateService4` | CreateService4 | Legal Vesting search |
| `TpsService.asmx/GetRequestSummaries` | GetRequestSummaries | Poll for service completion |
| `TpsService.asmx/GetResultByID` | GetResultByID | Retrieve LV results |
| `TpsService.asmx/GetResultByID3` | GetResultByID3 | Retrieve Tax/Geo results (TPXML) |
| `TpsGenerateImage.asmx/CreateRequest3` | CreateRequest3 | Request PDF generation (LV/Tax) |
| `TpsGenerateImage.asmx/GetRequestStatus` | GetRequestStatus | Check PDF generation status |
| `TpsGenerateImage.asmx/GetGeneratedImage` | GetGeneratedImage | Download generated PDF (base64) |
| `TpsImage.asmx/GetDocumentsByParameters3` | GetDocumentsByParameters3 | Retrieve Grant Deed PDF |

### Common Query Parameters

All endpoints receive at minimum:
- `userID` / `username` — credentials
- `password` — credentials

Search services also receive:
- `orderNo` — (can be empty string for pre-order calls)
- `customerRef` — your internal reference
- `serviceType` — the service type string (see below)
- `parameters` — search parameters (APN, FIPS, address, etc.)
- `state` — 2-letter state code
- `county` — county name

---

## Title Point Service Types

| methodId | Service Type Constant | Env Variable | Description |
|----------|-----------------------|-------------|-------------|
| 3 | `TitlePoint.TaxSearch` | `TAX_SEARCH_SERVICE_TYPE` | Tax data lookup by APN |
| 4 | `TitlePoint.LegalAndVesting2` | `SERVICE_TYPE` | Legal Vesting lookup by address/APN/FIPS |
| — | `TitlePoint.Geo.Address` | (hardcoded constant) | Property/document records lookup |
| — | (varies) | `INSTRUMENT_SEARCH_SERVICE_TYPE` | Document lookup by instrument number |

---

## Title Point Full Order Flow

### Step 0: Pre-Order (During Form Entry — AJAX calls)

Before the order is submitted, the form makes AJAX calls to pre-fetch data:

1. **CreateService (methodId=3)** — Tax Search using APN, state, county
2. **CreateService (methodId=4)** — Legal Vesting using FIPS code, address, city, APN
3. **GetRequestSummaries** — Poll until complete; extract `serviceId` and `resultId`
4. **GetResultById (methodId=4)** — Legal Vesting data: BriefLegal, Vesting, FIPS, deed history
5. **GetResultById (methodId=3)** — Tax data: installments, rates, valuations, flood zone, zoning

All results stored in `pct_order_title_point_data` using a temporary `session_id` (`tp_api_id_{random_number}`) until a real order number is assigned.

### Step 1: Order Submission

Once the order is created and assigned a number:

1. Update `pct_order_title_point_data` with `file_number` (order number) and `order_id`
2. Load the TitlePoint library
3. Call `generateGeoDoc()` — property/geo data and document records
4. Check `titlePointShutOff` flag
5. If NOT shut off:
   - Call `generateTaxDoc()` — Tax PDF
   - Call `generateImg()` — Legal Vesting PDF
   - Call `generateGrantDeed()` — Grant Deed PDF

### Step 2: Geo Document Generation

1. **CreateService3** with `TitlePoint.Geo.Address` service type
   - Without unit number: search by full address (`AutoSearchProperty=True`)
   - With unit number: search by APN (`AutoSearchTaxes=True`, `AutoSearchProperty=True`)
2. **GetRequestSummaries** — poll until complete
3. **GetResultByID3** — retrieve geo document data
4. Store document records in `pct_title_point_document_records`

Retry logic: if address search returns 0 matches, the system first tries removing the last word from the address (suffix adjustment), then falls back to APN-based search.

### Step 3: Tax Document PDF

1. **CreateRequest3** — request PDF generation using the tax `serviceId` (params: `serviceId1`, `fileType=pdf`)
2. **GetGeneratedImage** — download base64-encoded PDF
3. Decode, save to `uploads/tax/{orderNumber}.pdf`
4. Upload to AWS S3 `tax/` folder
5. Update DB: `tax_file_status`, `tax_file_message`, `tax_request_id`, `tax_order_id`

### Step 4: Legal Vesting PDF

1. **CreateRequest3** — using the LV `serviceId`
2. **GetGeneratedImage** — download base64 PDF
3. Decode, save to `uploads/legal-vesting/{orderNumber}.pdf`
4. Upload to AWS S3 `legal-vesting/` folder
5. Update DB: `lv_file_status`, `lv_file_message`, `lv_request_id`, `lv_order_id`

### Step 5: Grant Deed PDF

1. Extract `instrumentNumber`, `recordedDate`, and `fips` from LV result
2. Parse instrument number to extract doc ID (strip year prefix or split on `-`)
3. **GetDocumentsByParameters3** with `FIPS={fips},TYPE=REC,SUBTYPE=ALL,YEAR={year},INST={docId}`, `fileType=PDF`
4. Decode base64 from `Documents > DocumentResponse > Document > Body > Body`
5. Save to `uploads/grant-deed/{orderNumber}.pdf`
6. Upload to AWS S3 `grant-deed/` folder
7. Update DB: `grant_deed_status`, `grant_deed_message`

---

## Title Point Data Retrieved

### Legal Vesting (methodId=4)

| Field | Description |
|-------|-------------|
| `BriefLegal` | Brief legal property description |
| `Vesting` | Current vesting information |
| `Fips` | FIPS county code |
| `LvDeeds > LegalAndVesting2DeedInfo` | Array of deed records |

Each deed record contains:
- `DocType` (Grant Deed, Quit Claim Deed, Intrafamily Transfer, etc.)
- `InstrumentNumber`
- `RecordedDate`

When `enable_vesting_document_type_filter` is on, only these doc types are considered: Grant Deed, Intrafamily Transfer & Dissolution, Quit Claim Deed, Intra-Family Transfer or Dissolution.

### Tax Data (methodId=3)

| Field | Description |
|-------|-------------|
| `TaxReport > Installments > Item[0]` | First installment (amount, balance, due, status, penalty) |
| `TaxReport > Installments > Item[1]` | Second installment |
| `TaxRateArea` | Tax rate area code |
| `UseCode` | Property use code |
| `TaxRate` | Tax rate |
| `IssueDate` | Tax bill issue date |
| `LandValuation` | Land assessed value |
| `ImprovementsValuation` | Improvements assessed value |
| `FloodZone` | Flood zone designation |
| `ZoningCode` | Zoning code |
| `TaxabilityCode` | Taxability code |

### Grant Deed

Full PDF of the recorded deed, retrieved by FIPS + Year + Instrument Number.

---

## Title Point TypeScript Tax Integration

A standalone TypeScript module exists at `integrations/titlepoint-tax/` for tax-only workflows.

### Quick Start

```bash
cd integrations/titlepoint-tax
npm install
npm test          # Mock mode, no credentials needed
npm run smoke     # End-to-end smoke test (mock by default)
```

### Live API Usage

```bash
TITLEPOINT_MODE=live \
  TP_BASE_URL=https://www.titlepoint.com/TitlePointServices/ \
  TP_USERNAME=your_username \
  TP_PASSWORD=your_password \
  TP_TAX_SERVICE_TYPE=TitlePoint.TaxSearch \
  npm run smoke
```

### Mock vs Live

| Mode | Behavior |
|------|----------|
| `mock` (default) | Reads XML fixtures from `docs/titlepoint/fixtures/` — no network calls |
| `live` | Calls the real Title Point API with real credentials |

### Key Fixture Files

| File | Used For |
|------|----------|
| `08_raw_xml_create_service.xml` | CreateService3 response |
| `04_full_order_lifecycle.json` | GetRequestSummaries (synthetic XML) |
| `05_raw_xml_tax_search.xml` | GetResultByID3 tax result |

### Normalized Envelope

Every API call returns a consistent envelope:

```json
{
  "vendor": "titlepoint",
  "request_type": "create_service_3 | request_summaries | get_result_by_id_3",
  "endpoint": "TpsService.asmx/CreateService3",
  "request": { "params": { "...credentials redacted..." } },
  "response_raw": "<xml>...</xml>",
  "response_parsed": {},
  "return_status": "Success | Error | Unknown",
  "request_id": "123",
  "order_id": "TP-123",
  "timing_ms": 450,
  "attempt": 1,
  "ts_utc": "2025-01-15T12:00:00Z"
}
```

Credential fields (`password`, `userID`) are always replaced with `***REDACTED***`.

---

## Title Point Database & Storage

### Database Tables

| Table | Purpose |
|-------|---------|
| `pct_order_title_point_data` | All Title Point results per order: service IDs, legal description, vesting, tax data, instrument numbers, statuses |
| `pct_title_point_document_records` | Individual document records from Geo search results |

### AWS S3 Folders

| Folder | Contents | Naming |
|--------|----------|--------|
| `legal-vesting/` | Legal Vesting PDFs | `{orderNumber}.pdf` |
| `tax/` | Tax document PDFs | `{orderNumber}.pdf` |
| `grant-deed/` | Grant Deed PDFs | `{orderNumber}.pdf` |
| `tax-data-xml/` | Raw tax XML responses | `tp_api_id_{random_number}.xml` |

### Key PHP Files (Legacy System)

| File | Purpose |
|------|---------|
| `application/libraries/order/Titlepoint.php` | Core library — all API calls |
| `application/modules/frontend/controllers/order/TitlePoint.php` | Frontend AJAX endpoints |
| `application/modules/frontend/controllers/order/Home.php` | Open Order — triggers calls on submission (lines 853-892) |
| `application/modules/frontend/controllers/order/Cron.php` | Retry jobs for failed calls |
| `application/modules/admin/controllers/order/TitlePoint.php` | Admin log views |
| `application/modules/frontend/models/order/TitlePointData.php` | Model for `pct_order_title_point_data` |
| `application/modules/frontend/models/order/TitlePointDocumentRecords.php` | Model for `pct_title_point_document_records` |
| `application/config/constants.php` | Geo service URL constants (lines 109-112) |

### Frontend AJAX Routes

| Route | Method | Description |
|-------|--------|-------------|
| `createService` | `createService()` | Create Tax (3) or LV (4) service |
| `getRequestSummaries` | `getRequestSummaries()` | Poll for completion |
| `getResultById` | `getResultById()` | Retrieve LV or Tax results |
| `imageCreateRequest` | `imageCreateRequest()` | Request PDF generation |
| `getRequestStatus` | `getRequestStatus()` | Check PDF status |
| `generateImage` | `generateImage()` | Download generated PDF |
| `instrumentService` | `instrumentService()` | Instrument/doc search |
| `generate-grant-deed` | `generateGrantDeed()` | Generate Grant Deed PDF |
| `generate-tax-doc` | `generateTaxDoc()` | Generate Tax doc PDF |

### Admin Log Routes

| Route | Description |
|-------|-------------|
| `order/admin/lv-log` | Legal Vesting generation logs |
| `order/admin/tax-log` | Tax document generation logs |
| `order/admin/tax-data` | Tax data details |
| `order/admin/grant-deed-log` | Grant Deed generation logs |
| `order/admin/pre-listing` | Pre-listing logs |

---

## Title Point Configuration Flags

| Config Key | Effect |
|------------|--------|
| `titlePointShutOff` | When enabled (1), skips LV, Tax, and Grant Deed calls during order submission. Orders still submit to Resware and send confirmation emails. |
| `enable_lv_with_address_apn` | When enabled (1), includes `Address1` and `City` in LV service parameters alongside APN. |
| `enable_vesting_document_type_filter` | When enabled (1), only considers Grant Deed, Quit Claim, and Intrafamily Transfer doc types for the vesting instrument. When disabled (0), accepts any doc type. |

### Cron / Background Retry

The `Cron.php` controller retries failed operations:
- LV & Tax PDF regeneration for orders where `lv_file_status` or `tax_file_status` indicate failure
- Grant Deed regeneration for orders where `grant_deed_status` indicates failure
- Geo document regeneration for failed property lookups

---

## Title Point Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ReturnStatus: Failed` | Bad credentials or params | Check `TP_USERNAME`, `TP_PASSWORD`, and `serviceType` |
| No results after polling | Request timed out | Increase poll timeout; check if Title Point is up |
| Missing LV data | Wrong methodId | LV uses `CreateService4` (methodId=4), not 3 |
| Missing tax data | Wrong result endpoint | Tax uses `GetResultByID3` (not `GetResultByID`) |
| Grant Deed 404 | Wrong instrument format | Strip year prefix or split on `-` to extract doc ID |
| PDF is empty/corrupt | base64 decode issue | Check `Documents > DocumentResponse > Document > Body > Body` path |
| LV only returns some deeds | Doc type filter is on | Check `enable_vesting_document_type_filter` config |

### API Logging

All Title Point calls are logged via `apiLogs->syncLogs()`:
- `type`: always `'titlepoint'`
- `action`: descriptive name (e.g., `create_service_3`, `create_lv_image_request`, `generate_grant_deed`)
- `request`: full URL with parameters
- `response`: full API response
- `order_id`: associated order ID
- `log_id`: links request/response log pairs

---

## Quick Comparison: SiteX vs Title Point

| Aspect | SiteX (BKI) | Title Point (First American) |
|--------|-------------|------------------------------|
| **Purpose** | Property data lookup (APN, owner, legal) | Full title search (tax, LV, deeds, PDFs) |
| **Auth** | OAuth2 client credentials (Bearer token) | Query string username/password |
| **Protocol** | REST / JSON | SOAP-like / XML |
| **When used** | During form entry (address autocomplete) | Pre-order + order submission |
| **Backend** | Python (FastAPI) | PHP (legacy) + TypeScript (new tax module) |
| **Failure policy** | Never blocks user; manual entry fallback | Retried via cron; `titlePointShutOff` flag |
| **Caching** | In-memory, 30-min TTL | DB-backed (`pct_order_title_point_data`) |
| **PDF generation** | N/A | Yes (Tax, LV, Grant Deed → S3) |
