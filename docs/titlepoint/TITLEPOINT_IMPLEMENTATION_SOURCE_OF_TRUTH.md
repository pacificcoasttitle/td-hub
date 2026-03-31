# TitlePoint Implementation Source Of Truth

## Overview
This is the canonical current-state document for TitlePoint in `td-hub`.

TitlePoint is fully operational in production for:

- pre-init legal vesting
- pre-init tax
- post-order geo
- image generation for geo, tax, and legal vesting
- grant deed retrieval
- S3 document storage
- SoftPro document attachment

This document replaces old plan docs, drifted call notes, and partially correct investigation writeups. Supporting evidence lives in separate docs, but this file is the final implementation truth.

## Final Working Flows

### Pre-init legal vesting
- Runs before order creation.
- Uses `CreateService4` with `GET` and an encoded query string.
- Uses `GetRequestSummaries` to poll.
- Uses `GetResultByID` to fetch the legal vesting result.
- Persists LV result data for later document generation and grant deed selection.

### Pre-init tax
- Runs before order creation.
- Uses `CreateService3` with `GET` and an encoded query string.
- Uses service type `TitlePoint.Geo.Tax`.
- Uses `GetRequestSummaries` to poll.
- Uses `GetResultByID3` with `GET`.
- Pre-init is tax + legal vesting only. Pre-init is not geo.

### Post-order geo
- Runs after order creation.
- Uses `CreateService3` with `POST` and a raw form body that ends with a trailing `&`.
- Result retrieval is the legacy dual-call flow:
  1. `GET` raw XML for archival
  2. `POST` the same params for parsed handling
- The raw XML archival step is intentional and current.

### Image generation
- Used for geo, tax, and legal vesting documents.
- Sequence is fixed:
  1. `CreateRequest3`
  2. `GetRequestStatus`
  3. `GetGeneratedImage`
- Runtime only uploads a PDF after the image status is actually ready and base64 data is present.
- Inline execution replaced the dead queue dependency for this workflow. The retry and create-order routes now run the working inline pipeline instead of relying on an unconsumed poll worker.

### Grant deed retrieval
- Grant deed is a document retrieval flow, not a search flow.
- It starts from the completed legal vesting result.
- It extracts deed candidates from the LV result payload.
- It normalizes the instrument number into the document ID used by TitlePoint.
- It calls `GetDocumentsByParameters3`.
- It decodes the returned PDF body and uploads that PDF as the grant deed document.
- Failed grant deed retries now call `fetchGrantDeed()` directly from the latest completed legal vesting row. Grant deed does not go through the generic create/poll/result/image pipeline.

## Final Endpoint Contract Table

| Endpoint | Flow | Method | Wire shape | Final runtime behavior |
|---|---|---|---|---|
| `CreateService4` | Pre-init legal vesting | `GET` | encoded query string | Creates the LV request before order creation |
| `CreateService3` | Pre-init tax | `GET` | encoded query string | Creates the tax request before order creation |
| `GetRequestSummaries` | Polling | `GET` | encoded query string | Used by pre-init and inline post-order flows |
| `GetResultByID` | LV result fetch | `GET` | encoded query string | Used only for legal vesting |
| `GetResultByID3` | Tax result fetch | `GET` | encoded query string | Tax flow is locked to legacy-faithful `GET` |
| `CreateService3` | Post-order geo create | `POST` | raw `application/x-www-form-urlencoded` body with trailing `&` | Creates geo after order creation |
| `GetResultByID3` | Geo result fetch | `GET` then `POST` | GET raw XML archival, then POST raw parse call | This dual-call flow is current and intentional |
| `CreateRequest3` | Image request | `POST` | raw form body with trailing `&` | Starts PDF generation for geo/tax/LV |
| `GetRequestStatus` | Image readiness poll | `POST` | raw form body with trailing `&` | Checked before `GetGeneratedImage` |
| `GetGeneratedImage` | Image fetch | `POST` | raw form body with trailing `&` | Returns base64 PDF for geo/tax/LV |
| `GetDocumentsByParameters3` | Grant deed retrieval | `POST` | raw form body with trailing `&` and a single `parameters` field | Returns the grant deed PDF body |

## Final Parser Roots Actually Used In Runtime

| Runtime path | Parser root(s) used |
|---|---|
| Create responses | `CreateAsynchServicesReturn` |
| Poll responses | `GetRequestSummariesReturn` |
| LV result fetch | `GetResultReturn` |
| Image status | `GenerateImageRequestStatusReturn` |
| Generated image fetch | `GenerateImageData` |
| Grant deed document fetch | `GetDocumentReturn` with `ImageResult` fallback |

### Final parser-root facts
- `CreateAsynchServicesReturn` is the live create root used in runtime.
- `GetRequestSummariesReturn` is the live polling root used in runtime.
- `GetResultReturn` is the live LV result root used in runtime.
- `GenerateImageRequestStatusReturn` is the image status root used in runtime.
- `GenerateImageData` is the generated image root used in runtime.
- `ImageResult` remains a supported parser root for grant deed fallback compatibility.
- `GetDocumentReturn` is the live grant deed root now used in production runtime.

## Final Document Generation And Storage Behavior

- Geo, tax, and legal vesting PDFs are generated through the image flow.
- Grant deed PDFs are retrieved through `GetDocumentsByParameters3`.
- All generated PDFs are uploaded through the shared document service.
- `documents.storage_key` stores the S3 object path.
- Document categories used in runtime are:
  - `general` for geo
  - `tax`
  - `legal_vesting`
  - `grant_deed`
- After upload, documents are attached to SoftPro through `AddDocuments` using pre-signed S3 URLs.

## Final Confirmation And Side-Effect Behavior

- `maybeEnqueueConfirmation()` only enqueues the confirmation event after all required TitlePoint document flows are completed.
- Required completed search types are:
  - `legal_vesting`
  - `tax`
  - `grant_deed`
- `grant_deed` completion is required for the confirmation outbox event.
- Legal vesting completion also triggers the dedicated grant deed fetch path.

## Final Behavioral Truths

- The password `#` issue was config-only and is resolved.
- The correct environment form is `TP_PASSWORD='AlphaOmega637#'`.
- GET wires encode the password as `%23`.
- POST raw bodies send the literal `#`.
- Pre-init is tax + legal vesting only.
- Geo uses `GET` raw XML archival + `POST` parsed handling.
- Grant deed is a document retrieval flow, not a search flow.
- Grant deed request and parse behavior is aligned with the final runtime implementation.
- Tax service type is locked to `TitlePoint.Geo.Tax`.
- Inline execution replaced the dead queue dependency for the working document workflow.

## Key Lessons Learned

- The original blocker was not one bug. It was a chain: contract drift, env parsing, parser-root mismatch, dead queue dependency, and one bad grant deed retry path.
- Do not treat TitlePoint like a clean, uniform API. Each endpoint has its own transport, parameter order, and parser root.
- Live XML matters more than abstractions. Root assumptions broke real vendor responses.
- Grant deed must stay on its own retrieval flow. It is not interchangeable with the generic search/image pipeline.
- Old planning docs are useful as evidence only. They are not implementation truth.

## Primary Evidence And Supporting Docs

### Canonical current-state docs
- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`
- `docs/titlepoint/TITLEPOINT_DEBUG_TIMELINE_2026-03.md`
- `docs/titlepoint/TITLEPOINT_TAX_CALLS_REFERENCE.md`
- `docs/titlepoint/TITLEPOINT_GRANT_DEED_CALL_AND_RETRIEVAL.md`

### Supporting evidence and reference docs
- `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`
- `scripts/test-titlepoint-payloads.ts`

### Archived stale docs
- `docs/titlepoint/archive/TITLEPOINT_TD_HUB_IMPLEMENTATION_CHECKLIST.md`
- `docs/titlepoint/archive/TitlePoint Legacy Alignment Fix Plan.md`
- `docs/titlepoint/archive/OUR-TITLEPOINT-CALLS.md`
- `docs/titlepoint/archive/cannon-titlepoint.md`

## Non-Blocking Notes

- Grant deed candidate selection still depends on the deed records present in the legal vesting result and the configured vesting doc-type filter.
- That selection behavior is not blocking the working integration. The fetch contract, parser root, retry path, storage path, and SoftPro attachment path are now working.
