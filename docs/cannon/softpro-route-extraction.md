# SoftPro Integration — Legacy Route Extraction

> **Purpose:** Architectural extraction of all SoftPro-related code in the legacy Transaction Desk codebase.  
> **Goal:** Identify the real operational backbone for building a lean Transaction Desk Hub (vNext).  
> **Scope:** SoftPro-only. Excludes reporting/metrics/commission logic and revenue import details.  
> **Generated:** 2026-03-10

---

## Section 1 — Executive Summary

### What SoftPro Does in This System

SoftPro is the **primary order management backend** for Pacific Coast Title. The legacy Transaction Desk app is essentially a UI/orchestration layer over SoftPro's REST API. SoftPro holds the authoritative copy of every title/escrow order, all contacts (escrow officers, title officers, sales reps, agents, lenders), company records, documents, and order status.

### Direction of Integration

**Both inbound sync and outbound writes:**

- **Inbound (SoftPro → PCT):** Bulk order import, status sync, lookup code sync (9 entity types), document fetching (prelim reports, policy docs), milestone/webhook receivers, revenue data import
- **Outbound (PCT → SoftPro):** Order creation, order updates, document uploads (CPL, proposed insured, prelim), note creation, user/company CRUD, task status updates
- **Webhooks (SoftPro pushes to PCT):** Prelim reports, prelim summaries, policy documents, milestone events

### Heaviest Dependencies

1. **Order lifecycle** — Every order's creation, status, and close date comes from or goes to SoftPro
2. **Contact/user management** — The `pct_softpro_lookup_table` is THE universal contact table (replaced legacy `customer_basic_details`)
3. **Document pipeline** — CPLs, proposed insured forms, prelim reports, and policy docs all flow through SoftPro
4. **Cron sync jobs** — 25+ scheduled jobs pull data from SoftPro to keep the local DB current

### Top 10 Most Important SoftPro Flows

| # | Flow | Direction | Criticality |
|---|------|-----------|-------------|
| 1 | Order creation → SoftPro | Outbound | Core |
| 2 | Order import/sync from SoftPro | Inbound | Core |
| 3 | Order status sync | Inbound | Core |
| 4 | Document upload to SoftPro (CPL, Proposed Insured) | Outbound | Core |
| 5 | Prelim report fetch/webhook | Inbound | Core |
| 6 | Contact/lookup code sync (all 9 entity types) | Inbound | Core |
| 7 | Policy document webhook | Inbound | High |
| 8 | Milestone/recording confirmation webhook | Inbound | High |
| 9 | User/company CRUD to SoftPro | Outbound | Medium |
| 10 | Failed API retry (documents + general) | Outbound | Medium |

---

## Section 2 — SoftPro File Inventory

### Libraries

| File | Purpose | Key Methods | Type |
|------|---------|-------------|------|
| `application/libraries/order/SoftPro.php` | Core API client | `make_request()`, `loginSoftPro()`, `updateUserToSoftpro()` | API client |
| `application/libraries/order/Order.php` | Order business logic | `get_orders()`, `get_order_details()`, `uploadCPLDocumentToSoftpro()`, `uploadProposedDocumentToSoftpro()`, `updateTaskStatus()`, `addNewUserToSoftpro()`, `updateNewUserToSoftpro()`, `fetchAndSyncContacts()`, `generateLookupCode()` | Outbound write + DB read |
| `application/libraries/order/Common.php` | Shared utilities | `getAssistantUsers()`, `getEscrowOfficerLookupDetails()` | Helper |
| `application/libraries/order/Common_lib.php` | Extended shared utils | `getTitleOfficerLookupDetails()`, role-check methods | Helper |

### Controllers — Frontend

| File | Purpose | Key Methods | Type |
|------|---------|-------------|------|
| `application/modules/frontend/controllers/order/Cron.php` | **25+ scheduled sync jobs** | `fetchSoftproOrders()`, `updateAllSoftProOrderStatus()`, `spSyncFailedDocument()`, `fetchPrelimDocument()`, `fetchBulkPrelimreport()`, `fetchSinglePrelimreport()`, `postPrelimreport()`, `postPrelimSummary()`, `postPolicyDocument()`, `postMileStone()`, 9× lookup code syncs, `importRevenueData()`, `recallFailedAPI()` | Inbound sync + Webhook |
| `application/modules/frontend/controllers/order/Common.php` | User-facing order actions | `updatePrelimAction()`, `create_note()`, `addLenderOnOrder()`, `add_order_details()`, `create_cpl()`, `createCPlForFnf()`, `getSoftproCompanyByName()`, `getDetailsByName()`, `getOrderDetailsCpl()`, `get_contacts()`, `regeneratePrelimSummary()` | Outbound write + UI |
| `application/modules/frontend/controllers/order/Home.php` | Order submission | `orderSubmit()`, `checkDuplicateOrder()` | Outbound write |
| `application/modules/frontend/controllers/order/Dashboard.php` | User dashboard | `get_order_details()`, `get_softpro_fees()`, `get_transaction_orders()` | DB read |
| `application/modules/frontend/controllers/order/SalesRep.php` | Sales rep dashboard | `get_sales_orders()`, `salesProductionHistory()` | DB read |
| `application/modules/frontend/controllers/order/TitleOfficers.php` | Title officer dashboard | `get_title_officer_orders()`, `uploadFileDocument()` | DB read |
| `application/modules/frontend/controllers/order/EscrowProduction.php` | Escrow dashboard | `get_escrow_orders()` | DB read |
| `application/modules/frontend/controllers/order/Login.php` | Auth | `do_login()` — authenticates against `pct_softpro_lookup_table` | Auth |
| `application/modules/frontend/controllers/order/ReviewPrelim.php` | Prelim review | `fetchData()` | DB read |
| `application/modules/frontend/controllers/FileUpload.php` | File upload | `uploadFileDocument()` — uploads to SoftPro | Outbound write |

### Controllers — Admin

| File | Purpose | Key Methods | Type |
|------|---------|-------------|------|
| `application/modules/admin/controllers/order/Home.php` | **Admin hub** — 40+ SoftPro methods | `sendOrderToSoftpro()`, `addSoftProNewUser()`, `editUser()`, `spAddCompany()`, `spEditCompany()`, `softproCompanies()`, entity listing pages (agents, escrow, lenders, brokers, officers, production), lookup code generation | Outbound write + Admin UI |
| `application/modules/admin/controllers/order/Order.php` | Order management | `get_order_list()`, `order_details()`, `export_orders()`, `importRevenueData()` | DB read + Admin UI |
| `application/modules/admin/controllers/order/Sales.php` | Sales rep admin | `spAdminSalesReps()`, `edit_sp_sales_rep()`, `get_sp_sales_rep_list()` | Admin UI |
| `application/modules/admin/controllers/order/Title.php` | Title officer admin | `spAdminTitleOfficer()`, `get_sp_title_officer_list()` | Admin UI |
| `application/modules/admin/controllers/order/Agent.php` | Agent admin | `edit()` — syncs to SoftPro via `updateUserToSoftpro()` | Outbound write |

### Models — Admin

| File | Purpose | Key Methods |
|------|---------|-------------|
| `application/modules/admin/models/order/Home_model.php` | Admin home queries | `get_customers()`, `get_sp_company_list()`, `get_softpro_companies_list()`, `get_sp_admin_users_list()`, `get_sp_officers_list()`, `sp_get_user()`, `sp_get_company()` |
| `application/modules/admin/models/order/Order_model.php` | Order queries | `get_orders()` (6-way join on `pct_softpro_lookup_table`), `get_order_details()`, `get_lp_orders()` |
| `application/modules/admin/models/order/Customer_model.php` | Customer CRUD | Table = `pct_softpro_lookup_table` |
| `application/modules/admin/models/order/Sales_model.php` | Sales rep CRUD | Table = `pct_softpro_lookup_table`, `get_sp_sales_reps()` |
| `application/modules/admin/models/order/Title_model.php` | Title officer CRUD | Table = `pct_softpro_lookup_table` |
| `application/modules/admin/models/order/Payoff_model.php` | Payoff queries | References `file_number` |
| `application/modules/admin/models/order/Transactee_model.php` | Transactee queries | References SoftPro order data |
| `application/modules/admin/models/order/TitlePoint_model.php` | TitlePoint queries | References `file_number` |

### Models — Frontend

| File | Purpose | Key Methods |
|------|---------|-------------|
| `application/modules/frontend/models/order/Home_model.php` | Frontend queries | Table = `pct_softpro_lookup_table`, `get_sp_customers()`, `get_sp_companies()`, `get_product_types()`, `get_order_types()` |
| `application/modules/frontend/models/order/SalesRep_model.php` | Sales rep queries | Joins `pct_softpro_lookup_table` |
| `application/modules/frontend/models/order/Agent_model.php` | Agent queries | References SoftPro lookup data |
| `application/modules/frontend/models/order/TitleOfficer.php` | Title officer queries | References SoftPro lookup data |

### Config / Helpers

| File | Purpose |
|------|---------|
| `application/config/constants.php` | `SOFTPRO_API_END` (21 endpoints), `SOFTPRO_TASK_ID` (3 tasks), `TRANSACTION_TYPE` |
| `application/helpers/common_helper.php` | `getSoftproAPIUrl($endpoint)` — resolves API URLs |
| `application/config/routes.php` | 30+ SoftPro-related routes |

### Admin Views

| File | Purpose |
|------|---------|
| `admin/views/order/home/softpro_companies.php` | SoftPro companies listing page |
| `admin/views/order/home/add_sp_company.php` | Add SoftPro company form |
| `admin/views/order/home/edit_company.php` | Edit company form |
| `admin/views/order/home/sp_agents.php` | SoftPro agents listing |
| `admin/views/order/home/sp_escrows.php` | SoftPro escrow users listing |
| `admin/views/order/home/sp_lenders.php` | SoftPro lenders listing |
| `admin/views/order/home/sp_mortgage_brokers.php` | SoftPro mortgage brokers listing |
| `admin/views/order/home/sp_new_users.php` | New SoftPro users listing |
| `admin/views/order/home/sp_escrow_officers.php` | Escrow officers listing |
| `admin/views/order/home/sp_title_production.php` | Title production listing |
| `admin/views/order/home/sp_escrow_production.php` | Escrow production listing |
| `admin/views/order/home/add_sp_new_user.php` | Add new SoftPro user form |
| `admin/views/order/home/sp_add_title_production.php` | Add title production form |
| `admin/views/order/home/sp_edit_title_production.php` | Edit title production form |
| `admin/views/order/home/sp_add_escrow_production.php` | Add escrow production form |
| `admin/views/order/home/sp_edit_escrow_production.php` | Edit escrow production form |
| `admin/views/order/home/cpl_document.php` | CPL documents listing |
| `admin/views/order/home/policy_document.php` | Policy documents listing |
| `admin/views/order/home/grant_deed_document.php` | Grant deed documents listing |
| `admin/views/order/home/lv_document.php` | Legal vesting documents listing |
| `admin/views/order/order/orders.php` | Orders listing (main) |
| `admin/views/order/order/order_details.php` | Order detail page |
| `admin/views/order/order/lp_orders.php` | LP orders listing |
| `admin/views/order/sales/sp_sales.php` | SoftPro sales reps listing |
| `admin/views/order/sales/sp_edit_sales_rep.php` | Edit sales rep form |
| `admin/views/order/title/sp_title.php` | SoftPro title officers listing |

### JavaScript

| File | Purpose |
|------|---------|
| `assets/backend/js/order.js` | `openSoftproOrderPopup()`, `syncOrderNumberFromSoftpro()` — admin sync trigger |
| `assets/backend/js/custom.js` | DataTables for `tbl-softpro-companies-listing` and other SP tables |
| `assets/backend/js/lp-order.js` | LP order actions including "Send to SoftPro" |
| `assets/frontend/js/order/cpl.js` | CPL form — calls `getSoftproCompanyByName` for lender autocomplete |
| `assets/frontend/js/order/proposed.js` | Proposed insured form — calls `getSoftproCompanyByName` for company autocomplete |
| `assets/frontend/js/order/title_officer_dashboard.js` | Title officer dashboard with SoftPro status filters |

---

## Section 3 — Route Map

### 3.1 Sync Routes (Cron / Scheduled Jobs)

| Route | Controller Method | Purpose | Direction | User |
|-------|-------------------|---------|-----------|------|
| `fetch-softpro-orders` | `Cron::fetchSoftproOrders` | Import orders from SoftPro by date range | Inbound | Cron |
| `update-softpro-order-status` | `Cron::updateAllSoftProOrderStatus` | Sync order statuses (batched 10-day intervals) | Inbound | Cron |
| `update-all-order-status` | `Cron::updateAllOrderStatus` | Bulk update all order statuses | Inbound | Cron |
| `update-order-status` | `Cron::updateOrderStatus` | Update single order status | Inbound | Cron |
| `import-orders` | `Cron::import_orders` | Import orders for logged-in user | Inbound | Cron |
| `import-orders-all-users` | `Cron::import_orders_all_users` | Import orders for all users | Inbound | Cron |
| `import-orders-using-file-number` | `Cron::importOrdersUsingFileNumber` | Import specific order by file number | Inbound | Cron |
| `update-remote-file-numbers` | `Cron::updateRemoteFileNumberForAllOrders` | Backfill remote file numbers | Inbound | Cron |
| `import-sales-rep-orders` | `Cron::import_sales_rep_orders` | Import orders for sales reps | Inbound | Cron |
| `import-all-sales-rep-orders` | `Cron::import_all_sales_rep_orders` | Import orders for all sales reps | Inbound | Cron |

### 3.2 Lookup Code Sync Routes

| Route | Controller Method | SoftPro Entity Type | User |
|-------|-------------------|---------------------|------|
| `fetch-open-contact-lookup-code` | `Cron::softproOpenContactLookupCode` | Order Contact - Person | Cron |
| `fetch-escrow-company-lookup-code` | `Cron::softproEscrowCompanyLookupCode` | Escrow Company | Cron |
| `fetch-lender-lookup-code` | `Cron::softproLenderLookupCode` | Lender | Cron |
| `fetch-mortgage-broker-lookup-code` | `Cron::softproMortgageBrokerLookupCode` | Mortgage Broker | Cron |
| `fetch-selling-agent-lookup-code` | `Cron::softproSellingAgentLookupCode` | Selling Agent/Broker | Cron |
| `fetch-underwriter-lookup-code` | `Cron::softproUnderwriterLookupCode` | Underwriter | Cron |
| `fetch-escrow-officer-lookup-code` | `Cron::softproEscrowOfficerLookupCode` | Escrow Officer | Cron |
| `fetch-title-officer-lookup-code` | `Cron::softproTitleOfficerLookupCode` | Title Officer | Cron |
| `fetch-sales-rep-lookup-code` | `Cron::softproSalesrepsLookupCode` | Sales Rep (via GetOrderMarketingRep) | Cron |

### 3.3 Document / Prelim Routes

| Route | Controller Method | Purpose | Direction | User |
|-------|-------------------|---------|-----------|------|
| `softpro-fetch-prelim-data` | `Cron::fetchPrelimDocument` | Fetch prelim PDFs from SoftPro | Inbound | Cron |
| `fetch-bulk-prelim-report` | `Cron::fetchBulkPrelimreport` | Bulk fetch prelim PDFs by date range | Inbound | Cron |
| `fetch-single-prelim-report` | `Cron::fetchSinglePrelimreport` | Fetch single prelim PDF | Inbound | Cron |
| `softpro-sync-failed-file` | `Cron::spSyncFailedDocument` | Retry failed document uploads | Outbound | Cron |
| `upload-document` | `Common::upload_document` | Upload document to order | Outbound | User |
| `upload-doc-orders` | `Common::uploadDocOrders` | Upload doc page | UI | User |

### 3.4 Webhook Receiver Routes (SoftPro → PCT)

| Route | Controller Method | Purpose | Payload |
|-------|-------------------|---------|---------|
| `post-prelim-report` | `Cron::postPrelimreport` | Receives prelim PDF push | `{OrderNumber, Status, data[]}` |
| `post-prelim-summary` | `Cron::postPrelimSummary` | Receives parsed prelim summary | `{OrderNumber, data{requirements[], lien[], easements[], exceptions[]}}` |
| `post-policy-document` | `Cron::postPolicyDocument` | Receives policy documents | `{OrderNumber, data[]{FileName, FileUrl}}` |
| `post-milestone` | `Cron::postMileStone` | Receives task/milestone events | `{OrderNumber, Id (task code), Status}` |

### 3.5 Order Detail / Status Routes

| Route | Controller Method | Purpose | User |
|-------|-------------------|---------|------|
| `get-order-details` | `Dashboard::get_order_details` | Get order details (frontend) | User AJAX |
| `update-order-details` | `Dashboard::update_order_details` | Update order details (frontend) | User AJAX |
| `order/admin/order-details/:num` | `admin/Order::order_details` | Admin order detail page | Admin |
| `order/admin/get-order-list` | `admin/Order::get_order_list` | Admin order listing (DataTables) | Admin AJAX |
| `order/admin/update-order-details` | `admin/Order::update_order_details` | Admin update order | Admin AJAX |
| `get-contacts` | `Common::get_contacts` | Fetch + sync contacts from SoftPro | User AJAX |
| `get-prelim-summary` | `Common::getPrelimSummary` | Get/generate AI prelim summary | User AJAX |
| `regenerate-prelim-summary` | `Common::regeneratePrelimSummary` | Force re-fetch prelim from SoftPro | User AJAX |

### 3.6 Manual Admin Action Routes

| Route | Controller Method | Purpose | User |
|-------|-------------------|---------|------|
| `order/admin/send-order-to-softpro` | `admin/Home::sendOrderToSoftpro` | Send LP order to SoftPro | Admin |
| `order/admin/add-softpro-new-user` | `admin/Home::addSoftProNewUser` | Create user in SoftPro | Admin |
| `order/admin/edit-user/:num` | `admin/Home::editUser` | Edit user (syncs to SoftPro) | Admin |
| `order/admin/softpro-add-company` | `admin/Home::spAddCompany` | Create company in SoftPro | Admin |
| `order/admin/edit-softpro-company/:num` | `admin/Home::spEditCompany` | Edit company (syncs to SoftPro) | Admin |
| `order/admin/edit-softpro-agent/:num` | `admin/Home::spEditAgent` | Edit agent (syncs to SoftPro) | Admin |
| `order/admin/generate-lookupcode` | `admin/Home::generateLookupCode` | Generate person lookup code | Admin AJAX |
| `order/admin/generate-company-lookupcode` | `admin/Home::generateCompanyLookupCode` | Generate company lookup code | Admin AJAX |
| `update-prelim-action/:num` | `Common::updatePrelimAction` | Upload updated prelim + add note to SoftPro | User |
| `create-note` | `Common::create_note` | Add note to SoftPro order | User |
| `add-lender-order` | `Common::addLenderOnOrder` | Add lender to order (updates SoftPro) | User |
| `add-order-details` | `Common::add_order_details` | Save proposed insured (uploads to SoftPro) | User |

### 3.7 Admin Entity Management Routes

| Route | Controller Method | Entity |
|-------|-------------------|--------|
| `order/admin/softpro-agents` | `admin/Home::spAdminAgent` | Agents listing |
| `order/admin/softpro-escrow` | `admin/Home::spAdminEscrow` | Escrow users listing |
| `order/admin/softpro-lenders` | `admin/Home::spAdminLenders` | Lenders listing |
| `order/admin/softpro-mortgage-brokers` | `admin/Home::spAdminMortgageBrokers` | Mortgage brokers listing |
| `order/admin/softpro-new-users` | `admin/Home::spNewUsers` | New users listing |
| `order/admin/softpro-companies` | `admin/Home::softproCompanies` | Companies listing |
| `order/admin/softpro-escrow-officers` | `admin/Home::spAdminEscrowOfficers` | Escrow officers listing |
| `order/admin/softpro-title-officers` | `admin/Title::spAdminTitleOfficer` | Title officers listing |
| `order/admin/softpro-sales-reps` | `admin/Sales::spAdminSalesReps` | Sales reps listing |
| `order/admin/softpro-title-production` | `admin/Home::spTitleProduction` | Title production listing |
| `order/admin/softpro-escrow-production` | `admin/Home::spEscrowProduction` | Escrow production listing |

---

## Section 4 — Core SoftPro Flows

### Flow 1: Order Creation → SoftPro

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Admin clicks "Send Order to SoftPro" on LP order |
| **Route** | `order/admin/send-order-to-softpro` |
| **Controller** | `admin/Home::sendOrderToSoftpro()` |
| **Libraries** | `SoftPro::make_request()` |
| **SoftPro Endpoint** | `ordercreation/create` (POST), then `ordercreation/AddDocuments` (POST) |
| **Tables** | `order_details` (R/W), `transaction_details` (R), `property_details` (R), `pct_softpro_lookup_table` (R), `pct_order_title_point_data` (R/W), `sp_file_upload_logs` (W), `pct_resware_log` (W) |
| **Fields Written** | `order_details.file_number` (from SoftPro response `OrderNumber`), `order_details.is_softpro_order = 1` |
| **Result** | Order gets a SoftPro file number, documents are uploaded, confirmation emails sent |

### Flow 2: Order Import from SoftPro

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Cron job (scheduled) |
| **Route** | `fetch-softpro-orders` |
| **Controller** | `Cron::fetchSoftproOrders()` |
| **SoftPro Endpoint** | `ordercreation/GetOrderDetails` (GET) |
| **Tables** | `order_details` (R/W), `transaction_details` (R/W), `property_details` (W), `pct_softpro_product_type` (R), `pct_softpro_lookup_table` (R), `pct_softpro_order_type` (R) |
| **Fields Written** | `file_number`, `softpro_status`, `is_softpro_order`, `is_imported`, property address fields, transaction type, product type, sales rep, title officer |
| **Result** | New orders appear in local DB; existing orders get status/data updates |

### Flow 3: Order Status Sync

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Cron job (scheduled) |
| **Route** | `update-softpro-order-status` |
| **Controller** | `Cron::updateAllSoftProOrderStatus()` |
| **SoftPro Endpoint** | `ordercreation/GetOrders` (GET, batched 10-day intervals) |
| **Tables** | `order_details` (R/W) |
| **Fields Written** | `softpro_status`, `order_completed_date`, `resware_closed_status_date` |
| **Note** | Does NOT write `sent_to_accounting_date` or `premium` — those come from revenue import only |
| **Result** | Local order statuses match SoftPro; emails sent for newly closed orders |

### Flow 4: Document Upload to SoftPro

| Attribute | Detail |
|-----------|--------|
| **Trigger** | User generates CPL or Proposed Insured document |
| **Route** | `create-cpl/:num`, `add-order-details`, `update-prelim-action/:num` |
| **Controller** | `Common::createCPlForFnf()`, `Common::add_order_details()`, `Common::updatePrelimAction()` |
| **Libraries** | `Order::uploadCPLDocumentToSoftpro()`, `Order::uploadProposedDocumentToSoftpro()` |
| **SoftPro Endpoint** | `ordercreation/AddDocuments` (POST) |
| **Tables** | `pct_order_documents` (W), `sp_file_upload_logs` (W), `pct_resware_log` (W) |
| **Fields** | `OrderNumber`, `FileURL` (S3 URL), `DocumentName`, `FolderName` |
| **Result** | Document appears in SoftPro attached to the order |

### Flow 5: Prelim Report Fetch (Cron + Webhook)

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Cron poll OR SoftPro webhook push |
| **Routes** | `softpro-fetch-prelim-data`, `fetch-bulk-prelim-report`, `post-prelim-report`, `post-prelim-summary` |
| **SoftPro Endpoints** | `ordercreation/GetAttachedDocuments`, `GetAttachedDocumentsFromOrders`, `GetAttachedDocumentsPrelim`, `GetPrelim` |
| **Tables** | `pct_order_documents` (W), `pct_order_prelim_summary` (W), `order_details` (W: `prelim_summary_id`) |
| **Fields** | Document URLs, `resware_json` (raw prelim data), `chatgpt_json` (Tessa AI analysis), `is_tessa` |
| **Result** | Prelim PDFs stored in S3 with local records; AI analysis generated and emailed |

### Flow 6: Lookup Code Sync (9 Entity Types)

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Cron jobs (one per entity type) |
| **Routes** | `fetch-open-contact-lookup-code`, `fetch-escrow-company-lookup-code`, etc. (9 routes) |
| **SoftPro Endpoint** | `lookup/GetLookuptable` (GET, parameterized by `userType`) |
| **Tables** | `pct_softpro_lookup_table` (R/W), `sp_company` (R/W for company types) |
| **Entity Types** | Order Contact - Person, Escrow Company, Escrow Officer, Lender, Mortgage Broker, Selling Agent/Broker, Title Officer, Underwriter, Sales Rep (via `GetOrderMarketingRep`) |
| **Result** | Local contact/company tables stay in sync with SoftPro master data |

### Flow 7: Policy Document Webhook

| Attribute | Detail |
|-----------|--------|
| **Trigger** | SoftPro pushes policy documents to PCT |
| **Route** | `post-policy-document` |
| **Controller** | `Cron::postPolicyDocument()` |
| **Tables** | `pct_order_documents` (W), `order_details` (W: `lender_policy_sent`, `owner_policy_sent`, `supplement_statement_sent`) |
| **Result** | Policy PDFs stored in S3; escrow officer emailed |

### Flow 8: Milestone / Recording Confirmation Webhook

| Attribute | Detail |
|-----------|--------|
| **Trigger** | SoftPro pushes task completion events |
| **Route** | `post-milestone` |
| **Controller** | `Cron::postMileStone()` |
| **Task IDs** | `03-020`, `TSG-02-015`, `TSG-PRE-15` (recording), `04-035`, `04-035-TE` (disbursement) |
| **Tables** | `pct_twilio_messages` (W) |
| **Result** | SMS sent to sales rep; emails to escrow/lender contacts |

### Flow 9: User/Company CRUD → SoftPro

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Admin creates/edits user or company |
| **Routes** | `order/admin/add-softpro-new-user`, `order/admin/edit-user/:num`, `order/admin/softpro-add-company`, etc. |
| **SoftPro Endpoints** | `ordercreation/CreateUser`, `UpdateUser`, `AddCompany`, `UpdateCompany` |
| **Tables** | `pct_softpro_lookup_table` (R/W), `sp_company` (R/W), `pct_resware_log` (W) |
| **Result** | Contact/company created or updated in both SoftPro and local DB |

### Flow 10: Failed API Retry

| Attribute | Detail |
|-----------|--------|
| **Trigger** | Cron job |
| **Routes** | `softpro-sync-failed-file` (documents), general via `recallFailedAPI` |
| **Tables** | `sp_file_upload_logs` (R/W: `is_synced`), `pct_failed_api_logs` (R/W: `status`) |
| **Result** | Previously failed uploads/API calls retried and marked complete on success |

---

## Section 5 — External API Endpoints and Auth

### Base URL

```
Environment variable: SOFT_PRO_API
Resolved by: getenv("SOFT_PRO_API") . SOFTPRO_API_END[$endpoint]
Helper: getSoftproAPIUrl($endpoint) in common_helper.php
```

### Authentication

```
Secret key: getenv('SOFT_PRO_TOKEN')
Method: HMAC-SHA256
Signature: hash_hmac('sha256', userId|timestamp, SOFT_PRO_TOKEN)
```

**Important:** The HMAC auth in `loginSoftPro()` has a `die` statement and appears incomplete/unused. The main `make_request()` method sends **no authentication headers** in production — the API key header is inside `if (false)`. This suggests the SoftPro API may be network-restricted (internal IP) or uses a different auth mechanism not visible in the codebase.

### Request Configuration

- **Content-Type:** `application/json`
- **Timeout:** 540 seconds (9 minutes)
- **SSL Verification:** Disabled for GET requests (`CURLOPT_SSL_VERIFYPEER = false`)
- **Response Format:** JSON with `{Status: 200, Message: "...", data: {...}, OrderNumber: "..."}`
- **Error Handling:** Returns `{status: 'error', message: '...'}` on curl error or non-200 status

### Endpoint Inventory

| Constant Key | Endpoint Path | HTTP | Purpose | Used By |
|---|---|---|---|---|
| `create_order` | `ordercreation/create` | POST | Create new order in SoftPro | `Home::sendOrderToSoftpro` |
| `update_order` | `ordercreation/updateOrder` | POST | Update existing order | `Common::addLenderOnOrder` |
| `get_order_contacts` | `ordercreation/GetOrderContacts` | GET | Fetch contacts for an order | `Order::fetchAndSyncContacts` |
| `upload_document` | `ordercreation/AddDocuments` | POST | Upload document to order | CPL, Proposed Insured, Prelim uploads |
| `fetch_lookup_code` | `lookup/GetLookuptable` | GET | Sync lookup codes by entity type | 9 cron sync jobs |
| `fetch_sales_reps` | `ordercreation/GetOrderMarketingRep` | GET | Sync sales rep list | `Cron::softproSalesrepsLookupCode` |
| `get_all_order_status` | `ordercreation/GetOrders` | GET | Bulk order status check | `Cron::updateAllSoftProOrderStatus` |
| `create_user` | `ordercreation/CreateUser` | POST | Create user in SoftPro | `Home::addSoftProNewUser` |
| `update_user` | `ordercreation/UpdateUser` | POST | Update user in SoftPro | `Home::editUser`, `Agent::edit` |
| `add_note` | `ordercreation/AddNotes` | POST | Add note to order | `Common::create_note`, `Common::updatePrelimAction` |
| `get_prelim_documents` | `ordercreation/GetAttachedDocuments` | GET | Fetch prelim docs for order | `Cron::fetchPrelimDocument` |
| `add_company` | `ordercreation/AddCompany` | POST | Create company in SoftPro | `Home::spAddCompany`, `Common::addNewLenderCPL` |
| `update_company` | `ordercreation/UpdateCompany` | POST | Update company in SoftPro | `Home::spEditCompany` |
| `update_task` | `ordercreation/AddTask` | POST | Update task status | `Order::updateTaskStatus` |
| `get_sales_figure` | `ordercreation/GetFilteredOrders` | GET | Filtered order query | Sales figure reports |
| `get_softpro_orders` | `ordercreation/GetOrderDetails` | GET | Full order details | `Cron::fetchSoftproOrders` |
| `get_bulk_prelim_report` | `ordercreation/GetAttachedDocumentsFromOrders` | GET | Bulk prelim fetch by date | `Cron::fetchBulkPrelimreport` |
| `get_single_prelim_report` | `ordercreation/GetAttachedDocumentsPrelim` | GET | Single prelim fetch | `Cron::fetchSinglePrelimreport` |
| `get_fees` | `ordercreation/GetFees` | GET | Fetch fees for order | Fee estimation |
| `get_prelim_summary` | `ordercreation/GetPrelim` | GET | Fetch parsed prelim summary | `Common::regeneratePrelimSummary` |
| `power_bi_revenue` | `powerbi/createExcel` | GET | Revenue/financial data export | `Cron::importRevenueData` |

### Task IDs

| Constant Key | Task Code | Purpose |
|---|---|---|
| `open_order` | `01-005` | Open order task |
| `lv_client` | `01-010` | Legal vesting client task |
| `update_prelim` | `03-005` | Update prelim task |

---

## Section 6 — Data Mapping

### SoftPro Order Response → Local DB (fetchSoftproOrders)

| SoftPro Field | Local Table | Local Column | Transform |
|---|---|---|---|
| `OrderNumber` | `order_details` | `file_number` | Direct |
| `OrderStatus` | `order_details` | `softpro_status` | Lowercase |
| `OrderType` | `transaction_details` | `order_type` | Lookup via `pct_softpro_order_type` |
| `TransactionType` | `transaction_details` | `transaction_type` | Map: 1→Purchase, 2→Refinance, 3→Equity, 4→Other |
| `ProductType` | `transaction_details` | `product_type` | Lookup via `pct_softpro_product_type` |
| `MarketingRep` | `transaction_details` | `sales_representative` | Lookup via `pct_softpro_lookup_table.lookup_code` |
| `TitleOfficer` | `transaction_details` | `title_officer` | Lookup via `pct_softpro_lookup_table.closer_examiner` |
| `SalesPrice` | `transaction_details` | `sales_amount` | Direct |
| `Address` | `property_details` | `property_address` | Direct |
| `City` | `property_details` | `city` | Direct |
| `State` | `property_details` | `state` | Direct |
| `Country` | `property_details` | `county` | Direct |
| `ReceivedDate` | `order_details` | `created_at` | Date format |
| `CompletedDate` | `order_details` | `order_completed_date` | Date format |
| `ModifiedDate` | `order_details` | `updated_at` | Date format |
| `MarketingSource` | `order_details` | (customer mapping) | Lookup via `pct_softpro_lookup_table` |

### SoftPro Status Sync → Local DB (updateAllSoftProOrderStatus)

| SoftPro Field | Local Column | Transform |
|---|---|---|
| `OrderNumber` | `order_details.file_number` | Match key |
| `OrderStatus` | `order_details.softpro_status` | Lowercase |
| `CompletedDate` | `order_details.order_completed_date` | Date format |
| `LastModifiedOn` | (used for filtering only) | — |

**Status normalization:** `softpro_status` stores lowercase strings. "Open" is inferred as NOT IN (`closed`, `canceled`, `inprocess`, `duplicate`) OR IS NULL.

### SoftPro Contact Response → Local DB (fetchAndSyncContacts)

| SoftPro Response Path | Local Match Field | Mapped To |
|---|---|---|
| `EscrowCompanies.PersonLookupCode` | `pct_softpro_lookup_table.lookup_code` | `property_details.escrow_id` |
| `Lenders.PersonLookupCode` | `pct_softpro_lookup_table.lookup_code` | `property_details.lender_id` |
| `ListingAgentBrokers.PersonLookupCode` | `pct_softpro_lookup_table.lookup_code` | `property_details.listing_agent_id` |
| `TitleCompanies.CompanyLookUpCode` | Direct storage | Title company reference |
| `Underwriters.CompanyLookUpCode` | Direct storage | Underwriter reference |

### SoftPro Lookup Code Sync → Local DB (9 entity types)

| SoftPro Field | Local Table | Local Column |
|---|---|---|
| `LookupCode` / `Lookup Code` | `pct_softpro_lookup_table` | `lookup_code` |
| `FirstName` / `First Name` | `pct_softpro_lookup_table` | `first_name` |
| `LastName` / `Last Name` | `pct_softpro_lookup_table` | `last_name` |
| `Email` | `pct_softpro_lookup_table` | `email_address` |
| `Phone` | `pct_softpro_lookup_table` | `phone` |
| `Address1` / `Address` | `pct_softpro_lookup_table` | `address1` |
| `City` | `pct_softpro_lookup_table` | `city` |
| `State` | `pct_softpro_lookup_table` | `state` |
| `Zip` | `pct_softpro_lookup_table` | `zip` |
| `License No` | `pct_softpro_lookup_table` | `license_no` |
| `Title officer/Examiner` | `pct_softpro_lookup_table` | `closer_examiner` |
| `Office LookupCode` | `pct_softpro_lookup_table` | `office_lookup_code` |
| `Name` (company types) | `sp_company` | `name` |
| `Payee Name` | `sp_company` | `payee_name` |
| `Fee Transfer Ledger` | `sp_company` | `fee_transfer_ledger` |
| `Marketing Rep` | `sp_company` | `marketing_rep` |
| `Signature Line` | `sp_company` | `signature_line` |

### Revenue Import → Local DB (importRevenueData)

| SoftPro/PowerBI Field | Local Table | Local Column |
|---|---|---|
| `[Number]` | `order_details` | `file_number` (match key) |
| `[SumAmount]` | `order_details` | `premium` |
| `[BillCode]` | `order_details` | `bill_code` |
| `[TransactionDate]` | `order_details` | `sent_to_accounting_date` |
| `[TransType]` | `transaction_details` | `transaction_type` |
| `[SalesRep]` | `transaction_details` | `sales_representative` (via lookup) |
| `[OrderType]` | `transaction_details` | `order_type` (via lookup) |
| `[EscrowOfficerName]` | `order_details` | `escrow_officer_id` (via lookup) |
| `[TitleOfficerName]` | `transaction_details` | `title_officer` (via lookup) |

---

## Section 7 — Tables Touched by SoftPro

### Core Domain Tables

| Table | Purpose | Key SoftPro Fields | R/W |
|---|---|---|---|
| `order_details` | Central order record | `file_number`, `file_id`, `softpro_status`, `is_softpro_order`, `is_imported`, `customer_id`, `created_by`, `prod_type`, `premium`, `escrow_amount`, `underwriter`, `escrow_officer_id`, `order_completed_date`, `resware_closed_status_date`, `sent_to_accounting_date`, `borrower_email`, `prelim_summary_id`, `cpl_document_name`, `proposed_insured_document_name`, `lp_file_number` | R/W |
| `transaction_details` | Transaction-level data | `sales_representative` (FK→lookup), `title_officer` (FK→lookup), `purchase_type`, `product_type` (FK→product_type), `order_type` (FK→order_type), `transaction_type`, `sales_amount`, `loan_amount`, `loan_number` | R/W |
| `property_details` | Property + party info | `property_address`, `city`, `state`, `county`, `escrow_lender_id`, `lender_id`, `buyer_agent_id`, `listing_agent_id`, `cpl_lender_company_id`, `borrowers_vesting`, `cpl_proposed_property_*` fields | R/W |

### Lookup / Reference Tables

| Table | Purpose | Key Fields | R/W |
|---|---|---|---|
| `pct_softpro_lookup_table` | **Universal contact table** (all people) | `lookup_code`, `flookup_code`, `first_name`, `last_name`, `email_address`, `company_name`, `phone`, `address1`, `city`, `state`, `zip`, `officer_name`, `closer_examiner`, 12+ boolean `is_*` flags, `assignment_clause`, `status` | R/W |
| `sp_company` | SoftPro companies | `lookup_code`, `name`, `address1`, `city`, `state`, `zip`, `is_escrow_company`, `is_lender`, `is_selling_agent`, `is_mortgage_broker`, `is_underwriter`, `assignment_clause`, `status` | R/W |
| `pct_softpro_product_type` | Product type reference | `id`, `product_type`, `status` | R |
| `pct_softpro_order_type` | Order type reference | `id`, `order_type`, `status` | R |

### Document Tables

| Table | Purpose | Key Fields | R/W |
|---|---|---|---|
| `pct_order_documents` | Order document records | `order_id`, `file_id`, `document_name`, `original_document_name`, `api_document_id`, `is_prelim_document`, `is_sync`, `is_uploaded_by_borrower` | R/W |
| `pct_order_prelim_summary` | Prelim summary + AI analysis | `file_number`, `resware_json`, `chatgpt_json`, `is_tessa` | R/W |
| `sp_file_upload_logs` | Document upload retry queue | `order_number`, `document_name`, `file_list`, `is_synced`, `reason` | R/W |

### Logging Tables

| Table | Purpose | Key Fields | R/W |
|---|---|---|---|
| `pct_resware_log` | API request/response log (legacy name) | `request_type`, `request_url`, `file_number`, `request`, `response`, `status` | W |
| `pct_order_api_logs` / `pct_api_logs` | Generic API sync logs | `user_id`, `api_type`, `action`, `request`, `response` | W |
| `pct_failed_api_logs` | Failed API retry queue | `request_type`, `request_url`, `request_data`, `status` | R/W |

### Other Touched Tables

| Table | Purpose | R/W |
|---|---|---|
| `pct_order_notes` | Order notes | W |
| `pct_order_notifications` | UI notifications | W |
| `pct_twilio_messages` | SMS messages (recording confirmations) | W |
| `pct_email_queue` | Email queue (surveys, summaries) | W |
| `pct_config` / `pct_configs` | Feature flags | R |
| `pct_order_title_point_data` | TitlePoint integration data | R/W |
| `pct_order_partner_company_info` | Legacy company-order mapping | R/W |
| `cpl_errors` | CPL generation error log | W |

---

## Section 8 — Admin and User Features Backed by SoftPro

### Admin Features

| Feature | View/Page | User Type | Route | Data Source | Fresh Sync? |
|---|---|---|---|---|---|
| **Orders listing** | `orders.php` | Admin | `order/admin/orders` | `order_details` WHERE `is_softpro_order=1` | Cached DB |
| **Order detail view** | `order_details.php` | Admin | `order/admin/order-details/:num` | 6-way join on `pct_softpro_lookup_table` | Cached DB |
| **Sync SoftPro button** (on order list) | `orders.php` | Admin | JS → `fetch-softpro-orders` | SoftPro API (real-time) | Fresh sync |
| **Send Order to SoftPro** (LP orders) | `lp_orders.php` | Admin | `order/admin/send-order-to-softpro` | SoftPro API (write) | Outbound |
| **SoftPro Companies** | `softpro_companies.php` | Admin | `order/admin/softpro-companies` | `sp_company` | Cached DB |
| **Add/Edit Company** | `add_sp_company.php` | Admin | `order/admin/softpro-add-company` | SoftPro API (write) | Outbound |
| **SoftPro Agents** | `sp_agents.php` | Admin | `order/admin/softpro-agents` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro Escrow** | `sp_escrows.php` | Admin | `order/admin/softpro-escrow` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro Lenders** | `sp_lenders.php` | Admin | `order/admin/softpro-lenders` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro Mortgage Brokers** | `sp_mortgage_brokers.php` | Admin | `order/admin/softpro-mortgage-brokers` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro New Users** | `sp_new_users.php` | Admin | `order/admin/softpro-new-users` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro Sales Reps** | `sp_sales.php` | Admin | `order/admin/softpro-sales-reps` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro Title Officers** | `sp_title.php` | Admin | `order/admin/softpro-title-officers` | `pct_softpro_lookup_table` | Cached DB |
| **SoftPro Escrow Officers** | `sp_escrow_officers.php` | Admin | `order/admin/softpro-escrow-officers` | `pct_softpro_lookup_table` | Cached DB |
| **Title Production** | `sp_title_production.php` | Admin | `order/admin/softpro-title-production` | `pct_softpro_lookup_table` | Cached DB |
| **Escrow Production** | `sp_escrow_production.php` | Admin | `order/admin/softpro-escrow-production` | `pct_softpro_lookup_table` | Cached DB |
| **Add New SoftPro User** | `add_sp_new_user.php` | Admin | `order/admin/add-softpro-new-user` | SoftPro API (write) | Outbound |
| **Export orders CSV** | — | Admin | `order/admin/export-orders` | `order_details` + all `sp_*` fields | Cached DB |
| **CPL Documents listing** | `cpl_document.php` | Admin | `order/admin/cpl-documents` | `order_details` filtered `is_softpro_order=1` | Cached DB |
| **Policy Documents listing** | `policy_document.php` | Admin | `order/admin/policy-documents` | `order_details` filtered `is_softpro_order=1` | Cached DB |

### User (Frontend) Features

| Feature | User Type | Route | Data Source | Fresh Sync? |
|---|---|---|---|---|
| **Dashboard** (order list) | Escrow/Title/Sales | `dashboard` | `order_details` WHERE `is_softpro_order=1` | Cached DB |
| **Order detail view** | All | `get-order-details` | 4-way join on `pct_softpro_lookup_table` | Cached DB |
| **CPL creation** | Escrow | `create-cpl/:num` | Local DB + uploads to SoftPro | Outbound |
| **Proposed Insured form** | Escrow | `proposed-insured` | Local DB (all `sp_*` fields) | Cached DB |
| **Save Proposed Insured** | Escrow | `add-order-details` | Writes to DB + uploads to SoftPro | Outbound |
| **Prelim summary** | Title | `get-prelim-summary` | `pct_order_prelim_summary` | Cached DB |
| **Regenerate prelim** | Title | `regenerate-prelim-summary` | SoftPro API (fresh fetch) | Fresh sync |
| **Update prelim** | Title | `update-prelim-action/:num` | Upload to SoftPro + add note | Outbound |
| **Add note** | All | `create-note` | SoftPro API (write) | Outbound |
| **Get contacts** | All | `get-contacts` | SoftPro API (fresh sync) | Fresh sync |
| **Lender autocomplete** | Escrow | `getSoftproCompanyByName` | `sp_company` | Cached DB |
| **Contact autocomplete** | All | `getDetailsByName` | `pct_softpro_lookup_table` | Cached DB |
| **Upload documents** | All | `upload-documents/:num` | Upload to S3 + SoftPro | Outbound |
| **Sales rep dashboard** | Sales | `sales-dashboard/:any` | `order_details` + `pct_softpro_lookup_table` | Cached DB |
| **Title officer dashboard** | Title | `title-officer-dashboard` | `order_details` + `pct_softpro_lookup_table` | Cached DB |
| **Escrow officer dashboard** | Escrow | `escrow-officer-dashboard` | `order_details` + `pct_softpro_lookup_table` | Cached DB |
| **Fees view** | All | `get-fees/:num` | Local DB (SoftPro-synced) or SoftPro API | Mixed |

---

## Section 9 — SoftPro Dependency Ranking

### Bucket 1 — Must-Have for vNext Launch

| Feature | Reason |
|---|---|
| Order import from SoftPro | Core data pipeline — no orders without this |
| Order status sync | Every dashboard depends on current status |
| Order creation → SoftPro | New orders must exist in SoftPro |
| Contact/lookup code sync | All user/party lookups depend on this |
| Document upload to SoftPro | CPL, proposed insured are core workflows |
| Prelim report fetch (webhook) | Title officers need prelim docs immediately |
| User authentication against `pct_softpro_lookup_table` | All login depends on this table |
| Order detail view (admin + frontend) | Primary daily-use screen |
| Dashboard with status filters | All user types need this |
| Contact autocomplete (company + person) | Required for order forms and CPL |

### Bucket 2 — Should-Have Soon After Launch

| Feature | Reason |
|---|---|
| Policy document webhook | Escrow needs policy docs; can be manual initially |
| Milestone/recording confirmation webhook | SMS notifications are valued but not blocking |
| Prelim summary AI analysis (Tessa) | Adds value but not core workflow |
| Failed API retry mechanism | Important for reliability, can be manual initially |
| Admin user/company CRUD → SoftPro | Admin manages contacts; can use SoftPro directly initially |
| Note creation → SoftPro | Useful for audit trail but not blocking |
| Task status updates | Part of workflow completeness |
| Sales rep/title officer dashboards | Important for users but can launch with basic order list |

### Bucket 3 — Legacy/Optional/Nice-to-Have

| Feature | Reason |
|---|---|
| Revenue import from PowerBI | Reporting concern; separate from core ops |
| 9 separate lookup code sync cron jobs | Can be consolidated into 1–2 jobs in vNext |
| Login credential migration helpers | One-time migration; already done |
| LP order "send to SoftPro" flow | LP-specific legacy workflow |
| Commission calculation | Reporting; out of scope |
| All legacy admin entity listing pages (10+ pages) | Can be consolidated into a single contacts admin |
| Survey email automation | Marketing; not core ops |
| TitlePoint integration data | Separate integration concern |

---

## Section 10 — Risks / Legacy Problems

### Duplicated Logic

- `Order.php` library and `Order_model.php` both construct nearly identical 6-way JOINs on `pct_softpro_lookup_table` — any schema change requires updating 4+ places
- `addNewUserToSoftpro()` exists in both `admin/Home.php` controller AND `Order.php` library with different implementations
- Lookup code sync has 9 nearly identical methods differing only by `userType` parameter

### Insecure Endpoints

- **All cron routes are publicly accessible** — no authentication, no IP restriction, no cron secret token
- Webhook receivers (`post-prelim-report`, `post-policy-document`, `post-milestone`) have no request validation or signature verification
- `PHP_AUTH` credentials are hardcoded in `constants.php` in plaintext
- SSL verification is disabled for GET requests (`CURLOPT_SSL_VERIFYPEER = false`)

### Hardcoded Config

- `PCT_CONTACTS` hardcodes specific employee emails and phone numbers in `constants.php`
- `SOFTPRO_TASK_ID` hardcodes task codes
- `UNDERWRITERS` and `COUNTRY_CODE` hardcoded
- `PAY_PERIOD_START` hardcoded to `2022-03-21`

### Poor Error Handling

- `SoftPro::make_request()` has commented-out `curl_close()` after a return statement (curl handle leaks)
- `loginSoftPro()` has a `die` statement making it unusable
- Many methods silently swallow API errors and continue processing
- `recallFailedAPI()` retries without backoff or max attempts
- Revenue import and order sync continue processing even when individual records fail

### Hidden Coupling

- `pct_resware_log` table stores SoftPro logs despite the name — any log analysis must know this
- `customer_basic_details` table is fully replaced by `pct_softpro_lookup_table` but old references are only commented out, not removed
- `is_softpro_order = 1` is the universal filter but is set in multiple places with no single source of truth
- `file_number` is used as both a display field and the SoftPro API match key — if it's wrong, the order is orphaned

### Partial Data Writes

- `updateAllSoftProOrderStatus()` explicitly does NOT write `sent_to_accounting_date` or `premium` — these only come from the separate revenue import
- `fetchSoftproOrders()` creates `property_details` and `transaction_details` but may leave FK references null if lookup codes don't match
- Contact sync maps by `lookup_code` — if the code format changes, all lookups break silently

### Stale DB Data

- All dashboard/listing views read from cached local DB, not SoftPro directly
- Lookup code sync runs on a cron schedule — new contacts in SoftPro won't appear until next sync
- Order status may be hours behind if cron fails
- The "Sync SoftPro" button on admin order list is the only way to force a fresh sync per order

### Do NOT Copy to vNext

- The 6-way JOIN pattern with 6 aliases of the same table
- The 9 nearly-identical lookup code sync methods
- Publicly accessible cron endpoints
- Unvalidated webhook receivers
- The `pct_resware_log` table name
- The `if (false)` auth header block in `make_request()`
- Any `die` statements in library code
- Disabled SSL verification

---

## Section 11 — vNext Recommendations

### Minimum Routes Needed

| Route | Purpose | Method |
|---|---|---|
| `POST /api/orders` | Create order in SoftPro | Outbound |
| `GET /api/orders/sync` | Import/refresh orders from SoftPro | Inbound |
| `GET /api/orders/:id` | Get order details | DB read |
| `PATCH /api/orders/:id/status` | Update order status (triggered by sync or webhook) | Inbound |
| `POST /api/orders/:id/documents` | Upload document to SoftPro | Outbound |
| `POST /api/orders/:id/notes` | Add note to SoftPro | Outbound |
| `POST /api/webhooks/softpro/prelim` | Receive prelim report push | Webhook |
| `POST /api/webhooks/softpro/policy` | Receive policy document push | Webhook |
| `POST /api/webhooks/softpro/milestone` | Receive milestone event | Webhook |
| `GET /api/contacts/sync` | Sync all contact types from SoftPro | Inbound |
| `GET /api/contacts/search` | Autocomplete search | DB read |
| `POST /api/contacts` | Create contact in SoftPro | Outbound |
| `PUT /api/contacts/:id` | Update contact in SoftPro | Outbound |
| `POST /api/companies` | Create company in SoftPro | Outbound |
| `PUT /api/companies/:id` | Update company in SoftPro | Outbound |

### Minimum DB Entities

| Entity | Replaces |
|---|---|
| `orders` | `order_details` + `transaction_details` (merge into one) |
| `properties` | `property_details` |
| `contacts` | `pct_softpro_lookup_table` (with typed roles, not 12 boolean flags) |
| `companies` | `sp_company` |
| `documents` | `pct_order_documents` |
| `prelim_summaries` | `pct_order_prelim_summary` |
| `api_logs` | `pct_resware_log` + `pct_api_logs` + `pct_failed_api_logs` (consolidate) |
| `product_types` | `pct_softpro_product_type` |
| `order_types` | `pct_softpro_order_type` |

### Scheduled Job vs User Action

| Task | Recommendation |
|---|---|
| Order import/sync | **Scheduled job** (every 15 min) + on-demand button |
| Order status sync | **Scheduled job** (every 15 min) |
| Contact/lookup sync | **Single scheduled job** (daily, all entity types in one run) |
| Document upload | **User action** (immediate) |
| Prelim/policy/milestone | **Webhook** (real-time, with auth) |
| Failed retry | **Scheduled job** (hourly, with backoff + max attempts) |
| Revenue import | **Separate service** (not part of core hub) |

### Admin vs Client Portal

| Feature | Admin | Client Portal |
|---|---|---|
| Order management CRUD | Yes | Read-only dashboard |
| Contact/company CRUD | Yes | No |
| Document upload | Yes | Yes (limited) |
| Sync triggers | Yes | No |
| Webhook config | Yes | No |
| Status views | Full | Own orders only |

### What Should Remain Internal-Only

- All webhook receiver endpoints (authenticated, not publicly routable)
- Sync/cron triggers (admin-only with auth)
- User/company CRUD to SoftPro (admin-only)
- API log viewing (admin-only)

### What Should Be Eliminated

- 9 separate lookup sync cron jobs → 1 parameterized job
- 10+ admin entity listing pages → 1 unified contacts admin with role filters
- Duplicated query logic → single data access layer
- `pct_resware_log` naming → proper `api_logs` table
- Hardcoded credentials → environment-only secrets
- SSL verification bypass → proper cert management
- `customer_basic_details` remnants → clean removal
- Commission/revenue logic → separate service

---

## Section 12 — Appendix

### Key File Paths

```
application/libraries/order/SoftPro.php          # Core API client
application/libraries/order/Order.php             # Order business logic + API helpers
application/libraries/order/Common.php            # Shared utilities
application/libraries/order/Common_lib.php        # Extended shared utilities
application/config/constants.php                  # SOFTPRO_API_END, SOFTPRO_TASK_ID
application/config/routes.php                     # All route definitions
application/helpers/common_helper.php             # getSoftproAPIUrl()

# Cron / Sync
application/modules/frontend/controllers/order/Cron.php     # 25+ sync methods

# Frontend Controllers
application/modules/frontend/controllers/order/Common.php   # User-facing actions
application/modules/frontend/controllers/order/Home.php      # Order submission
application/modules/frontend/controllers/order/Dashboard.php # Dashboard

# Admin Controllers
application/modules/admin/controllers/order/Home.php    # Admin hub (40+ SP methods)
application/modules/admin/controllers/order/Order.php   # Order admin
application/modules/admin/controllers/order/Sales.php   # Sales rep admin
application/modules/admin/controllers/order/Title.php   # Title officer admin
application/modules/admin/controllers/order/Agent.php   # Agent admin

# Models
application/modules/admin/models/order/Home_model.php
application/modules/admin/models/order/Order_model.php
application/modules/admin/models/order/Customer_model.php
application/modules/admin/models/order/Sales_model.php
application/modules/admin/models/order/Title_model.php
application/modules/frontend/models/order/Home_model.php
application/modules/frontend/models/order/SalesRep_model.php

# JavaScript
assets/backend/js/order.js           # syncOrderNumberFromSoftpro
assets/backend/js/custom.js          # DataTables for SP entities
assets/frontend/js/order/cpl.js      # CPL lender autocomplete
assets/frontend/js/order/proposed.js # Proposed insured autocomplete
```

### SoftPro API Endpoint Constants

```php
SOFTPRO_API_END = [
    'create_order'             => 'ordercreation/create',
    'update_order'             => 'ordercreation/updateOrder',
    'get_order_contacts'       => 'ordercreation/GetOrderContacts',
    'upload_document'          => 'ordercreation/AddDocuments',
    'fetch_lookup_code'        => 'lookup/GetLookuptable',
    'fetch_sales_reps'         => 'ordercreation/GetOrderMarketingRep',
    'get_all_order_status'     => 'ordercreation/GetOrders',
    'create_user'              => 'ordercreation/CreateUser',
    'update_user'              => 'ordercreation/UpdateUser',
    'add_note'                 => 'ordercreation/AddNotes',
    'get_prelim_documents'     => 'ordercreation/GetAttachedDocuments',
    'add_company'              => 'ordercreation/AddCompany',
    'update_company'           => 'ordercreation/UpdateCompany',
    'update_task'              => 'ordercreation/AddTask',
    'get_sales_figure'         => 'ordercreation/GetFilteredOrders',
    'get_softpro_orders'       => 'ordercreation/GetOrderDetails',
    'get_bulk_prelim_report'   => 'ordercreation/GetAttachedDocumentsFromOrders',
    'get_single_prelim_report' => 'ordercreation/GetAttachedDocumentsPrelim',
    'get_fees'                 => 'ordercreation/GetFees',
    'get_prelim_summary'       => 'ordercreation/GetPrelim',
    'power_bi_revenue'         => 'powerbi/createExcel',
];
```

### Environment Variables

```
SOFT_PRO_API    — Base URL for SoftPro API
SOFT_PRO_TOKEN  — HMAC secret key (used in loginSoftPro, possibly unused in production)
```

### Lookup Code Generation Pattern

```
Person:  First3 + Last3 + Company4  (e.g., "JohDoeComp")
Company: Name4 + AddressNumeric     (e.g., "Paci123" with uniqueness suffix)
```
