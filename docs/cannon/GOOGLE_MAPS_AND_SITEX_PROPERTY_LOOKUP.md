# Google Maps & SiteX — Property Information Retrieval

**TrendyReports.io — Internal Technical Reference**
*Last updated: March 11, 2026*

---

## Table of Contents

1. [Overview](#overview)
2. [The Two Services at a Glance](#the-two-services-at-a-glance)
3. [End-to-End Flow: Address to Property Data](#end-to-end-flow-address-to-property-data)
4. [Google Maps — Detailed Breakdown](#google-maps--detailed-breakdown)
   - 4.1 [Places Autocomplete (Frontend)](#41-places-autocomplete-frontend)
   - 4.2 [Geocoding API (Worker Fallback)](#42-geocoding-api-worker-fallback)
   - 4.3 [Street View Static API (Hero Image)](#43-street-view-static-api-hero-image)
   - 4.4 [Static Maps API (Aerial & Comp Thumbnails)](#44-static-maps-api-aerial--comp-thumbnails)
   - 4.5 [Maps JavaScript API (Interactive Comp Map)](#45-maps-javascript-api-interactive-comp-map)
5. [SiteX Pro — Detailed Breakdown](#sitex-pro--detailed-breakdown)
   - 5.1 [Authentication (OAuth2)](#51-authentication-oauth2)
   - 5.2 [Address Search](#52-address-search)
   - 5.3 [APN Search](#53-apn-search)
   - 5.4 [PropertyData Model (What SiteX Returns)](#54-propertydata-model-what-sitex-returns)
   - 5.5 [Field Mappings from Raw SiteX Response](#55-field-mappings-from-raw-sitex-response)
   - 5.6 [Multi-Match Handling](#56-multi-match-handling)
   - 5.7 [Caching](#57-caching)
   - 5.8 [Error Handling](#58-error-handling)
6. [How Google Maps and SiteX Work Together](#how-google-maps-and-sitex-work-together)
7. [Property Report Wizard — Step-by-Step](#property-report-wizard--step-by-step)
8. [CMA / Lead Page Flow](#cma--lead-page-flow)
9. [Where SiteX Data Appears in the Final Report](#where-sitex-data-appears-in-the-final-report)
10. [Environment Variables](#environment-variables)
11. [Key Files Reference](#key-files-reference)
12. [Testing & Validation](#testing--validation)
13. [Diagrams](#diagrams)

---

## Overview

TrendyReports uses **two external services** in tandem to go from a user-typed address to a complete property profile:

| Step | Service | What It Does |
|------|---------|--------------|
| 1 | **Google Maps** (Places Autocomplete) | Helps the user type and select a valid US address with auto-suggestions |
| 2 | **SiteX Pro** (ICE Property Data API) | Takes the validated address and returns structured assessor/recorder data: beds, baths, sqft, APN, owner, tax info, legal description, coordinates, and more |

After the property is retrieved, Google Maps is used again by the **worker** to generate visual assets (aerial map, street view hero, comp map thumbnails) that appear in the final PDF report.

---

## The Two Services at a Glance

### Google Maps APIs Used

| API | Layer | Purpose |
|-----|-------|---------|
| **Places Autocomplete** | Frontend (Next.js) | Address type-ahead suggestions restricted to US addresses |
| **Geocoding** | Worker (Python) | Fallback: convert address → lat/lng when SiteX returns 0/0 coordinates |
| **Street View Static** | Worker (Python) | Auto-generate a property hero/cover image from street-level photography |
| **Static Maps** | Worker (Python) + Frontend | Generate aerial/roadmap images for the property and comparable thumbnails |
| **Maps JavaScript** | Frontend (React) | Interactive map modal showing subject + comp markers with info windows |

### SiteX Pro APIs Used

| API | Layer | Purpose |
|-----|-------|---------|
| **OAuth2 Token** | API (FastAPI) | Authenticate via client credentials to obtain a bearer token |
| **Address Search** | API (FastAPI) | Look up a property by street address + city/state/ZIP |
| **APN Search** | API (FastAPI) | Look up a property by FIPS code + Assessor's Parcel Number (disambiguation) |

---

## End-to-End Flow: Address to Property Data

```
USER TYPES ADDRESS
        │
        ▼
┌──────────────────────────┐
│  Google Places            │  Frontend (useGooglePlaces hook)
│  Autocomplete             │  Types: ["address"], Country: US
│  ─────────────────────── │
│  User selects suggestion  │
│  → Parsed into:           │
│    • street_address        │
│    • city, state, zip      │
│    • lat, lng (from Google)│
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  POST /v1/property/search │  Frontend → API proxy
│  { address, city_state_zip}│
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  SiteX Pro                │  API (services/sitex.py)
│  ─────────────────────── │
│  1. Get OAuth2 token      │
│  2. GET /realestatedata/  │
│     search?addr=...       │
│  3. Parse response →      │
│     PropertyData          │
│  ─────────────────────── │
│  Returns:                 │
│  • beds, baths, sqft      │
│  • APN, FIPS, owner       │
│  • assessed value, tax    │
│  • legal description      │
│  • lat/lng, year built    │
│  • property_type (UseCode)│
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Property data displayed  │  Frontend wizard Step 1
│  in the wizard UI         │
│  ─────────────────────── │
│  Agent confirms property  │
│  → Proceeds to comps      │
└──────────────────────────┘
```

---

## Google Maps — Detailed Breakdown

### 4.1 Places Autocomplete (Frontend)

**File:** `apps/web/hooks/useGooglePlaces.ts`

This is the entry point for every property lookup. When an agent starts typing an address in the property wizard, Google Places Autocomplete provides real-time suggestions.

**How it works:**

1. The `useGooglePlaces` hook dynamically loads the Google Maps JavaScript API with the Places library.
2. It creates an `Autocomplete` instance bound to the address input field with these constraints:
   - `componentRestrictions: { country: "us" }` — US addresses only
   - `types: ["address"]` — only street addresses (no businesses, cities, etc.)
   - `fields: ["address_components", "formatted_address", "geometry", "name"]`
3. When the user selects a suggestion, the `place_changed` event fires.
4. The `parseAddressComponents()` function extracts structured data:

| Google Component Type | Extracted Field |
|-----------------------|-----------------|
| `street_number` | Street number |
| `route` | Street name |
| `locality` (or `sublocality_level_1`) | City |
| `administrative_area_level_1` | State (short name, e.g., "CA") |
| `administrative_area_level_2` | County (with " County" suffix removed) |
| `postal_code` | ZIP code |
| `geometry.location` | Latitude / Longitude |

5. The parsed result auto-fills both the "Street Address" and "City, State ZIP" fields in the wizard.
6. The frontend immediately fires a search request to the API with the parsed address.

**API Key:** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (exposed to browser)

**Where used:**
- Property wizard (`step-property.tsx`)
- Property search form (`PropertySearchForm.tsx`)
- CMA consumer landing wizard (`ConsumerLandingWizard.tsx`)
- CMA funnel component (`cma-funnel.tsx`)

---

### 4.2 Geocoding API (Worker Fallback)

**File:** `apps/worker/src/worker/property_builder.py` → `_geocode_address()`

SiteX sometimes returns `latitude: 0, longitude: 0` when it doesn't have coordinates for a property. When this happens, the worker falls back to Google's Geocoding API.

**How it works:**

1. During report generation, `_build_images_context()` reads lat/lng from `sitex_data`.
2. If lat/lng are `0/0` or `None`, the worker calls `_geocode_address(full_address)`.
3. The method sends a GET request to:
   ```
   https://maps.googleapis.com/maps/api/geocode/json?address=<full_address>&key=<GOOGLE_MAPS_API_KEY>
   ```
4. If the response status is `"OK"`, it extracts `results[0].geometry.location.lat` and `lng`.
5. These coordinates are then used for map image generation.

**API Key:** `GOOGLE_MAPS_API_KEY` (server-side only, in the worker)

---

### 4.3 Street View Static API (Hero Image)

**File:** `apps/worker/src/worker/property_builder.py` → `_build_images_context()`

The hero/cover image at the top of every property report is generated automatically when no custom image has been uploaded.

**Priority chain:**
1. User-uploaded `cover_image_url` → used as-is
2. Google Street View image → auto-generated from lat/lng
3. `None` → template renders a placeholder gradient

**URL constructed:**
```
https://maps.googleapis.com/maps/api/streetview
  ?size=1200x800
  &location={lat},{lng}
  &fov=90
  &pitch=0
  &key={GOOGLE_MAPS_API_KEY}
```

**Parameters:**
- `size=1200x800` — high resolution for PDF rendering
- `fov=90` — field of view in degrees
- `pitch=0` — camera angle (level with the ground)

---

### 4.4 Static Maps API (Aerial & Comp Thumbnails)

**File:** `apps/worker/src/worker/property_builder.py`

Two types of static map images are generated:

#### Property Aerial Map
Used as the "Aerial View" / "Location Map" page in the report.

```
https://maps.googleapis.com/maps/api/staticmap
  ?center={lat},{lng}
  &zoom=15
  &size=800x600
  &maptype=roadmap
  &markers={lat},{lng}
  &key={GOOGLE_MAPS_API_KEY}
```

#### Comparable Thumbnails
When a comparable listing doesn't have an MLS photo, a small map thumbnail is generated as a fallback.

```
https://maps.googleapis.com/maps/api/staticmap
  ?center={lat},{lng}
  &zoom=16
  &size=400x200
  &maptype=roadmap
  &markers={lat},{lng}
  &key={GOOGLE_MAPS_API_KEY}
```

The template uses `comp.photo_url | default(comp.map_image_url)` — it prefers the MLS photo but falls back to the map thumbnail.

---

### 4.5 Maps JavaScript API (Interactive Comp Map)

**File:** `apps/web/components/property/ComparablesMapModal.tsx`

An interactive Google Map modal that displays the subject property and all selected comparables as markers. Uses `@react-google-maps/api` with `useJsApiLoader`.

Features:
- Subject property marker (distinct color)
- Comparable markers with click-to-open info windows (address, price, beds/baths)
- Auto-fit bounds to show all markers
- Responsive sizing

**Dependencies:** `@react-google-maps/api` (v2.20.8)

---

## SiteX Pro — Detailed Breakdown

### 5.1 Authentication (OAuth2)

**File:** `apps/api/src/api/services/sitex.py` → `SiteXTokenManager`

SiteX uses OAuth2 client credentials flow.

**Token lifecycle:**

1. **Request:** `POST {SITEX_BASE_URL}/ls/apigwy/oauth2/v1/token`
   - Body: `grant_type=client_credentials`
   - Auth: Basic auth with `SITEX_CLIENT_ID` / `SITEX_CLIENT_SECRET`
2. **Response:** Bearer token with 10-minute TTL
3. **Refresh:** The singleton `SiteXTokenManager` auto-refreshes at the 9-minute mark (1 minute before expiry)
4. **All subsequent API calls** include `Authorization: Bearer <token>` header

---

### 5.2 Address Search

**Primary method for property lookup.** This is called every time a user searches for a property in the wizard.

**Request:**
```
GET {SITEX_BASE_URL}/realestatedata/search
  ?addr=714 Vine St
  &lastLine=Anaheim, CA 92805
  &feedId=100001
  &options=search_exclude_nonres=Y
```

| Parameter | Value | Notes |
|-----------|-------|-------|
| `addr` | Street address | e.g., "714 Vine St" |
| `lastLine` | City, State ZIP | e.g., "Anaheim, CA 92805" |
| `feedId` | Feed ID from config | e.g., "100001" |
| `options` | `search_exclude_nonres=Y` | Exclude non-residential results |

**Response:** SiteX returns a JSON payload containing `Feed.PropertyProfile` with the full assessor record. The `_parse_response()` method extracts the relevant fields and `normalize_sitex()` converts them to a `PropertyData` Pydantic model.

---

### 5.3 APN Search

**Used for disambiguation** when an address search returns multiple matches.

**Request:**
```
GET {SITEX_BASE_URL}/realestatedata/search
  ?fips=06059
  &apn=036-211-01
  &feedId=100001
```

| Parameter | Value | Notes |
|-----------|-------|-------|
| `fips` | County FIPS code (5 digits) | e.g., "06059" for Orange County, CA |
| `apn` | Assessor's Parcel Number | e.g., "036-211-01" |
| `feedId` | Feed ID from config | Same as address search |

This method provides the most precise lookup, resolving directly to a single parcel.

---

### 5.4 PropertyData Model (What SiteX Returns)

The normalized `PropertyData` Pydantic model returned by every successful SiteX lookup:

```python
class PropertyData(BaseModel):
    # Address
    full_address: str          # "714 Vine St, Anaheim, CA 92805"
    street: str                # "714 Vine St"
    city: str                  # "Anaheim"
    state: str                 # "CA"
    zip_code: str              # "92805"
    county: str                # "Orange"

    # Identifiers
    apn: str                   # "036-211-01"
    fips: str                  # "06059"

    # Owner
    owner_name: str            # "John A Smith"
    secondary_owner: str|None  # "Jane B Smith"

    # Legal
    legal_description: str     # "LOT 15 BLK A TR 1234"

    # Property characteristics
    bedrooms: int|None         # 3
    bathrooms: float|None      # 2.0
    sqft: int|None             # 1450
    lot_size: int|None         # 6500 (sq ft)
    year_built: int|None       # 1965
    property_type: str         # "SFR" (UseCode)

    # Tax/Assessment
    assessed_value: int|None   # 485000
    tax_amount: float|None     # 5842.50
    land_value: int|None       # 290000
    improvement_value: int|None # 195000
    tax_year: int|None         # 2025

    # Location
    latitude: float|None       # 33.8294
    longitude: float|None      # -117.9064
```

---

### 5.5 Field Mappings from Raw SiteX Response

| SiteX API Path | PropertyData Field | Notes |
|----------------|--------------------|-------|
| `PropertyAddress.StreetAddress` | `street` | Full street address |
| `PropertyAddress.City` | `city` | |
| `PropertyAddress.State` | `state` | |
| `PropertyAddress.Zip` | `zip_code` | |
| `PropertyAddress.County` | `county` | |
| `PropertyAddress.APNFormatted` / `PropertyProfile.APN` | `apn` | Assessor's Parcel Number |
| `PropertyAddress.FIPSCode` | `fips` | County FIPS code |
| `OwnerInformation.OwnerFullName` | `owner_name` | Current owner of record |
| `LegalDescriptionInfo.LegalBriefDescription` | `legal_description` | Parcel legal description |
| `PropertyCharacteristics.Bedrooms` | `bedrooms` | |
| `PropertyCharacteristics.TotalBaths` | `bathrooms` | Full + half baths |
| `PropertyCharacteristics.LivingArea` / `BuildingArea` | `sqft` | Living square footage |
| `PropertyCharacteristics.LotSize` / `LotSizeSqFt` | `lot_size` | Lot area in sq ft |
| `PropertyCharacteristics.YearBuilt` | `year_built` | |
| `PropertyCharacteristics.UseCode` | `property_type` | Drives comp filtering (SFR, Condo, etc.) |
| `AssessmentTaxInfo.TotalAssessedValue` | `assessed_value` | |
| `AssessmentTaxInfo.TaxAmount` | `tax_amount` | Annual property tax |
| `AssessmentTaxInfo.LandValue` | `land_value` | |
| `AssessmentTaxInfo.ImprovementValue` | `improvement_value` | |
| `PropertyAddress.Latitude` | `latitude` | May be 0 if unavailable |
| `PropertyAddress.Longitude` | `longitude` | May be 0 if unavailable |

---

### 5.6 Multi-Match Handling

When SiteX returns multiple properties for an address (e.g., condos in a complex), the API raises a `SiteXMultiMatchError` containing a list of `SiteXLocation` objects:

```python
class SiteXLocation(BaseModel):
    fips: str     # "06059"
    apn: str      # "036-211-01"
    address: str  # "714 Vine St Unit A"
    city: str
    state: str
```

The frontend displays a disambiguation picker allowing the agent to select the correct unit, which triggers a follow-up APN search for the exact parcel.

---

### 5.7 Caching

| Cache | TTL | Key Format | Storage |
|-------|-----|------------|---------|
| Address lookup | 24 hours | `SHA256("{address}|{city_state_zip}")` | In-memory `dict` |
| APN lookup | 24 hours | `"apn:{fips}:{apn}"` | In-memory `dict` |
| OAuth2 token | ~9 minutes (refreshed before 10-min expiry) | Singleton instance | In-memory |

Caching is in-process only (not Redis). A process restart clears all cached lookups.

---

### 5.8 Error Handling

| Scenario | Behavior |
|----------|----------|
| HTTP 401 (expired/bad token) | Auto-refreshes token once, then raises `SiteXAuthError` → HTTP 503 |
| No results found | Returns `None` → wizard shows "Property not found" UI state |
| Multiple results | Raises `SiteXMultiMatchError` → frontend shows disambiguation picker |
| Token refresh failure | Raises `SiteXAuthError` → HTTP 503 |
| Network timeout | `httpx.TimeoutException` → logged, raised as HTTP 504 |
| Missing optional field | `_parse_response` uses `.get()` with `None` defaults; never raises on missing fields |
| Missing SiteX credentials | `SiteXConfig.validate()` returns `False`; search returns empty/error |

---

## How Google Maps and SiteX Work Together

The two services play complementary roles across the property report lifecycle:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PROPERTY REPORT LIFECYCLE                       │
├─────────────┬───────────────────────────┬───────────────────────────┤
│   Phase     │   Google Maps             │   SiteX Pro               │
├─────────────┼───────────────────────────┼───────────────────────────┤
│ Address     │ Places Autocomplete:      │                           │
│ Entry       │ Real-time suggestions     │                           │
│             │ as agent types            │                           │
├─────────────┼───────────────────────────┼───────────────────────────┤
│ Property    │ Parsed address components │ Address search:           │
│ Lookup      │ sent to API               │ Full property record      │
│             │                           │ (beds, baths, sqft, APN,  │
│             │                           │  owner, tax, legal desc)  │
├─────────────┼───────────────────────────┼───────────────────────────┤
│ Comp        │ Interactive map modal     │ SiteX UseCode → property  │
│ Selection   │ showing subject + comps   │ type mapping for comp     │
│             │                           │ search filters            │
├─────────────┼───────────────────────────┼───────────────────────────┤
│ Coordinate  │ Geocoding fallback when   │ Primary lat/lng source    │
│ Resolution  │ SiteX returns 0/0         │ from assessor records     │
├─────────────┼───────────────────────────┼───────────────────────────┤
│ Report      │ Street View → hero image  │ Property data populates   │
│ Generation  │ Static Maps → aerial map  │ all report sections:      │
│ (Worker)    │ Static Maps → comp thumbs │ overview, details, stats  │
├─────────────┼───────────────────────────┼───────────────────────────┤
│ PDF Output  │ Map images embedded as    │ Data rendered in Jinja2   │
│             │ base64 in HTML before     │ templates across all 5    │
│             │ PDFShift rendering        │ themes                    │
└─────────────┴───────────────────────────┴───────────────────────────┘
```

**Key interaction points:**

1. **Google provides the address → SiteX provides the data.** Google's Autocomplete ensures the address is valid and properly formatted before SiteX receives it.

2. **SiteX provides coordinates → Google generates images.** The lat/lng from SiteX are used to build Street View and Static Maps URLs for the report.

3. **SiteX coordinates fail → Google Geocoding rescues.** When SiteX returns 0/0 coordinates (common for newer parcels or rural areas), the worker geocodes the address via Google to still produce map images.

4. **SiteX UseCode drives comp search.** The `property_type` (UseCode) from SiteX is mapped to SimplyRETS `type` + `subtype` to filter for relevant comparable listings.

---

## Property Report Wizard — Step-by-Step

### Step 1: Property Search

1. **Agent types address** → Google Places Autocomplete provides suggestions
2. **Agent selects suggestion** → `useGooglePlaces` hook parses address components:
   - Street address: `"714 Vine St"`
   - City/State/ZIP: `"Anaheim, CA 92805"`
3. **Frontend fires API call** → `POST /api/proxy/v1/property/search`
4. **API calls SiteX** → `lookup_property("714 Vine St", "Anaheim, CA 92805")`
5. **SiteX authenticates** → OAuth2 token obtained/refreshed
6. **SiteX searches** → `GET /realestatedata/search?addr=714+Vine+St&lastLine=Anaheim,+CA+92805&feedId=100001`
7. **SiteX returns data** → Parsed into `PropertyData` model
8. **Frontend displays** → Property card showing beds, baths, sqft, year built, owner, assessed value
9. **Agent confirms** → Proceeds to Step 2

### Step 2: Comparables

- SiteX `property_type` (UseCode) is mapped to SimplyRETS filters
- SiteX lat/lng used for distance-based comp filtering (0.5 mile radius)
- Agent selects 4–8 comparable listings

### Step 3: Theme & Pages

- Agent selects theme (Classic, Modern, Elegant, Teal, Bold)
- Agent selects pages to include/exclude

### Step 4: Generate

1. Frontend sends `sitex_data` + comparables + theme config to `POST /v1/property/reports`
2. Celery worker receives the task
3. Worker reads lat/lng from `sitex_data`:
   - If valid → uses directly for map images
   - If 0/0 → calls `_geocode_address()` via Google Geocoding API
4. Worker generates images via Google Maps:
   - **Hero:** Street View Static API (1200×800)
   - **Aerial:** Static Maps API (800×600, zoom 15)
   - **Comp thumbnails:** Static Maps API (400×200, zoom 16) — only when MLS photo is missing
5. Worker renders Jinja2 template with all SiteX property data + Google Maps images
6. Images are fetched and embedded as base64 in the HTML
7. HTML sent to PDFShift for PDF generation
8. PDF uploaded to Cloudflare R2

---

## CMA / Lead Page Flow

The same Google Maps + SiteX pipeline powers the consumer-facing CMA (Comparative Market Analysis) lead pages:

```
Consumer visits agent's lead page
        │
        ▼
Types address → Google Places Autocomplete
        │
        ▼
POST /v1/cma/{agent_code}/search (public endpoint, no auth)
        │
        ▼
SiteX lookup_property() → PropertyData
        │
        ▼
Consumer sees: "Is this your property?"
  (beds, baths, sqft, assessed value displayed)
        │
        ▼
Consumer provides contact info
        │
        ▼
Report generated with same worker pipeline
```

---

## Where SiteX Data Appears in the Final Report

| Report Section | SiteX Fields Used |
|----------------|-------------------|
| **Cover Page** | Property address, city, state, ZIP |
| **Property Overview** | Beds, baths, sqft, lot size, year built, property type |
| **Property Details** | APN, legal description, census tract, zoning, lot number |
| **Owner Information** | Owner name, secondary owner |
| **Tax & Assessment** | Assessed value, tax amount, land value, improvement value, tax year |
| **Area Analysis** | Lat/lng (for neighborhood context), county |
| **Aerial Map** | Lat/lng (drives Google Static Maps URL) |
| **Hero Image** | Lat/lng (drives Google Street View URL) |
| **Comparables** | Property type/UseCode (drives comp search filter type + subtype) |
| **Market Overview** | Lat/lng (map center for area context) |

---

## Environment Variables

| Variable | Service | Layer | Purpose |
|----------|---------|-------|---------|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google | Frontend (Next.js) | Places Autocomplete, interactive map modal, static map preview |
| `GOOGLE_MAPS_API_KEY` | Google | Worker (Python) | Geocoding, Street View, Static Maps for PDF rendering |
| `SITEX_BASE_URL` | SiteX | API (FastAPI) | API gateway URL (UAT: `https://api.uat.bkitest.com`) |
| `SITEX_CLIENT_ID` | SiteX | API (FastAPI) | OAuth2 client ID |
| `SITEX_CLIENT_SECRET` | SiteX | API (FastAPI) | OAuth2 client secret |
| `SITEX_FEED_ID` | SiteX | API (FastAPI) | Feed identifier (e.g., `100001`) |

**Google Maps API must have these services enabled:**
- Maps JavaScript API (frontend)
- Places API (frontend autocomplete)
- Geocoding API (worker fallback)
- Static Maps API (worker aerial + comp thumbnails)
- Street View Static API (worker hero image)

---

## Key Files Reference

### Google Maps

| File | What It Does |
|------|--------------|
| `apps/web/hooks/useGooglePlaces.ts` | Places Autocomplete hook — loads Google Maps JS, parses address components |
| `apps/web/components/google-maps-loader.tsx` | GoogleMapsProvider — script loader with `useGoogleMapsLoaded()` hook |
| `apps/web/components/property/ComparablesMapModal.tsx` | Interactive map modal with subject + comp markers |
| `apps/web/components/property-wizard/map-modal.tsx` | Static Maps URL builder for comp map preview |
| `apps/worker/src/worker/property_builder.py` | `_geocode_address()`, `_build_images_context()` — Geocoding, Street View, Static Maps |

### SiteX Pro

| File | What It Does |
|------|--------------|
| `apps/api/src/api/services/sitex.py` | Full SiteX client — OAuth2, address search, APN search, caching, error handling |
| `apps/api/src/api/routes/property.py` | API endpoints that call SiteX — `/search`, `/search-by-apn`, report creation |
| `apps/api/src/api/routes/lead_pages.py` | CMA lead page endpoint — calls `lookup_property()` |
| `apps/api/src/api/schemas/property.py` | Pydantic schemas for property data normalization |

### Report Templates (consume SiteX data + Google Maps images)

| File | Theme |
|------|-------|
| `apps/worker/src/worker/templates/property/classic/classic_report.jinja2` | Classic |
| `apps/worker/src/worker/templates/property/modern/modern_report.jinja2` | Modern |
| `apps/worker/src/worker/templates/property/elegant/elegant.jinja2` | Elegant |
| `apps/worker/src/worker/templates/property/teal/teal_report.jinja2` | Teal |
| `apps/worker/src/worker/templates/property/bold/bold_report.jinja2` | Bold |

### Database

| File | What It Stores |
|------|----------------|
| `db/migrations/0034_property_reports.sql` | `property_reports` table — `sitex_data` JSONB column caches the full SiteX response |
| `db/migrations/0038_mobile_reports.sql` | `property_data` JSONB for mobile reports |

### Tests & Scripts

| File | Purpose |
|------|---------|
| `scripts/test_sitex.py` | Smoke test against live SiteX API (714 Vine St, Anaheim, CA 92805) |
| `scripts/test_property_report_flow.py` | End-to-end property report flow test |

---

## Testing & Validation

### Test SiteX Connection

```bash
# Requires SITEX_CLIENT_ID, SITEX_CLIENT_SECRET, SITEX_FEED_ID in .env
python scripts/test_sitex.py
```

Expected output: Full property data for 714 Vine St, Anaheim, CA 92805.

### Test Full Property Report Flow

```bash
# Requires all SiteX + SimplyRETS + Google Maps env vars
python scripts/test_property_report_flow.py
```

### Verify Google Maps API Key

Check that all required Google Maps services are enabled in the Google Cloud Console:
1. Maps JavaScript API
2. Places API
3. Geocoding API
4. Maps Static API
5. Street View Static API

---

## Diagrams

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│                                                                          │
│  ┌──────────────┐    address     ┌──────────────┐                       │
│  │ Google Places │ ──────────► │ Property       │                       │
│  │ Autocomplete  │   components  │ Wizard UI     │                       │
│  └──────────────┘               └──────┬────────┘                       │
│                                        │ POST /v1/property/search        │
│                                        ▼                                 │
├────────────────────────────────────────────────────────────────────────── │
│                              API (FastAPI)                                │
│                                                                          │
│  ┌──────────────┐   lookup_     ┌──────────────┐                        │
│  │ property.py   │ ──property()─► │ sitex.py     │                       │
│  │ (routes)      │               │ (service)     │                       │
│  └──────┬───────┘               └──────┬────────┘                       │
│         │                              │ OAuth2 + GET /realestatedata/    │
│         │                              ▼                                 │
│         │                       ┌──────────────┐                        │
│         │                       │ SiteX Pro     │ (External API)         │
│         │                       │ REST API      │                        │
│         │                       └──────┬────────┘                       │
│         │                              │ PropertyData                    │
│         │ ◄────────────────────────────┘                                │
│         │ returns property data to frontend                              │
│         ▼                                                                │
├──────────────────────────────────────────────────────────────────────────┤
│                              WORKER (Celery)                             │
│                                                                          │
│  ┌──────────────┐   sitex_data  ┌──────────────┐                       │
│  │ property_     │ ────────────► │ Google Maps   │                       │
│  │ builder.py    │   lat/lng     │ APIs          │                       │
│  │               │               │ • Geocoding   │                       │
│  │               │               │ • Street View │                       │
│  │               │   image URLs  │ • Static Maps │                       │
│  │               │ ◄──────────── │               │                       │
│  └──────┬───────┘               └──────────────┘                        │
│         │ HTML + embedded images                                         │
│         ▼                                                                │
│  ┌──────────────┐               ┌──────────────┐                        │
│  │ PDFShift      │ ─── PDF ──► │ Cloudflare R2  │                       │
│  └──────────────┘               └──────────────┘                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Coordinate Resolution Chain

```
SiteX PropertyData.latitude / longitude
        │
        ├── Valid (non-zero) ──► Use directly for all map images
        │
        └── Zero / null ──► Google Geocoding API fallback
                                    │
                                    ├── Success ──► Use geocoded coords
                                    │
                                    └── Failure ──► No map images
                                                    (template shows placeholder)
```
