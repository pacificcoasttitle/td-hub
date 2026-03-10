# SoftPro Integration

## Overview
Primary order management backend. REST/JSON API for creating/updating orders, syncing users/companies, uploading documents, and fetching order status.

## Files
- Library: `application/libraries/order/SoftPro.php`
- Cron sync: `application/modules/frontend/controllers/order/Cron.php::updateAllSoftProOrderStatus()`
- Cron fetch: `application/modules/frontend/controllers/order/Cron.php::fetchSoftproOrders()`
- Constants: `application/config/constants.php` (SOFTPRO_API_END array)

## Authentication
HMAC-SHA256: `hash_hmac('sha256', userId|timestamp, SOFT_PRO_TOKEN)`

## Endpoints (30+)
- `ordercreation/create`, `updateOrder`, `GetOrderContacts`, `AddDocuments`
- `lookup/GetLookuptable` (lookup codes for all entity types)
- `ordercreation/GetOrderMarketingRep`, `GetOrders`, `GetOrderDetails`
- `ordercreation/CreateUser`, `UpdateUser`, `AddCompany`, `UpdateCompany`
- `ordercreation/AddNotes`, `AddTask`, `GetFilteredOrders`
- `ordercreation/GetAttachedDocuments`, `GetAttachedDocumentsPrelim`, `GetFees`, `GetPrelim`
- `powerbi/createExcel` (revenue report export)

## What Sync DOES Set
- `file_number`, `softpro_status`, `order_completed_date`, `resware_closed_status_date` (on first close)

## What Sync Does NOT Set (CRITICAL)
- `sent_to_accounting_date` -- explicitly commented out at Cron.php:3648
- `premium` -- never set by sync

## Tables
- `pct_resware_log` (legacy name), `pct_order_api_logs`
- Indirectly updates `order_details`, `transaction_details`, `property_details`

## Config
- `SOFT_PRO_API` (base URL), `SOFT_PRO_TOKEN` (HMAC secret)
