# TitlePoint Tax Calls Reference

## Status
This tax document is a supporting reference for the final working tax flow.

Canonical implementation truth lives in:
- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`

## Final Tax Truth
- The tax flow is locked.
- The final tax service type is `TitlePoint.Geo.Tax`.
- Tax is no longer an open contract mystery.
- The working runtime behavior is confirmed in production and in `scripts/test-titlepoint-payloads.ts`.

## Final Tax Flow

### Pre-init create
- Endpoint: `CreateService3`
- Method: `GET`
- Transport: encoded query string
- Service type: `TitlePoint.Geo.Tax`
- Parameters payload: `Tax.APN=...;General.AutoSearchTaxes=true;General.AutoSearchProperty=false`

### Poll
- Endpoint: `GetRequestSummaries`
- Method: `GET`
- Uses `requestId`
- Parser root: `GetRequestSummariesReturn`

### Result fetch
- Endpoint: `GetResultByID3`
- Method: `GET`
- Final effective order:
  - `userID`
  - `password`
  - `company`
  - `department`
  - `titleOfficer`
  - `resultID`
  - `requestingTPXML=true`

## Final Runtime Behavior
- Tax pre-init runs before order creation.
- Tax result data is fetched before the order document pipeline stores the tax PDF.
- Tax PDF generation uses the standard image flow:
  1. `CreateRequest3`
  2. `GetRequestStatus`
  3. `GetGeneratedImage`
- Tax documents are stored in `documents` with category `tax`.
- Tax documents are uploaded to S3 and then attached to SoftPro.

## Final Parser Roots Relevant To Tax
- `CreateAsynchServicesReturn`
- `GetRequestSummariesReturn`
- `GetResultReturn`
- `GenerateImageRequestStatusReturn`
- `GenerateImageData`

## What Was Fixed
- Wrong tax service type was removed.
- The runtime no longer uses `TitlePoint.TaxSearch`.
- Tax result retrieval was kept legacy-faithful as `GET`, not changed to `POST`.
- Image-stage parsing was fixed so tax PDFs only upload after the vendor reports readiness and returns real PDF data.

## Supporting Evidence
- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`
- `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`
- `docs/titlepoint/TITLEPOINT_DEBUG_TIMELINE_2026-03.md`
- `scripts/test-titlepoint-payloads.ts`

## Non-Blocking Note
- There is no blocking tax contract uncertainty left in the current implementation. Any future changes should be treated as vendor-driven changes, not unfinished March 2026 work.
