# Legacy Admin Module — Full Extraction

> **Purpose:** Complete architectural audit of the admin module in the legacy Transaction Desk (CodeIgniter HMVC).  
> **Scope:** Admin controllers, views, routes, auth/roles, workflows, and admin-only vendor actions.  
> **Excludes:** Revenue import logic body, reporting/metrics query internals (pages are listed but not dissected).  
> **Generated:** 2026-03-10

---

## 1) Admin Module Map

### Controllers — `application/modules/admin/controllers/order/`

| Controller | Methods | Purpose | Models/Libraries |
|---|---|---|---|
| **Home.php** (~180 methods, ~9,940 lines) | User CRUD, company CRUD, SoftPro entity management, document listings, LP management, notifications, logs, settings, imports, email triggers | Central admin hub — handles ~75% of admin functionality | `home_model`, `order_model`, `sales_model`, `title_model`, `payoff_model`, `softPro`, `order` lib, `apiLogs`, `CSVReader`, `twilio` |
| **Order.php** (~22 methods) | Order listing, order details, export, LP orders, revenue import, API logs, CPL error logs, Safewire orders | Order management and log viewing | `order_model`, `sales_model`, `title_model`, `home_model`, `partnerApiLogs` |
| **Login.php** | `login()`, `do_login()` | Admin authentication | `home_model` (bcrypt verify) |
| **AdminUsers.php** | Admin user CRUD, email check, delete | Admin account management (Super Admin only) | `admin_user_model` |
| **UsersRole.php** | Role CRUD, delete | Role management (Super Admin only) | `users_roles_model` |
| **Sales.php** (~9 methods) | Sales rep listing, edit, delete, SoftPro sales reps, mail flag toggle | Sales rep administration | `sales_model`, `order` lib (S3 upload) |
| **Title.php** (~8 methods) | Title officer listing, add/edit/delete, SoftPro title officers, email flag toggle | Title officer administration | `title_model`, `home_model` |
| **Agent.php** (~6 methods) | Agent listing, import CSV, edit (→SoftPro API), delete | Agent administration | `agent_model`, `home_model`, `softPro` lib |
| **TitlePoint.php** (~13 methods) | LV logs, pre-listing logs, grant deed logs, tax logs/data, LP XML logs | TitlePoint log viewing and regeneration | `titlePoint_model`, `order` lib |
| **Cpl.php** (~8 methods) | North American, Westcor, Commonwealth, Doma branch listings + refresh from vendor APIs | CPL underwriter branch management | `natic`, `westcor`, `fnf` libs |
| **Payoff.php** (~11 methods) | Transactee CRUD, document upload (S3), approval, payoff order listing | Payoff/wire approval workflow | `transactee_model`, `order` lib |
| **ProposedInsured.php** (~3 methods) | Proposed insured branch CRUD | Branch address management (Super Admin only) | `branches_model` |
| **Fees.php** (~5 methods) | Fee CRUD | Fee schedule management (Master Admin only) | `fees_model`, `feesTypes_model` |
| **FeesTypes.php** (~5 methods) | Fee type CRUD | Fee type management (Master Admin only) | `feesTypes_model` |
| **Reports.php** (~15 methods) | Branch analytics, R14, sales ranking, title officer, escrow reports | Report page rendering + data generation | `order` lib |
| **ManagementReports.php** (~20 methods) | Daily revenue, R14 branches/ranking, title officer production, escrow production | New management report system | `order` lib |
| **RulesManager.php** (~3 methods) | Rules listing, county assignment | Business rule configuration (Master Admin only) | `rulesManager_model`, `counties_model` |

### Models — `application/modules/admin/models/order/`

| Model | Table | Purpose |
|---|---|---|
| `Home_model.php` | `pct_softpro_lookup_table`, `sp_company`, `order_details`, `pct_order_documents` + many more | Universal admin query hub — 40+ query methods for all entity listings, document queries, user searches |
| `Order_model.php` | `order_details`, `transaction_details`, `pct_softpro_lookup_table` | Order listing with 6-way JOIN on lookup table, LP orders, order counts |
| `Customer_model.php` | `pct_softpro_lookup_table` | Customer/contact CRUD |
| `Sales_model.php` | `pct_softpro_lookup_table` | Sales rep queries + CRUD |
| `Title_model.php` | `pct_softpro_lookup_table` | Title officer queries + CRUD |
| `Agent_model.php` | Agents table | Agent queries + CRUD |
| `Admin_user_model.php` | `admin` | Admin user CRUD with bcrypt password |
| `Users_roles_model.php` | `pct_users_role` | Role CRUD |
| `Customer_basic_details_model.php` | `customer_basic_details` | Legacy customer table (being replaced by `pct_softpro_lookup_table`) |
| `Transactee_model.php` | `pct_vendors` | Transactee/payoff wire CRUD |
| `Payoff_model.php` | `customer_basic_details` | Payoff user queries |
| `TitlePoint_model.php` | `pct_order_title_point_data` | TitlePoint log queries |
| `TitlePointData.php` | `pct_order_title_point_data` | TitlePoint data records |
| `TitlePointDocumentRecords.php` | `pct_title_point_document_records` | TitlePoint document instrument records |
| `TitleOfficerForms.php` | Forms table | Title officer form queries |
| `Fees_model.php` | Fees table | Fee CRUD |
| `FeesTypes_model.php` | Fee types table | Fee type CRUD |
| `RulesManager_model.php` | `pct_order_rules_manager` | Rules queries + county updates |
| `Counties_model.php` | Counties table | County reference data |
| `Branches_model.php` | `pct_proposed_insured_branches` | Proposed insured branch CRUD |
| `Config_settings_model.php` | `pct_configs` | System config flag queries |
| `Document.php` | `pct_order_documents` | Document record queries |
| `FileDocument_model.php` | File document table | File/form document queries |
| `PartnerApiLogs.php` | `pct_partner_api_logs` | Partner API log queries |
| `ApiLogs.php` | `pct_order_api_logs` | API sync log queries |
| `Commission_bonus_model.php` | Commission bonus table | Commission calculation (out of scope) |
| `Commission_range_model.php` | Commission range table | Commission ranges (out of scope) |
| `Sales_rep_commission_override_model.php` | Commission override table | Commission overrides (out of scope) |
| `Underwriter_tier_model.php` | Underwriter tiers | Underwriter configuration |
| `Underwriter_user_model.php` | Underwriter users | Underwriter assignment |
| `TwilioMessage.php` | `pct_twilio_messages` | SMS log records |

### Views — `application/modules/admin/views/order/`

**236 PHP view files across 15 subdirectories:**

| Directory | Count | Purpose |
|---|---|---|
| `layout/` | 6 | Template shell (header, sidebar, footer, template wrapper) |
| `home/` | ~87 | Dashboard, all entity listings, add/edit forms, imports, document listings, log viewers, settings |
| `order/` | 4 | Orders listing, LP orders listing, order details, revenue import |
| `reports/` | 11 | Branch analytics, sales rep, title officer, escrow reports |
| `sales/` | 5 | Sales rep listing + edit forms |
| `title/` | 4 | Title officer listing + forms |
| `agent/` | 3 | Agent listing, import, edit |
| `role/` | 1 | Role listing + add modal |
| `proposed/` | 1 | Proposed insured branches |
| `payoff/` | 3 | Payoff user listing + forms |
| `transactee/` | 3 | Transactee listing + forms |
| `cpl/` | 4 | Underwriter branch listings |
| `dailyEmailReceiver/` | 3 | Daily email control |
| `escrow_instruction/` | 1 | Escrow instruction listing |
| `admin/` | 1 | Admin users listing |

### Config

- `application/modules/admin/config/` — Contains only `index.html` (empty placeholder). No module-specific config; all admin config lives in the global `application/config/constants.php`.

---

## 2) Admin Navigation / Menus

### Sidebar Location

`application/modules/admin/views/order/layout/newsidebar.php`

### Menu Structure

All routes prefixed with `order/admin/`. Visibility governed by role-derived permission flags.

```
Dashboard                           [allAdminPermission]
├── Orders ▾                        [allAdminPermission || escrowAdminPermission]
│   ├── Orders                      → orders
│   ├── LP Orders                   → lp-orders  [hidden if role_id=3]
│   └── Import Revenue Data         → import-revenue-data  [hidden if role_id=3]
├── Clients ▾  [CSS: hide]          [allAdminPermission]
│   ├── Agents                      → agents
│   ├── Escrow                      → escrow
│   ├── Lenders                     → lenders
│   ├── Mortgage Brokers            → mortgage-brokers
│   ├── Companies                   → companies
│   ├── Client Type                 → client-users-list
│   └── New Clients                 → new-users
├── SoftPro Clients ▾               [allAdminPermission]
│   ├── Agents                      → softpro-agents
│   ├── Escrow                      → softpro-escrow
│   ├── Lenders                     → softpro-lenders
│   ├── Mortgage Brokers            → softpro-mortgage-brokers
│   ├── Companies                   → softpro-companies
│   └── New Clients                 → softpro-new-users
├── PCT Users ▾  [CSS: hide]        [allAdminPermission]
│   ├── Admin                       → admin_users  [Super Admin only]
│   ├── Sales Rep.                  → sales-rep  [hidden from CS Admin]
│   ├── Title Officer               → title-officers
│   ├── Master Users                → master-users
│   ├── CPL/Proposed Users          → cpl-proposed-users
│   ├── Escrow Officers             → escrow-officers
│   └── Title Production            → title-production
├── SoftPro PCT Users ▾             [allAdminPermission]
│   ├── Admin                       → admin_users  [Super Admin only]
│   ├── Master Users                → master-users
│   ├── Sales Reps                  → softpro-sales-reps  [hidden from CS Admin]
│   ├── Title Officer               → softpro-title-officers
│   ├── Escrow Officers             → softpro-escrow-officers
│   ├── Title Production            → softpro-title-production
│   └── Escrow Production           → softpro-escrow-production
├── Report ▾                        [reportPermission: Executive, Super Admin]
│   ├── Daily Revenue               → branch-analytics-report
│   ├── R-14 Branches               → sales-rep-branch-report
│   ├── R-14 Ranking                → sales-ranking-report
│   ├── Title Officer Production    → title-officer-production-report
│   └── Escrow                      → escrow-branch-report
├── Logs ▾                          [allAdminPermission]
│   ├── Legal Vesting               → lv-log
│   ├── Pre Listing                 → pre-listing
│   ├── Grant Deed                  → grant-deed-log
│   ├── Tax Data                    → tax-data
│   ├── Tax Document                → tax-log
│   ├── CPL Error                   → cpl-error-logs
│   ├── LP Xml                      → lp-xml-logs
│   ├── Recording Email Logs        → recording-email-logs  [Super Admin only]
│   ├── Admin Activity              → admin-user-logs  [Super Admin only]
│   ├── Cron Logs                   → cron-logs  [Super Admin only]
│   └── SMS Logs                    → sms-logs  [Super Admin only]
├── Documents ▾                     [allAdminPermission]
│   ├── CPL                         → cpl-documents
│   ├── Grant Deed                  → grant-deed-documents
│   ├── Legal & Vesting             → lv-documents
│   ├── Tax                         → tax-documents
│   ├── Policy                      → policy-documents
│   ├── Curative                    → curative-documents
│   └── Forms                       → file-documents
├── Branches ▾                      [allAdminPermission]
│   ├── CPL - North American        → north-american-branches
│   ├── CPL - Westcor               → westcor-branches
│   ├── CPL - Commonwealth          → commonwealth-branches
│   └── Proposed Insured            → proposed-branches
├── Settings ▾                      [allAdminPermission]
│   ├── User Roles                  → roles  [Super Admin only]
│   ├── Send Password               → send-password  [hidden from CS Admin]
│   ├── Fees Types                  → fees-types  [hidden from CS Admin]
│   ├── Fees                        → fees  [hidden from CS Admin]
│   ├── Rules Manager               → rules-manager  [hidden from CS Admin]
│   ├── Notifications               → notifications  [hidden from CS Admin]
│   ├── LP Document Types           → lp-document-types  [hidden from CS Admin]
│   ├── LP Alert                    → lp-alert  [hidden from CS Admin]
│   ├── Daily Email Control         → daily-email-control  [hidden from CS Admin]
│   ├── Settings                    → settings  [hidden from CS Admin]
│   ├── Manual Report               → manual-report  [hidden from CS Admin]
│   ├── Manual Buyer                → manual-buyers  [hidden from CS Admin]
│   └── Surveys                     → surveys  [hidden from CS Admin]
├── Payoffs ▾                       [payoffPermission]
│   ├── Payoff Team                 → payoff-users
│   └── Transactee List             → transactees-list
└── Logout
```

### Feature Flags / Hidden Items

- **Clients** section has `class="hide"` (CSS hidden) — superseded by SoftPro Clients
- **PCT Users** section has `class="hide"` — superseded by SoftPro PCT Users
- **Commented out items:** Partner Api logs, ResWare logs, Pre Listing docs, LP Listing docs
- **Special case:** `upwork@pct.com` email → minimal sidebar (Settings dropdown only)
- **`$escrowAdminPermission`** is declared but never set to `true` in sidebar — effectively dead code

---

## 3) Auth / Roles / Permission Model

### Authentication Flow

**Login:** `POST do_login` → `Home_model::get_admin_user($email, $password)` → queries `admin` table → `password_verify()` (bcrypt)

**Session setup on success:**

```php
$session_data = [
    "id"            => $admin['id'],
    "name"          => $admin['first_name'] . ' ' . $admin['last_name'],
    "email_address" => $admin['email_id'],
    "is_admin"      => 1,        // hardcoded
    "role_id"       => $admin['role_id'],
];
$this->session->set_userdata('admin', $session_data);
```

**Activity logging:** Every login writes to `pct_admin_activity_logs`

**Post-login routing:**
- `upwork@pct.com` → `order/admin/credentials-check`
- `role_id == 3` → `order/admin/orders`
- Default → `order/admin/dashboard`

### Role Table

**Table:** `pct_users_role` — Fields: `id`, `title`

| role_id | Title (inferred) | Access Level |
|---|---|---|
| 1 | Super Admin | Full access to everything |
| 2 | Admin | Standard admin (most features) |
| 3 | *(unnamed)* | Restricted — orders only, no LP Orders, no Import Revenue, no dashboard |
| 4 | CS Admin | Limited admin — export/sync/settings buttons hidden |
| 5 | *(unnamed)* | Payoff-only — redirected to transactees-list |
| — | Executive | Reports access only |
| — | Payoff Admin | Payoff section access |
| — | Payoff Super Admin | Full payoff access |
| — | Escrow Admin | Order access (sidebar flag exists but is dead code) |

### Permission Guard Methods

Located in `application/libraries/order/Common_lib.php`:

| Guard Method | Session Check | Roles Allowed | On Failure |
|---|---|---|---|
| `is_admin()` | `admin.id` + `is_admin == 1` | All admin roles | Redirect → `order/admin` |
| `is_super_admin()` | `admin.id` + `is_admin == 1` + `role_id == 1` | Super Admin only | Destroy session, redirect |
| `if_super_admin()` | Same as above | Same | Returns `false` (no redirect) |
| `checkAllAdminAccess()` | role name ∈ `[Admin, Super Admin, CS Admin]` | Admin, Super Admin, CS Admin | Destroy session, redirect |
| `checkMasterAdminAccess()` | role name ∈ `[Admin, Super Admin]` | Admin, Super Admin | Destroy session, redirect |
| `checkOrdersAdminAccess()` | role name ∈ `[Admin, Super Admin, CS Admin, Escrow Admin]` | Admin, Super, CS, Escrow | Destroy session, redirect |
| `checkReportsAdminAccess()` | role name ∈ `[Executive, Super Admin]` | Executive, Super Admin | Destroy session, redirect |
| `checkPayoffAccess()` | role name ∈ `[Payoff Admin, Super Admin, Payoff Super Admin]` | Payoff roles | Destroy session, redirect |
| `checkRoleAccess()` | If `role_id == 5` → redirect to transactees | Role 5 redirect | Redirect |

### Where Auth Is Applied

| Level | Pattern |
|---|---|
| **Constructor** | Every admin controller calls at least `is_admin()` in constructor |
| **Per-method** | Many methods in `Home.php` have additional `checkAllAdminAccess()`, `checkMasterAdminAccess()`, etc. |
| **View** | Sidebar uses `$allAdminPermission`, `$reportPermission`, `$payoffPermission` + `$role_id` checks |
| **No RLS** | There is no row-level security or branch scoping — all admins see all data for their permission level |

---

## 4) Admin Workflows (Top 15)

### 1. User Management (SoftPro Users)

| Step | Action |
|---|---|
| Admin navigates to SoftPro Clients → New Clients | Sidebar link |
| Clicks "Add New User" | Form renders |
| Fills: user type, name, email, company, phone, address, lookup code | Standard form fields |
| Submits | `Home::addSoftProNewUser()` → validates → calls SoftPro `create_user` API → inserts into `pct_softpro_lookup_table` |
| **Tables:** `pct_softpro_lookup_table`, `pct_resware_log` | **API:** SoftPro `CreateUser` |

### 2. Editing Users / Agents

| Step | Action |
|---|---|
| Admin clicks Edit on any entity listing | Edit form loads with current data |
| Updates fields, submits | `Home::editUser()` or `Agent::edit()` → calls `softPro->updateUserToSoftpro()` → updates `pct_softpro_lookup_table` |
| **Tables:** `pct_softpro_lookup_table`, `pct_resware_log` | **API:** SoftPro `UpdateUser` |

### 3. Assigning Sales Rep / Title Officer to Company

| Step | Action |
|---|---|
| Admin opens Companies or SoftPro Companies listing | DataTable renders with dropdown selectors in each row |
| Selects sales rep or title officer from inline dropdown | AJAX `updateTitleSalesSPCompany()` / `updateTitleSalesCompany()` |
| **Tables:** `sp_company` or `pct_order_partner_company_info` | **API:** None |

### 4. Assigning Sales Rep to Order

| Step | Action |
|---|---|
| Admin opens order listing, selects sales rep dropdown on an order row | Inline dropdown |
| Selects new rep | AJAX `updateSalesUserForOrder()` → updates `transaction_details.sales_representative` |
| **Tables:** `transaction_details` | **API:** None |

### 5. Send LP Order to SoftPro

| Step | Action |
|---|---|
| Admin opens LP Orders listing | DataTable with action menu per order |
| Clicks "Send Order Softpro" on an LP order | JS `sendOrderToSoftpro()` → `Home::sendOrderToSoftpro()` |
| Controller assembles full payload (parties, property, transaction), POSTs to SoftPro | SoftPro `create_order` → returns `OrderNumber` |
| File number saved, documents uploaded, confirmation emails sent | Updates `order_details`, uploads docs, sends emails |
| **Tables:** `order_details`, `transaction_details`, `property_details`, `pct_resware_log`, `sp_file_upload_logs` | **API:** SoftPro `create_order` + `AddDocuments` |

### 6. SoftPro Company CRUD

| Step | Action |
|---|---|
| Admin opens SoftPro Companies | Listing page |
| Clicks "Add Company" / Edit | Form with name, lookup code, address, type flags |
| Submits | `Home::spAddCompany()` / `spEditCompany()` → SoftPro `AddCompany` / `UpdateCompany` → inserts/updates `sp_company` |
| **Tables:** `sp_company`, `pct_resware_log` | **API:** SoftPro `AddCompany` or `UpdateCompany` |

### 7. Forcing SoftPro Sync

| Step | Action |
|---|---|
| Admin opens Orders listing | "Sync Order Number" button in toolbar |
| Clicks sync → enters order number in modal | JS `syncOrderNumberFromSoftpro()` |
| System calls `fetch-softpro-orders?orderNumber=X` | Cron controller fetches single order from SoftPro |
| **Tables:** `order_details`, `transaction_details`, `property_details` | **API:** SoftPro `GetOrderDetails` |

### 8. LP Report Regeneration

| Step | Action |
|---|---|
| Admin opens LP Orders listing | Action menu per order |
| Clicks "Regenerate Report" | JS `regenerateReport()` → `Home::regenerateReport()` |
| System re-queries TitlePoint, rebuilds PDF | Updates `pct_order_title_point_data`, regenerates LP PDF |
| **Tables:** `pct_order_title_point_data`, `pct_title_point_document_records` | **API:** TitlePoint |

### 9. LP Report Status Update + Notifications

| Step | Action |
|---|---|
| Admin reviews LP order, selects status from dropdown (Approved / Rejected / etc.) | Inline dropdown in LP Orders DataTable |
| Submits | `Home::updateLpReportStatus()` → updates `order_details` status |
| If approved: sends Twilio SMS + SendGrid email to customer | External API calls |
| **Tables:** `order_details`, `pct_twilio_messages` | **API:** Twilio SMS, SendGrid email |

### 10. Document Upload + Attach to SoftPro

| Step | Action |
|---|---|
| Admin or user uploads document on order | File upload form (various locations) |
| File saved to local disk → uploaded to AWS S3 | `order->uploadDocumentOnAwsS3()` |
| Record created in `pct_order_documents` | Insert with `is_sync=0` |
| System attempts SoftPro upload | `order->uploadCPLDocumentToSoftpro()` → SoftPro `AddDocuments` |
| If fails: logged to `sp_file_upload_logs` for retry | Cron `spSyncFailedDocument` retries later |
| **Tables:** `pct_order_documents`, `sp_file_upload_logs`, `pct_resware_log` | **API:** SoftPro `AddDocuments`, AWS S3 |

### 11. Refresh CPL Underwriter Branches

| Step | Action |
|---|---|
| Admin opens Branches → CPL - Westcor (or North American / Commonwealth) | Branch listing page |
| Clicks "Refresh Branches" button | AJAX → `Cpl::getWestcorBranches()` |
| System calls vendor API, replaces all local branch records | Truncates and re-inserts `pct_westcor_branches` (or equivalent) |
| **Tables:** `pct_westcor_branches`, `pct_natic_branches`, `pct_fnf_agents` | **API:** Westcor, NATIC/Doma, FNF/Commonwealth |

### 12. Notification Email Preview + Editing

| Step | Action |
|---|---|
| Admin opens Settings → Notifications | DataTable of notification templates |
| Clicks "Preview" on a template | Modal opens with rendered HTML via `Home::email_preview()` |
| **Tables:** `pct_notifications` | **API:** None |

### 13. Send Password Email

| Step | Action |
|---|---|
| Admin opens Settings → Send Password | DataTable of eligible users |
| Clicks "Send" on a user row | `Home::sendPasswordMail()` → generates random password → emails to user |
| **Tables:** `customer_basic_details` | **API:** Email (SendGrid) |

### 14. Payoff Transactee Approval

| Step | Action |
|---|---|
| Admin opens Payoffs → Transactee List | DataTable with approval checkboxes |
| Checks approve checkbox on transactee | AJAX `Payoff::update_transactee_status()` → sets `is_approved=1`, `approved_by`, `approved_date` |
| **Tables:** `pct_vendors` | **API:** None |

### 15. Audit Log Viewing

| Step | Action |
|---|---|
| Admin opens Logs → Admin Activity / Cron Logs / SMS Logs / Recording Email Logs | DataTable pages (Super Admin only) |
| Browses/searches/filters logs | Server-side DataTables queries against respective log tables |
| **Tables:** `pct_admin_activity_logs`, `pct_cron_logs`, `pct_twilio_messages`, `order_details` (recording emails) | **API:** None |

---

## 5) Admin Screens Inventory

### Dashboard & Orders

| Screen | View | Key Filters | DB Fields |
|---|---|---|---|
| Admin Dashboard | `home/dashboard.php` | None (summary cards) | Order counts, user counts, failed JSON counts |
| Orders Listing | `order/orders.php` | Keyword, product type, sales rep, date range, status | `file_number`, `softpro_status`, `prod_type`, `created_at`, `sales_representative` |
| LP Orders Listing | `order/lp_orders.php` | Keyword, date range, report status | `lp_file_number`, `created_at`, LP report status |
| Order Details | `order/order_details.php` | Order ID | Full order with customer, sales rep, property, lender, commission |
| Revenue Import | `order/import_revenue.php` | File upload (XLSX) | N/A |

### Entity Listings (SoftPro)

| Screen | View | Key Filters | DB Fields |
|---|---|---|---|
| SP Agents | `home/sp_agents.php` | Keyword search | `first_name`, `last_name`, `company_name`, `lookup_code` |
| SP Escrow | `home/sp_escrows.php` | Keyword search | Same + `is_escrow` flag |
| SP Lenders | `home/sp_lenders.php` | Keyword search | Same + `is_lender` flag |
| SP Mortgage Brokers | `home/sp_mortgage_brokers.php` | Keyword search | Same + `is_mortgage_broker` flag |
| SP New Users | `home/sp_new_users.php` | Keyword search | Same + `is_new_user` flag |
| SP Escrow Officers | `home/sp_escrow_officers.php` | Keyword search | `officer_name`, `closer_examiner`, `is_escrow_officer` |
| SP Title Officers | `title/sp_title.php` | Keyword search | Same + `is_title_officer` flag |
| SP Sales Reps | `sales/sp_sales.php` | Keyword search | `full_name`, `email_address`, `is_sales_rep` |
| SP Companies | `home/softpro_companies.php` | Keyword search | `name`, `lookup_code`, type flags |
| SP Title Production | `home/sp_title_production.php` | Keyword search | `first_name`, `last_name`, `is_title_production` |
| SP Escrow Production | `home/sp_escrow_production.php` | Keyword search | `first_name`, `last_name`, `is_escrow_production` |

### Document Listings

| Screen | View | Key Filters |
|---|---|---|
| CPL Documents | `home/cpl_document.php` | File number, date range |
| Grant Deed Documents | `home/grant_deed_document.php` | File number, date range |
| Policy Documents | `home/policy_document.php` | File number, date range |
| LV Documents | `home/lv_document.php` | File number, date range |
| Tax Documents | `home/tax_document.php` | File number, date range |
| Curative Documents | `home/curative_document.php` | File number, date range |
| Forms / Files | `home/file_document.php` | File number, date range |

### Log Viewers

| Screen | View | Key Filters | Role |
|---|---|---|---|
| LV Logs | `home/lv_logs.php` | Keyword, date range | All Admin |
| Pre-Listing Logs | `home/pre_listing_logs.php` | Keyword, date range | All Admin |
| Grant Deed Logs | `home/grant_deed_logs.php` | Keyword, date range | All Admin |
| Tax Data | `home/tax_data.php` | Keyword, date range | All Admin |
| Tax Logs | `home/tax_logs.php` | Keyword, date range | All Admin |
| LP XML Logs | `home/lp_xml_log.php` | Keyword, date range | All Admin |
| CPL Error Logs | `home/cpl_error_api_logs.php` | Keyword, date range | All Admin |
| Partner API Logs | `home/partner_api_logs.php` | Sales rep, title officer, date range | All Admin |
| Admin Activity Logs | `home/admin_user_logs.php` | Keyword, date range | Super Admin |
| Cron Logs | `home/cron_logs.php` | Keyword, date range | Super Admin |
| SMS Logs | `home/sms_logs.php` | Keyword, date range | Super Admin |
| Recording Email Logs | `home/recording_email_logs.php` | Keyword, date range | Super Admin |

### Settings & Configuration

| Screen | View | Role |
|---|---|---|
| System Settings | `home/settings.php` | Master Admin |
| User Roles | `role/index.php` | Super Admin |
| Fees | `home/fees.php` | Master Admin |
| Fee Types | `home/fees_types.php` | Master Admin |
| Rules Manager | `home/rules_manager.php` | Master Admin |
| Notifications | `home/notifications.php` | Master Admin |
| LP Document Types | `home/lp_document_types.php` | Master Admin |
| LP Alerts | `home/lp_alert.php` | Master Admin |
| Daily Email Control | `dailyEmailReceiver/daily-email-control.php` | Master Admin |
| Manual Report | `home/manual_report.php` | Master Admin |
| Manual Buyers | `home/manual_buyers.php` | Master Admin |
| Surveys | `home/surveys.php` | Master Admin |

### Reports (page names only — query logic out of scope)

| Screen | Route | Role |
|---|---|---|
| Branch Analytics / Daily Revenue | `branch-analytics-report` | Executive, Super Admin |
| R-14 Branches (Sales Rep) | `sales-rep-branch-report` | Executive, Super Admin |
| R-14 Ranking | `sales-ranking-report` | Executive, Super Admin |
| Title Officer Production | `title-officer-production-report` | Executive, Super Admin |
| Escrow Branch | `escrow-branch-report` | Executive, Super Admin |
| New Daily Revenue | `new-daily-revenue` | Any Admin |
| New R-14 Branches | `new-r14-branches` | Any Admin |
| New R-14 Ranking | `new-r14-ranking` | Any Admin |
| New Title Officer | `new-title-officer` | Any Admin |
| New Escrow Production | `new-escrow-production` | Any Admin |

---

## 6) Admin "Danger Buttons"

### Vendor API Calls (Outbound)

| Endpoint | Controller Method | Vendor | Protection | Risk |
|---|---|---|---|---|
| `order/admin/send-order-to-softpro` | `Home::sendOrderToSoftpro` | **SoftPro** | `is_admin()` | Creates a real order in SoftPro. Irreversible. No confirmation dialog in some code paths. |
| `order/admin/add-softpro-new-user` | `Home::addSoftProNewUser` | **SoftPro** | `is_admin()` | Creates a user in the production SoftPro system |
| `order/admin/softpro-add-company` | `Home::spAddCompany` | **SoftPro** | `checkAllAdminAccess()` | Creates a company in production SoftPro |
| `order/admin/edit-softpro-company/:num` | `Home::spEditCompany` | **SoftPro** | `checkAllAdminAccess()` | Modifies a company in production SoftPro |
| `order/admin/edit-user/:num` | `Home::editUser` | **SoftPro** | `is_admin()` | Syncs user changes to production SoftPro |
| `order/admin/edit-softpro-agent/:num` | `Agent::edit` | **SoftPro** | `is_admin()` | Syncs agent changes to production SoftPro |
| `order/admin/update-lp-report-status` | `Home::updateLpReportStatus` | **Twilio + SendGrid** | `checkOrdersAdminAccess()` | Sends SMS and email — could spam if triggered repeatedly |
| `get-north-american-branches` | `Cpl::getNorthAmericanBranches` | **NATIC/Doma** | `checkAllAdminAccess()` | Replaces all local branch data with API response |
| `get-westcor-branches` | `Cpl::getWestcorBranches` | **Westcor** | `checkAllAdminAccess()` | Same — replaces all branch data |
| `get-commonwealth-branches` | `Cpl::getCommonwealthBranches` | **FNF** | `checkAllAdminAccess()` | Same — replaces all branch data |

### Cron/Sync Triggers (Accessible from Admin UI)

| Endpoint | Trigger Location | Protection | Risk |
|---|---|---|---|
| `fetch-softpro-orders` | Orders listing "Sync" button | **None** (public cron route) | Can be called by anyone — imports/updates orders from SoftPro |
| `update-softpro-order-status` | Orders listing "Sync Status" button | **None** (public cron route) | Bulk status update across all orders |
| `fetch-revenue-report` | Revenue import "Fetch" button | **None** (public cron route) | Triggers revenue data import from SoftPro PowerBI |
| `fetch-sales-rep-lookup-code` | Orders listing sync buttons | **None** (public cron route) | Syncs lookup codes |
| `fetch-*-lookup-code` (9 routes) | Various sync buttons | **None** (public cron routes) | All 9 lookup sync endpoints are public |
| `update-safewire-orders-status` | Safewire orders page | **None** (public cron route) | Bulk Safewire status sync |
| `import-orders` | Import orders page | **None** (public cron route) | Bulk order import |

### Mass Update Actions

| Endpoint | Controller Method | Protection | Risk |
|---|---|---|---|
| `order/admin/update-order-details` | `Order::update_order_details` | `is_admin()` | Batch updates `partner_api_log_id` across all matching orders |
| `order/admin/import-revenue-data` | `Order::importRevenueData` | `checkOrdersAdminAccess()` | Overwrites premium, bill_code, transaction_date across hundreds of orders from a spreadsheet |
| `order/admin/import-agents` | `Agent::import_agents` | `is_admin()` | Bulk CSV import — can create/update thousands of agent records |
| `order/admin/import` | `Home::import` | `is_admin()` | Bulk CSV import of escrow users |
| `order/admin/import-lenders` | `Home::import_lenders` | `is_admin()` | Bulk CSV import of lenders |
| `refreshExipredPasswords` | `Home::refreshExipredPasswords` | `is_admin()` | Spawns CLI process to bulk-update passwords |

### Security Concerns

| Issue | Details |
|---|---|
| **Public cron endpoints** | All `fetch-*`, `import-*`, `update-*` cron routes have **zero authentication**. Anyone with the URL can trigger SoftPro syncs, order imports, and status updates. |
| **Hardcoded credentials** | `TitlePoint.php::make_request()` contains hardcoded ResWare passwords in the source code. `constants.php` contains `PHP_AUTH` credentials in plaintext. |
| **No CSRF protection visible** | Form submissions use standard POST but no CSRF token validation is apparent. |
| **No rate limiting** | Email/SMS triggers (`updateLpReportStatus`, `sendPasswordMail`, `sendBuyerEmail`) can be called repeatedly with no throttling. |
| **Session-only auth** | No IP restrictions, no 2FA, no session timeout configuration visible in admin module. |
| **No audit trail on deletes** | Soft-deletes (`status=0`) don't record who deleted or when in most cases. |

---

## vNext Admin Console — Replication Checklist

### Must Replicate (Core Admin Ops)

- [ ] Admin authentication with bcrypt + role-based access
- [ ] Role management (CRUD with at least: Super Admin, Admin, CS Admin, Executive, Payoff Admin)
- [ ] Order listing with status filters, search, date range, sales rep filter
- [ ] Order detail view (all party details, property, transaction)
- [ ] LP Order management (status updates, send to SoftPro, regenerate report)
- [ ] SoftPro entity CRUD (agents, escrow, lenders, mortgage brokers, companies, new users)
- [ ] SoftPro entity listings with DataTable pagination/search
- [ ] Sales rep management (edit, profile images, notification toggles)
- [ ] Title officer management (listing, email flag toggle)
- [ ] Company management with sales rep / title officer assignment
- [ ] Document listings (CPL, policy, grant deed, LV, tax, curative)
- [ ] Document download from S3
- [ ] Payoff/transactee workflow (approval, document upload, CRUD)
- [ ] Proposed insured branch management
- [ ] CPL underwriter branch management (refresh from vendor APIs)
- [ ] System settings (feature flags / toggles)
- [ ] Admin activity logging
- [ ] Notification template management

### Should Replicate (Important but Secondary)

- [ ] Fee and fee type management
- [ ] Rules manager (county assignment)
- [ ] Daily email control
- [ ] Manual report triggers
- [ ] LP document type management
- [ ] LP alert configuration
- [ ] Manual buyer entry
- [ ] Survey management
- [ ] TitlePoint log viewing
- [ ] CPL error log viewing
- [ ] SMS log viewing
- [ ] Recording email log viewing
- [ ] Cron log viewing
- [ ] CSV import (agents, users, lenders)
- [ ] Order export to CSV

### Must Fix in vNext (Security)

- [ ] **Authenticate all sync/cron endpoints** — add API key or admin-session requirement
- [ ] **Add CSRF protection** to all admin forms
- [ ] **Remove hardcoded credentials** from source code → environment variables only
- [ ] **Add rate limiting** to email/SMS trigger endpoints
- [ ] **Add audit trail** to all delete/status-change operations
- [ ] **Add confirmation dialogs** to vendor API calls (send to SoftPro, branch refresh)
- [ ] **Add session timeout** and optional 2FA for admin accounts
- [ ] **Consolidate duplicate entity pages** (legacy Clients + SoftPro Clients → one unified view)

### Can Eliminate

- [ ] Legacy "Clients" and "PCT Users" sections (hidden, superseded by SoftPro versions)
- [ ] `customer_basic_details` table references (migration complete)
- [ ] ResWare-era log viewers (commented out)
- [ ] `upwork@pct.com` special-case sidebar logic
- [ ] Incorrect Users page (legacy password-error tracking)
- [ ] Safewire orders (separate concern)
- [ ] Partner API logs (legacy vendor integration)
