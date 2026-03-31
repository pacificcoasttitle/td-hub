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

## Status
The TitlePoint portion of this mixed reference file is intentionally reduced to a redirect.

The older detailed TitlePoint content in this file drifted away from the final `td-hub` implementation and now conflicts with the canonical TitlePoint docs.

Use these instead:

- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`
- `docs/titlepoint/TITLEPOINT_DEBUG_TIMELINE_2026-03.md`
- `docs/titlepoint/TITLEPOINT_TAX_CALLS_REFERENCE.md`
- `docs/titlepoint/TITLEPOINT_GRANT_DEED_CALL_AND_RETRIEVAL.md`
- `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`

## Final TitlePoint Summary
- TitlePoint is fully operational in `td-hub`.
- Pre-init runs tax + legal vesting only.
- Post-order geo uses the legacy dual-call result flow.
- Geo, tax, and legal vesting PDFs use the image pipeline.
- Grant deed uses the dedicated `GetDocumentsByParameters3` retrieval path.
- Confirmation queuing waits for completed `legal_vesting`, `tax`, and `grant_deed`.

## Keep This File For
- SiteX background and setup notes.
- A short cross-reference pointer to the canonical TitlePoint docs.

Do not use this file as implementation truth for TitlePoint.
