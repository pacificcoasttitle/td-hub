# TD Hub vNext — Exact TitlePoint API Calls

**Date:** March 26, 2026
**Purpose:** Document every TitlePoint call we make so it can be compared against the legacy PHP system.
**Status:** All calls currently return HTTP 403 (FortiWeb WAF block) from both Vercel and local.

---

## Transport Layer (http.ts)

**CURRENT (as of this commit — CHANGED from previous):**
- **HTTP Method:** GET
- **Parameters:** All params in the query string (no body)
- **Content-Type:** None (GET has no body)
- **URL format:** `https://www.titlepoint.com/TitlePointServices/{endpoint}?{key=value&key=value&}`
- **Encoding:** NO URL-encoding of values. Spaces, semicolons, etc. are sent raw.
- **Implementation:** Raw TLS socket (because Node.js rejects unescaped characters in URLs)
- **Trailing ampersand:** Yes, every query string ends with `&`

**PREVIOUS (before this commit — what was deployed and got 403):**
- **HTTP Method:** POST
- **Content-Type:** `application/x-www-form-urlencoded`
- **Body:** `key=value&key=value&` (same format, but in the POST body instead of query string)
- **Note:** This POST approach worked on March 16 (HTTP 200) but started returning 403 around March 25-26.

**UNKNOWN — what we need from legacy:**
- Does `$this->CI->order->curl_post($url, $paramsArray)` send POST or GET?
- Does it pass the PHP array directly to `CURLOPT_POSTFIELDS` (→ multipart/form-data)?
- Or does it call `http_build_query($params)` first (→ application/x-www-form-urlencoded string)?
- Does it set any custom headers?
- Does it disable SSL verification? (legacy has `verify_peer => false`)
- The `curl_post` function is in `application/libraries/order/Order.php` — we don't have it.

---

## Credentials

```
TP_USERNAME = PCTXML01
TP_PASSWORD = AlphaOmega637
TP_BASE_URL = https://www.titlepoint.com/TitlePointServices/
```

Credentials are sent as params (either query string or body), NOT as HTTP headers.

---

## CALL 1: CreateService3 — Geo Address Search

**When:** After order is created, to get property/document records.
**Legacy PHP function:** `generateGeoDoc()` in `Titlepoint.php` line 436
**Legacy PHP endpoint constant:** `TP_GEO_CREATE_SERVICE_URL = TpsService.asmx/CreateService3?`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService3
```

### Our Parameters (in order)
```
userID=PCTXML01
password=AlphaOmega637
serviceType=TitlePoint.Geo.Address
parameters=Address.FullAddress=1358 5th St;General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False;General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False;General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;
department=
orderNo=
customerRef=51
company=
titleOfficer=
orderComment=
starterRemarks=
state=CA
county=LOS ANGELES
```

### Legacy PHP Parameters (from Titlepoint.php line 464-481)
```php
$requestParams = array(
    'userID' => env('TP_USERNAME'),          // PCTXML01
    'password' => env('TP_PASSWORD'),        // AlphaOmega637
    'serviceType' => TP_GEO_SERVICE_TYPE,    // TitlePoint.Geo.Address
    'parameters' => $parameters,             // Address.FullAddress=1358 5th St;General.AutoSearchTaxes=False;...
    'department' => '',
    'orderNo' => '',
    'customerRef' => '',
    'company' => '',
    'titleOfficer' => '',
    'orderComment' => '',
    'starterRemarks' => '',
    'state' => $state,                       // CA
    'county' => $county,                     // LOS ANGELES (or "Los Angeles"?)
);
```

### Differences to check:
1. **customerRef:** We send the order ID (e.g. "51"). Legacy sends empty string `''`.
2. **county casing:** We send whatever is in the database. Legacy sends whatever the form provides. Is it "LOS ANGELES" or "Los Angeles"?
3. **Parameter order:** Ours matches the legacy array order.

---

## CALL 2: CreateService4 — Legal Vesting Search

**When:** After order is created, to get legal description + vesting.
**Legacy PHP function:** Called from the frontend AJAX controller, NOT from `Titlepoint.php` directly (pre-order). The library's post-order flow calls `generateImg()` which uses the serviceId from the pre-order call.
**Legacy endpoint:** `TP_CREATE_SERVICE_ENDPOINT = TpsService.asmx/CreateService4`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService4
```

### Our Parameters (in order)
```
userID=PCTXML01
password=AlphaOmega637
serviceType=TitlePoint.LegalAndVesting2
parameters=FIPS=06037;APN=8381-021-001;Address1=1358 5th St;City=La Verne
department=
orderNo=
customerRef=51
company=
titleOfficer=
orderComment=
starterRemarks=
fipsCode=06037
```

### Differences to check:
1. **No `state` or `county` param** — CreateService4 uses `fipsCode` instead. This matches the legacy.
2. **`fipsCode` param is at the END** — does the legacy put it somewhere else in the array?
3. **FIPS is also inside `parameters` string** as `FIPS=06037` — is this redundant with the top-level `fipsCode`?
4. **customerRef:** We send order ID. Legacy sends empty string for pre-order calls.
5. The legacy frontend AJAX controller for CreateService4 is NOT in `Titlepoint.php` — it's in `application/modules/frontend/controllers/order/TitlePoint.php`. We don't have that file.

---

## CALL 3: CreateService3 — Tax Search

**When:** Pre-order (AJAX) or after order to get tax data.
**Legacy PHP function:** Called from frontend AJAX controller (pre-order), not from `Titlepoint.php`.
**Legacy endpoint:** `TP_TAX_INSTRUMENT_CREATE_SERVICE_ENDPOINT = TpsService.asmx/CreateService3`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService3
```

### Our Parameters (in order)
```
userID=PCTXML01
password=AlphaOmega637
serviceType=TitlePoint.TaxSearch
parameters=APN=8381-021-001;Property.AutoSearchTaxes=True;Property.AutoSearchProperty=True
department=
orderNo=
customerRef=51
company=
titleOfficer=
orderComment=
starterRemarks=
state=CA
county=LOS ANGELES
```

### Differences to check:
1. **The Tax CreateService is called from the frontend AJAX controller** — we don't have that file. The parameter order and names may differ.
2. **customerRef:** We send order ID. Legacy probably sends empty for pre-order.

---

## CALL 4: GetRequestSummaries — Poll for completion

**When:** After CreateService returns a RequestID, poll until status = Complete.
**Legacy PHP function:** `getGeoImageRequestStatus()` in `Titlepoint.php` line 1428
**Legacy endpoint constant:** `TP_GEO_REQUEST_SUMMARY_URL = TpsService.asmx/GetRequestSummaries?`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsService.asmx/GetRequestSummaries
```

### Our Parameters
```
userID=PCTXML01
password=AlphaOmega637
requestID={the RequestID from CreateService response}
company=
department=
titleOfficer=
maxWaitSeconds=15
```

### Legacy PHP Parameters (from Titlepoint.php line 1431-1438)
```php
$requestParams = array(
    'userID' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'company' => '',
    'department' => '',
    'titleOfficer' => '',
    'requestId' => $requestId,       // NOTE: lowercase 'd' in 'requestId'
    'maxWaitSeconds' => '20',        // Legacy uses 20, we use 15
);
```

### Differences to check:
1. **Parameter name:** Legacy uses `requestId` (lowercase d). We use `requestID` (uppercase D). **THIS COULD BE A PROBLEM.**
2. **maxWaitSeconds:** Legacy uses `'20'`. We use `'15'`.
3. **Parameter order:** Legacy puts `requestId` AFTER company/department/titleOfficer. We put `requestID` BEFORE them.

---

## CALL 5: GetResultByID3 — Fetch actual result data

**When:** After GetRequestSummaries returns Complete with a ServiceID/ResultID.
**Legacy PHP function:** `generateGeoDocument()` in `Titlepoint.php` line 1147
**Legacy endpoint constant:** `TP_GEO_GET_RESULT_URL = TpsService.asmx/GetResultByID3?`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsService.asmx/GetResultByID3
```

### Our Parameters
```
userID=PCTXML01
password=AlphaOmega637
resultID={the ResultID from GetRequestSummaries}
requestingTPXML=true
company=
department=
titleOfficer=
```

### Legacy PHP Parameters (from Titlepoint.php line 1150-1157)
```php
$requestParams = array(
    'userID' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'company' => '',
    'department' => '',
    'titleOfficer' => '',
    'requestingTPXML' => "true",
    'resultID' => $resultId,
);
```

### Differences to check:
1. **Parameter order:** Legacy puts company/department/titleOfficer BEFORE requestingTPXML and resultID. We put them AFTER.
2. **IMPORTANT:** Legacy `generateGeoDocument()` ALSO calls `file_get_contents($request)` (GET) separately to save the raw XML — then calls `curl_post` for JSON parsing. So GetResultByID3 is called TWICE in legacy for geo documents.

---

## CALL 6: CreateRequest3 — Request PDF Generation (LV / Tax / Geo images)

**When:** After getting result data, to generate a PDF.
**Legacy PHP function:** `generateImg()` line 26, `generateTaxDoc()` line 287, `generateGeoImg()` line 643
**Legacy endpoint:** `TP_IMAGE_ENDPOINT = TpsGenerateImage.asmx/CreateRequest3`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsGenerateImage.asmx/CreateRequest3
```

### Our Parameters
```
username=PCTXML01
password=AlphaOmega637
serviceId1={the ServiceID}
fileType=pdf
source=
clientKey1=
clientKey2=
sortOrder=
serviceId2=
serviceId3=
serviceId4=
serviceId5=
```

### Legacy PHP Parameters (from Titlepoint.php line 39-49)
```php
$requestParams = array(
    'username' => env('TP_USERNAME'),    // NOTE: 'username' not 'userID'
    'password' => env('TP_PASSWORD'),
    'serviceId1' => $serviceId,
    'serviceId2' => '',
    'source' => '',
    'clientKey1' => '',
    'clientKey2' => '',
    'sortOrder' => '',
    'fileType' => 'pdf',
);
```

### Differences to check:
1. **Auth param name:** `username` (not `userID`). Both legacy and ours use `username` here. ✓
2. **We send extra params:** `serviceId3`, `serviceId4`, `serviceId5`. Legacy does NOT send these.
3. **Parameter order:** Legacy puts `fileType` LAST. We also put it in a different position.
4. **Legacy does NOT send `serviceId3`, `serviceId4`, `serviceId5`** — we do.

---

## CALL 7: GetGeneratedImage — Download generated PDF

**When:** After CreateRequest3, poll/fetch the generated image.
**Legacy PHP function:** `generateImage()` line 976, `generateTaxImage()` line 1085
**Legacy endpoint:** `TP_GENERATE_IMAGE = TpsGenerateImage.asmx/GetGeneratedImage`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsGenerateImage.asmx/GetGeneratedImage
```

### Our Parameters
```
username=PCTXML01
password=AlphaOmega637
requestID={the RequestID from CreateRequest3}
```

### Legacy PHP Parameters (from Titlepoint.php line 979-983)
```php
$requestParams = array(
    'username' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'requestId' => $requestId,         // NOTE: lowercase 'd' in 'requestId'
);
```

### Differences to check:
1. **Parameter name:** Legacy uses `requestId` (lowercase d). We use `requestID` (uppercase D). **SAME ISSUE AS CALL 4.**

---

## CALL 8: GetDocumentsByParameters3 — Grant Deed PDF

**When:** After LV result provides instrumentNumber + recordedDate + FIPS.
**Legacy PHP function:** `generateGrantDeed()` line 188
**Legacy endpoint:** `GRANT_DEED_ENDPOINT = TpsImage.asmx/GetDocumentsByParameters3`

### Our URL
```
https://www.titlepoint.com/TitlePointServices/TpsImage.asmx/GetDocumentsByParameters3
```

### Our Parameters
```
userID=PCTXML01
password=AlphaOmega637
fIPSCode=06037
searchType=REC
searchSubType=ALL
year=2020
instrumentNumber=123456
book=
page=
fileType=PDF
```

### Legacy PHP Parameters (from Titlepoint.php line 209-223)
```php
$requestParams = array(
    'parameters' => 'FIPS=06037,TYPE=REC,SUBTYPE=ALL,YEAR=2020,INST=123456',
    'username' => env('TP_USERNAME'),    // NOTE: 'username' not 'userID'
    'password' => env('TP_PASSWORD'),
    'company' => '',
    'department' => '',
    'titleOfficer' => '',
    'pages' => '',
    'propertyOnly' => 'FALSE',
    'maxPageCount' => 0,
    'maxSizeInKB' => 0,
    'additionalInfo' => '',
    'customerRef' => '',
    'fileType' => 'PDF',
);
```

### Differences — MAJOR:
1. **Completely different parameter format.** Legacy uses a single `parameters` field with comma-separated values (`FIPS=06037,TYPE=REC,SUBTYPE=ALL,YEAR=2020,INST=123456`). We use separate params (`fIPSCode`, `searchType`, `searchSubType`, `year`, `instrumentNumber`).
2. **Auth param name:** Legacy uses `username`. We use `userID`. **BUG.**
3. **Legacy sends extra params we don't:** `company`, `department`, `titleOfficer`, `pages`, `propertyOnly`, `maxPageCount`, `maxSizeInKB`, `additionalInfo`, `customerRef`.
4. **Legacy does NOT send:** `fIPSCode`, `searchType`, `searchSubType`, `year`, `instrumentNumber`, `book`, `page` as separate params.

---

## CALL 9: GetRequestStatus — Check PDF generation status (image endpoints)

**Legacy PHP function:** `getImageRequestStatus()` line 929, `getTaxImageRequestStatus()` line 1040
**Legacy endpoint:** `TP_IMAGE_REQUEST_STATUS = TpsGenerateImage.asmx/GetRequestStatus`

### Legacy PHP Parameters
```php
$requestParams = array(
    'username' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'requestId' => $requestId,         // lowercase 'd'
);
```

### Our implementation:
We do NOT call GetRequestStatus separately. Instead, we poll GetGeneratedImage directly and check its Status field. The legacy calls GetRequestStatus FIRST, and only calls GetGeneratedImage when status is Success.

---

## Summary of ALL Differences Found

| # | Issue | Our Code | Legacy PHP | Severity |
|---|-------|----------|-----------|----------|
| 1 | **HTTP transport** | Currently GET (previously POST). We don't know what `curl_post` actually does. | `$this->CI->order->curl_post($url, $params)` — unknown internals | **BLOCKING — need curl_post source** |
| 2 | **`requestId` vs `requestID`** | We use uppercase D: `requestID` | Legacy uses lowercase d: `requestId` | **HIGH — may cause "invalid request" errors** |
| 3 | **Grant Deed params** | Separate params: `fIPSCode`, `searchType`, etc. | Single `parameters` field: `FIPS=x,TYPE=REC,...` | **HIGH — completely wrong format** |
| 4 | **Grant Deed auth** | `userID` | `username` | **HIGH — wrong credential param name** |
| 5 | **Extra image params** | We send `serviceId3`, `serviceId4`, `serviceId5` | Legacy does NOT send these | Medium |
| 6 | **Missing GetRequestStatus step** | We skip it, go straight to GetGeneratedImage | Legacy polls GetRequestStatus first | Medium |
| 7 | **maxWaitSeconds** | `'15'` | `'20'` | Low |
| 8 | **customerRef** | Order ID | Empty string (pre-order) | Low |
| 9 | **Parameter order** | Varies from legacy | See each call above | Unknown impact |
| 10 | **Grant Deed missing params** | Missing: company, department, titleOfficer, pages, propertyOnly, maxPageCount, maxSizeInKB, additionalInfo, customerRef | All present in legacy | **HIGH** |

---

## What We Need

1. **The `curl_post` function source** from `application/libraries/order/Order.php` — this tells us POST vs GET, Content-Type, encoding, everything.
2. **The frontend TitlePoint controller** (`application/modules/frontend/controllers/order/TitlePoint.php`) — this has the CreateService3 (Tax) and CreateService4 (LV) pre-order AJAX calls that we're trying to replicate.
3. Confirmation: is the parameter name `requestId` (lowercase d) or `requestID` (uppercase D) for GetRequestSummaries and GetGeneratedImage?
