# TitlePoint Debug Timeline 2026-03

## Purpose
This is the incident / forensic timeline for the March 2026 TitlePoint debugging and reconciliation work.

It exists so nobody has to reconstruct this from chat history, half-correct notes, or stale planning docs.

## Chronology

### 2026-03-26: HTML 403 failures observed

TitlePoint requests were returning HTML instead of XML.

Observed symptoms:

- runtime reported XML parse errors
- `vendor_api_logs` showed HTML responses
- the integration looked broken even when request payloads appeared close to legacy

At this point the repo still contained docs and assumptions that mixed:

- legacy behavior
- td-hub behavior
- unverified theories

### 2026-03-26: "Firewall / WAF" theory identified but not proven

An HTML 403 page suggested FortiWeb / WAF involvement.

That was a plausible theory, but it was not yet sufficient proof of the root cause.

Why it was not enough:

- a bad credential can also trigger a non-XML vendor response
- a malformed request can also produce HTML or non-standard error pages
- the repo was not yet aligned enough with legacy to rule out contract drift

Bottom line:

- WAF was a hypothesis
- not a proven root cause

### 2026-03-26: Legacy drift documented

The TitlePoint integration was audited against legacy PHP.

Findings:

- td-hub had drifted from legacy transport behavior
- td-hub had drifted from legacy parameter ordering and naming
- td-hub had normalized too much
- td-hub treated different TitlePoint endpoints as if they behaved like one clean API

This was wrong.

### 2026-03-26: Legacy evidence extracted into one evidence pack

The legacy source files and sample XML were consolidated into:

- `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`

This evidence pack settled the major contract questions:

- pre-init is tax + LV only
- geo create is post-order
- geo result retrieval is GET raw XML + POST parsed
- grant deed is one `parameters` field
- image flow uses `GetRequestStatus` before `GetGeneratedImage`

### 2026-03-26: Runtime rebuilt to match legacy request contracts

td-hub request transport and ordering were brought into line with the legacy evidence.

At that point:

- credentials still failed
- live vendor validation was still blocked

### 2026-03-26: Real credential bug discovered

The runtime password was inspected directly.

Observed runtime value:

- `AlphaOmega637`

Expected:

- `AlphaOmega637#`

This proved the `#` was being lost before request construction.

This was a config / env parsing problem, not a TitlePoint transport problem.

### 2026-03-26: Wrong attempted env escape rejected

Tried:

- `TP_PASSWORD=AlphaOmega637\#`

Observed runtime value:

- `AlphaOmega637\`

That was still wrong.

### 2026-03-26: Correct env form validated

Changed to:

- `TP_PASSWORD='AlphaOmega637#'`

Fresh runtime verification proved:

- runtime password ended with `#`
- GET wires encoded it as `%23`
- POST raw bodies sent literal `#`

This resolved the credential truncation bug.

### 2026-03-26: Live vendor requests confirmed

With credentials fixed, real TitlePoint requests started returning XML again.

Confirmed live:

- LV pre-init create returned HTTP `200` XML
- `GetRequestSummaries` returned HTTP `200` XML
- LV `GetResultByID` returned HTTP `200` XML
- geo create returned HTTP `200` XML

Tax pre-init also returned XML, but the vendor rejected the service type with:

- `The specified service type, 'TitlePoint.TaxSearch', does not correspond to an available service.`

That is vendor-side behavior, not a parser-root bug.

### 2026-03-26: Live parser-root mismatch discovered

Once real XML was flowing, the next bug became obvious:

td-hub runtime was still reading several live responses as if they rooted at:

- `ServiceResult`

But the live responses were actually:

- create responses -> `CreateAsynchServicesReturn`
- request summaries -> `GetRequestSummariesReturn`
- LV result -> `GetResultReturn`

Because of that mismatch:

- successful create responses were being marked failed
- `ReturnStatus` was coming back empty in runtime
- poll responses were being misread
- LV result fetches were being misread

### 2026-03-26: Surgical parse-root patch applied

The final code patch in this incident changed only the proven live parser roots for:

- create responses
- `GetRequestSummaries`
- LV `GetResultByID`

No transport change was required for that patch.
No request builder change was required for that patch.
No env loader change was required for that patch.

### 2026-03-26: Runtime-backed tests updated

The parser patch was locked down with runtime-backed tests that now prove:

- create parser reads `CreateAsynchServicesReturn`
- poll parser reads `GetRequestSummariesReturn`
- LV result parser reads `GetResultReturn`
- these paths no longer depend on `ServiceResult`

Final test result for the parser patch pass:

- `60 passed, 0 failed`

## Final Takeaways

- The initial HTML failure was real, but "WAF" alone was not enough proof.
- The first fully proven production bug was the truncated password.
- After credentials were fixed, the next fully proven production bug was parser-root drift.
- The TitlePoint problem was not one thing. It was a chain:
  - contract drift
  - credential truncation
  - parser-root mismatch

## Canonical Follow-up Reference

For the current implementation record, use:

- `docs/titlepoint/TITLEPOINT_IMPLEMENTATION_SOURCE_OF_TRUTH.md`

Do not use the archived planning/call-note docs as active implementation truth.
