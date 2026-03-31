# TitlePoint Debug Timeline 2026-03

## Purpose
This is the final forensic timeline for the March 2026 TitlePoint investigation and repair work.

It records what actually broke, what we proved, what false leads were ruled out, and how the integration reached its final operational state.

## Timeline

### 2026-03-26: Initial failure state
- Production requests were returning HTML instead of XML.
- Runtime surfaced XML parse errors.
- `vendor_api_logs` showed HTML error pages instead of TitlePoint XML.
- The integration was not yet trustworthy enough to tell whether the problem was transport, credentials, parsing, or vendor-side blocking.

### 2026-03-26: False lead ruled out
- The FortiWeb / WAF theory looked plausible because the response was HTML.
- It was not enough proof by itself.
- At that point a malformed request or truncated credential could still explain the same symptom.

### 2026-03-26: Legacy contract extraction
- The legacy PHP implementation was treated as the source of truth.
- The evidence was consolidated into `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`.
- That evidence settled the contract that mattered:
  - pre-init is tax + legal vesting only
  - geo create is post-order
  - geo result is GET raw XML archival + POST parsed handling
  - image flow is `CreateRequest3 -> GetRequestStatus -> GetGeneratedImage`
  - grant deed uses `GetDocumentsByParameters3` with a single `parameters` field

### 2026-03-26: Credential breakthrough
- Runtime password inspection proved the environment loader was truncating `TP_PASSWORD` at `#`.
- Wrong runtime value: `AlphaOmega637`
- Correct value: `AlphaOmega637#`
- The fix was configuration only: `TP_PASSWORD='AlphaOmega637#'`
- After that:
  - GET wires encoded `%23`
  - POST raw bodies sent literal `#`
  - real TitlePoint XML started coming back again

### 2026-03-26: Live parser-root breakthrough
- Once XML was flowing, the next bug was obvious: runtime parsing was reading the wrong roots.
- Proven live roots:
  - `CreateAsynchServicesReturn`
  - `GetRequestSummariesReturn`
  - `GetResultReturn`
- Old assumptions around `ServiceResult` were wrong for the live responses we captured.
- Fixing those roots moved the working flows forward without changing transport again.

### 2026-03-26 through 2026-03-31: Tax breakthrough
- Tax was not a generic parser problem after the credential fix.
- Live vendor output explicitly rejected `TitlePoint.TaxSearch`.
- The tax service type was corrected and locked to `TitlePoint.Geo.Tax`.
- Tax result retrieval was kept legacy-faithful as `GetResultByID3` over `GET`.
- The tax flow is now operational and no longer an open contract debate.

### 2026-03-31: Image-stage breakthrough
- The pipeline then failed at image readiness because runtime still expected the wrong roots for image status and image data.
- The working runtime roots were corrected to:
  - `GenerateImageRequestStatusReturn`
  - `GenerateImageData`
- Readiness checks were added so upload only happens after the vendor reports ready and actual image data exists.

### 2026-03-31: Dead queue dependency removed
- The repo was creating `titlepoint.poll` jobs but production was not consuming them.
- That left rows stuck in `pending` and `processing`.
- The working fix was to run the create/poll/result/image pipeline inline in the request path and use the jobs table for observability instead of as the primary execution engine.
- This replaced the dead queue dependency for the working workflow.

### 2026-03-31: Grant deed fetch breakthrough
- Grant deed was confirmed to be a different kind of flow:
  - not a search flow
  - not an image-generation flow
  - a document retrieval flow based on LV deed metadata
- The live vendor response for `GetDocumentsByParameters3` used `GetDocumentReturn`.
- Runtime grant deed parsing was updated to accept `GetDocumentReturn` with `ImageResult` kept as fallback.

### 2026-03-31: Grant deed retry-path bug found and fixed
- A later failure showed `grant_deed` retries were being routed through the generic create/poll/result/image pipeline.
- That produced the wrong document under the `grant_deed` category.
- The final fix was narrow:
  - `grant_deed` retries now bypass `initiateSearch()`
  - retries use `fetchGrantDeed()` directly from the latest completed LV row
  - the generic inline pipeline now refuses to run `grant_deed`

### Final operational state
- Pre-init legal vesting works.
- Pre-init tax works.
- Post-order geo works.
- Geo, tax, and legal vesting PDF generation works.
- Grant deed retrieval works through the dedicated document-retrieval path.
- Generated documents upload to S3 and attach to SoftPro.
- Confirmation queuing is intentionally gated on completed `legal_vesting`, `tax`, and `grant_deed`.

## Final Takeaways
- The failure chain was real and layered:
  - contract drift
  - credential truncation
  - parser-root mismatch
  - dead queue dependency
  - wrong retry routing for grant deed
- The fix was not one big rewrite. It was a sequence of small, proven corrections backed by legacy evidence and live runtime behavior.
- TitlePoint should be maintained as endpoint-specific flows, not as one abstract “clean” client.

## Canonical Current-State Reference
- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`

## Supporting Evidence
- `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`
- `docs/titlepoint/TITLEPOINT_TAX_CALLS_REFERENCE.md`
- `docs/titlepoint/TITLEPOINT_GRANT_DEED_CALL_AND_RETRIEVAL.md`
- `scripts/test-titlepoint-payloads.ts`
