# TitlePoint Grant Deed Call And Retrieval

## Status
This is the supporting reference for the final working grant deed flow.

Canonical implementation truth lives in:
- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`

## Final Grant Deed Truth
- Grant deed is a document retrieval flow.
- Grant deed is not a search flow.
- Grant deed is not part of the generic create/poll/result/image pipeline.
- The fetch contract is aligned with the final runtime implementation.

## Final Runtime Flow
1. A completed legal vesting row provides deed history in `metadata.resultData`.
2. The runtime extracts deed candidates from the LV result.
3. It chooses the candidate deed using the configured filter behavior.
4. It normalizes the instrument number into the TitlePoint document ID.
5. It calls `GetDocumentsByParameters3`.
6. It parses the returned document response and extracts the PDF body.
7. It uploads that PDF as the `grant_deed` document.
8. It attaches the uploaded document to SoftPro.

## Final Fetch Contract

### Endpoint
- `TpsImage.asmx/GetDocumentsByParameters3`

### Method
- `POST`

### Request shape
- raw `application/x-www-form-urlencoded` body
- trailing `&`
- one single `parameters` field

### Final parameter order
- `parameters`
- `username`
- `password`
- `company`
- `department`
- `titleOfficer`
- `pages`
- `propertyOnly`
- `maxPageCount`
- `maxSizeInKB`
- `additionalInfo`
- `customerRef`
- `fileType`

### Final parameters payload
- `FIPS={fips},TYPE=REC,SUBTYPE=ALL,YEAR={year},INST={docId}`

## Final Parser Behavior
- Live production grant deed responses use `GetDocumentReturn`.
- Runtime now parses `GetDocumentReturn` first.
- Runtime keeps `ImageResult` as fallback compatibility.
- Parsed fields are:
  - `Status.Msg`
  - `Documents.DocumentResponse.DocStatus.Msg`
  - `Documents.DocumentResponse.Document.Body.Body`

## What Was Fixed
- Runtime grant deed parsing was corrected to accept the live `GetDocumentReturn` root.
- Failed grant deed retries no longer run through `initiateSearch()`.
- Failed grant deed retries now call `fetchGrantDeed()` directly from the latest completed legal vesting row.
- The generic inline pipeline now rejects `grant_deed` rows so the wrong PDF cannot be regenerated through the image pipeline.

## Legacy Selection Behavior
- Candidate deed selection comes from LV deed records.
- The code still mirrors the legacy pattern:
  - gather deed records from the LV result
  - optionally filter by configured deed types
  - use the first filtered match, or fall back to the first available deed

## Current td-hub Match
- td-hub now matches the final runtime contract for:
  - dedicated grant deed retrieval path
  - normalized `INST` parameter handling
  - raw request wire shape
  - parser root handling
  - document upload and SoftPro attachment

## Candidate Selection Nuance
- Candidate selection still depends on what deed records the LV result returns and whether the vesting document-type filter is enabled.
- That nuance is real but non-blocking.
- The fetch and retrieval contract itself is no longer unresolved.

## Supporting Evidence
- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`
- `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`
- `docs/titlepoint/TITLEPOINT_DEBUG_TIMELINE_2026-03.md`
- `scripts/test-titlepoint-payloads.ts`
