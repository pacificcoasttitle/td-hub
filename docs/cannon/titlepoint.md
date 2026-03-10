# TitlePoint (DataTrace/TPS) Integration

## Overview
Title plant data provider. Fetches legal-vesting (LV) documents, tax documents, grant deed images, geo/property search results, and pre-listing reports.

## Files
- Library: `application/libraries/order/Titlepoint.php`
- Admin Controller: `application/modules/admin/controllers/order/TitlePoint.php`
- Frontend Controller: `application/modules/frontend/controllers/order/TitlePoint.php`
- Models: `TitlePoint_model.php`, `TitlePointData.php`, `TitlePointDocumentRecords.php`

## Authentication
Username/password in URL query params. SSL verification disabled.

## Transport
REST/HTTP via cURL with XML responses parsed by `simplexml_load_string`.

## Endpoints
- `TP_SERVICE_ENDPOINT + TpsService.asmx/CreateService3` -- create geo/property search
- `TP_SERVICE_ENDPOINT + TpsService.asmx/GetRequestSummaries` -- poll status
- `TP_SERVICE_ENDPOINT + TpsService.asmx/GetResultByID3` -- get results
- `TP_IMAGE_ENDPOINT` -- document image retrieval
- `GRANT_DEED_ENDPOINT` -- grant deed documents

## Document Types Generated
- Legal Vesting (LV) documents
- Tax documents
- Grant deed images
- Geo/property searches
- Pre-listing reports

## Tables
- `pct_order_title_point_data` -- per-order search status (lv_file_status, tax_file_status, grant_deed_status, session_id, FIPS, etc.)
- `pct_title_point_document_records` -- individual document records (instrument type, recorded date, document type codes)
- `pct_order_api_logs` -- request/response logging

## Config
- `TP_USERNAME`, `TP_PASSWORD`, `TP_IMAGE_ENDPOINT`, `TP_SERVICE_ENDPOINT`, `GRANT_DEED_ENDPOINT`
