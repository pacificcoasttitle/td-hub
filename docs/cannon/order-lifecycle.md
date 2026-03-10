# Order Lifecycle Domain Map

## Order Creation Methods

### 1. SoftPro API Sync (Primary Path)
- **Trigger:** Cron job `Cron::fetchSoftproOrders()` or `Cron::updateAllSoftProOrderStatus()`
- **Flow:** SoftPro API -> parse response -> INSERT into `order_details`, `property_details`, `transaction_details`
- **Fields set:** `file_number`, `file_id`, `customer_id`, `created_at`, `softpro_status`, `is_softpro_order=1`, `is_imported=1`
- **Fields NOT set:** `premium`, `sent_to_accounting_date`, `bill_code`

### 2. Manual Order Entry
- **Trigger:** User submits form via `frontend/Home::orderSubmit()`
- **Flow:** Form data -> validate -> INSERT order records -> optionally sync to SoftPro
- **Fields set:** All basic order fields from form

### 3. LP/Pre-Listing Orders
- **Trigger:** `admin/Order::lpOrders()` or pre-listing report conversion
- **Flow:** LP report generated -> approved -> converted to full order
- **Tracked by:** `lp_file_number` (LP identifier), `file_number` (set on conversion)

### 4. Legacy Resware Import
- **Trigger:** `Cron::import_orders_all_users()` (via Resware API)
- **Flow:** Resware API -> loop through users -> import their orders
- **Note:** This path DOES set `sent_to_accounting_date` and `premium` during creation (unlike SoftPro sync)

## Order State Machine

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
    ┌───────┐       │    ┌──────────┐     ┌──────────┐                │
    │CREATE │──────►│───►│   OPEN   │────►│  CLOSED  │                │
    └───────┘       │    │(softpro_ │     │(softpro_ │                │
                    │    │status=   │     │status=   │                │
                    │    │'open')   │     │'closed') │                │
                    │    └────┬─────┘     └──────────┘                │
                    │         │                                        │
                    │         ├────► CANCELED (softpro_status='canceled')
                    │         ├────► DUPLICATE (softpro_status='duplicate')
                    │         └────► INPROCESS (softpro_status='inprocess')
                    │                                                  │
                    │         COMPLETED (softpro_status='completed')    │
                    └──────────────────────────────────────────────────┘
```

## Revenue Recognition (The Critical Gap)

SoftPro sync sets `softpro_status = 'closed'` but does NOT set:
- `premium` (stays NULL)
- `sent_to_accounting_date` (stays NULL)

These are ONLY set by the manual Excel revenue import:
- Controller: `admin/Order::importRevenueData()` at `Order.php:570-835`
- Source: Excel file from SoftPro Ledger
- Bill codes processed: TPC, TPW, ESC, TSGW, UPRE
- `sent_to_accounting_date` = `transaction_date` from spreadsheet
- `premium` = aggregated amount from Column 42

## Open Order Query Logic

```php
// Order.php - Open order counting
WHERE is_softpro_order = 1
  AND file_number IS NOT NULL
  AND transaction_type = ['Refinance' | 'Purchase']
  AND MONTH(created_at) = $month
  AND YEAR(created_at) = $year
  AND sales_representative = $userId
  AND (softpro_status NOT IN ('closed','canceled','inprocess','duplicate')
       OR softpro_status IS NULL)
```

## Closed Order Query Logic

```php
// Order.php - Closed order counting
WHERE is_softpro_order = 1
  AND file_number IS NOT NULL
  AND transaction_type = ['Refinance' | 'Purchase']
  AND MONTH(sent_to_accounting_date) = $month
  AND YEAR(sent_to_accounting_date) = $year
  AND sales_representative = $userId
// NOTE: No softpro_status check -- relies entirely on sent_to_accounting_date
```

## Sales Rep Attribution

- **Field:** `transaction_details.sales_representative` (FK to `pct_softpro_lookup_table.id`)
- **Set by:** SoftPro sync (initial), Revenue import (can override), Admin manual edit
- **Used by:** All per-rep dashboards and reports

## Title Officer Attribution

- **Field:** `transaction_details.title_officer` (FK to `pct_softpro_lookup_table.id`)
- **Set by:** SoftPro sync
- **Used by:** Title Officer dashboard and production reports
