# TitlePoint Implementation Source Of Truth

## Status
This is the canonical implementation record for TitlePoint in `td-hub`.

It replaces the older planning/checklist/call-note docs that drifted, contradicted each other, or were invalidated by live vendor responses.

## What TitlePoint Does In `td-hub`
TitlePoint is used to:

- run pre-init property searches before order creation
- run post-order geo search after order creation
- retrieve legal vesting result data
- generate PDFs for LV / tax / geo image flows
- fetch grant deed PDFs from deed metadata found in LV results

## Active Flows

| Flow | Purpose | Current transport shape |
|---|---|---|
| Pre-init tax | front-end tax lookup before order creation | GET + encoded query |
| Pre-init legal vesting | front-end LV lookup before order creation | GET + encoded query |
| Post-order geo | create geo search after order creation | POST + raw body with trailing `&` |
| Image generation | generate/download PDFs from service IDs | POST + raw body with trailing `&` |
| Grant deed | fetch deed PDF from normalized doc id | POST + raw body with trailing `&` |

## Primary Evidence

- Legacy evidence pack: `docs/titlepoint/TITLEPOINT_LEGACY_EVIDENCE_PACK.md`
- Debug / incident timeline: `docs/titlepoint/TITLEPOINT_DEBUG_TIMELINE_2026-03.md`
- Runtime-backed contract tests: `scripts/test-titlepoint-payloads.ts`
- Legacy PHP source snapshot in repo: `docs/titlepoint/Titlepoint-legacy.php`

## Exact Endpoint Contract Table

| Endpoint | Flow | Method | Wire shape | Param order | Encoding / trailing `&` | Expected root | Parsed fields | Notes |
|---|---|---|---|---|---|---|---|---|
| `CreateService3` | Post-order geo create | `POST` | raw body | `userID,password,serviceType,parameters,department,orderNo,customerRef,company,titleOfficer,orderComment,starterRemarks,state,county` | raw body, trailing `&` | `CreateAsynchServicesReturn` | `ReturnStatus`, `RequestID`, `OrderID`, `ReturnErrors` | Live-verified 2026-03-26 |
| `CreateService3` | Pre-init tax create | `GET` | encoded query URL | `userID,password,orderNo,customerRef,company,department,titleOfficer,orderComment,starterRemarks,serviceType,parameters,state,county` | encoded query, no trailing `&` | `CreateAsynchServicesReturn` | `ReturnStatus`, `RequestID`, `OrderID`, `ReturnErrors` | Live-verified 2026-03-26; vendor currently rejects `TitlePoint.TaxSearch` |
| `CreateService4` | Pre-init LV create | `GET` | encoded query URL | `userID,password,orderNo,customerRef,company,department,titleOfficer,orderComment,starterRemarks,serviceType,parameters,fipsCode` | encoded query, no trailing `&` | `CreateAsynchServicesReturn` | `ReturnStatus`, `RequestID`, `OrderID`, `ReturnErrors` | Live-verified 2026-03-26 |
| `GetRequestSummaries` | Poll search completion | `GET` | encoded query URL | `userID,password,company,department,titleOfficer,requestId,maxWaitSeconds` | encoded query, no trailing `&` | `GetRequestSummariesReturn` | `ReturnStatus`, `RequestSummaries`, `RequestSummary.Status`, `RequestSummary.Order.ID`, `Service.ID`, `ThumbNails.ResultThumbNail.ID` | Live-verified 2026-03-26 |
| `GetResultByID` | LV result fetch | `GET` | encoded query URL | `userID,password,company,department,titleOfficer,resultID` | encoded query, no trailing `&` | `GetResultReturn` | `ReturnStatus`, `Result`, `Result.ID`, `Result.Status`, `Result.Fips`, `Result.BriefLegal`, `Result.Vesting`, `Result.Apn`, `Result.PropertyAddress`, `Result.LvDeeds.LegalAndVesting2DeedInfo` | Live-verified 2026-03-26 |
| `GetResultByID3` | Tax result fetch | `POST` | raw body | `userID,password,company,department,titleOfficer,requestingTPXML,resultID` | raw body, trailing `&` | `ServiceResult` | `ReturnStatus`, `Result` | Legacy/sample-proven; not re-validated live in this incident |
| `GetResultByID3` | Geo result fetch | `GET` then `POST` | GET raw XML archival, then POST raw parse call | GET: `userID,password,company,department,titleOfficer,requestingTPXML,resultID` / POST same order | GET encoded query; POST raw body with trailing `&` | GET raw XML archival + parsed POST currently expects `ServiceResult` | `ReturnStatus`, `Result` | Geo is the only dual-call result path |
| `CreateRequest3` | Image request | `POST` | raw body | `username,password,serviceId1,serviceId2,source,clientKey1,clientKey2,sortOrder,fileType` | raw body, trailing `&` | `GenerateImageResult` | `ReturnStatus`, `RequestID`, `OrderID` | Legacy/sample-proven |
| `GetRequestStatus` | Image polling | `POST` | raw body | `username,password,requestId` | raw body, trailing `&` | `GenerateImageResult` | `ReturnStatus`, `Status`, `Message` | Called before `GetGeneratedImage` |
| `GetGeneratedImage` | Image fetch | `POST` | raw body | `username,password,requestId` | raw body, trailing `&` | `GenerateImageResult` | `ReturnStatus`, `Status`, `Data` | Image body is `GenerateImageResult.Data` |
| `GetDocumentsByParameters3` | Grant deed | `POST` | raw body | `parameters,username,password,company,department,titleOfficer,pages,propertyOnly,maxPageCount,maxSizeInKB,additionalInfo,customerRef,fileType` | raw body, trailing `&` | `ImageResult` | `Status.Msg`, `Documents.DocumentResponse.DocStatus.Msg`, `Documents.DocumentResponse.Document.Body.Body` | Legacy/sample-proven |

## Proven Response Roots

### Live-verified on 2026-03-26

- `CreateAsynchServicesReturn`
- `GetRequestSummariesReturn`
- `GetResultReturn`

### Legacy/sample-proven and still authoritative unless disproven live

- `GenerateImageResult`
- `ImageResult`

## Proven Live Parser Fix

The runtime bug fixed in this pass was not transport, credentials, or routing.

It was parser root drift.

The live vendor responses for:

- `CreateService3`
- `CreateService4`
- `GetRequestSummaries`
- `GetResultByID`

were being read as if they rooted at `ServiceResult`.

That was wrong for the live responses captured on 2026-03-26.

The parser now reads:

- `CreateAsynchServicesReturn` for create responses
- `GetRequestSummariesReturn` for polling responses
- `GetResultReturn` for LV result responses

There is no fallback root chain for these paths.

## Known Vendor Behavior

### Password `#` issue

The `#` credential bug was configuration-side, not transport-side.

- bad runtime value: `AlphaOmega637`
- bad attempted escape: `AlphaOmega637\`
- correct runtime value: `AlphaOmega637#`
- working env form in this repo: `TP_PASSWORD='AlphaOmega637#'`

Result:

- GET wires now encode the password as `%23`
- POST raw bodies now send literal `#`

### Tax service behavior

Live vendor response on 2026-03-26:

- HTTP `200`
- XML returned
- `ReturnStatus = Failed`
- vendor error: `The specified service type, 'TitlePoint.TaxSearch', does not correspond to an available service.`

This is not a transport bug.
This is not part of the parse-root fix.

### Geo dual-call behavior

Geo result retrieval is not a single request in legacy.

It does:

1. GET raw XML
2. archive raw XML
3. POST same params for parsed processing

Do not collapse that flow unless live vendor validation proves it is safe.

### Pre-init scope

Pre-init is:

- tax
- legal vesting

Pre-init is not geo.

### Grant deed normalization

Grant deed `INST=` normalization follows the legacy rules:

- if instrument contains `-`, split and take the trailing part
- otherwise strip the year prefix
- cast to integer string

Examples:

- `20190298741` -> `298741`
- `15-1611995` -> `1611995`

## Proven Legacy Behavior vs Proven Live Behavior

### Proven legacy behavior

- endpoint transports and param ordering from the legacy PHP files
- image flow sequence: `CreateRequest3 -> GetRequestStatus -> GetGeneratedImage`
- grant deed single `parameters` field
- geo dual-call result retrieval

### Proven live behavior

- credentials now reach TitlePoint intact
- pre-init LV create reaches TitlePoint and returns XML
- `GetRequestSummaries` reaches TitlePoint and returns XML
- LV `GetResultByID` reaches TitlePoint and returns XML
- geo create reaches TitlePoint and returns XML
- live create/poll/LV-result roots differ from the old `ServiceResult` parser assumption

## Open Questions / Vendor-Side Unknowns

- Why the vendor currently rejects `TitlePoint.TaxSearch` for this account or environment.
- Whether live `GetResultByID3` responses still root at `ServiceResult` for tax and geo in the current production account; this was not re-validated live in the final parser patch pass.
- Whether image endpoints and grant deed endpoints still match their legacy/sample roots exactly in current production; they were not re-validated live in this incident after the credential fix.

## Archived Docs

The following docs were archived because they were useful during investigation but are not safe as active source-of-truth documents anymore:

- `docs/titlepoint/archive/OUR-TITLEPOINT-CALLS.md`
- `docs/titlepoint/archive/TITLEPOINT_TD_HUB_IMPLEMENTATION_CHECKLIST.md`
- `docs/titlepoint/archive/TitlePoint Legacy Alignment Fix Plan.md`
