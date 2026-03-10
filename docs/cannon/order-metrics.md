# Order Metrics & Reporting Truth Table

## The Unified Metrics Problem

The system has NO single "metrics engine." Instead, 6+ reports each implement their own query logic with different filters, date fields, and lookback windows. This document maps every difference.

## Date Field Usage by Report

| Report | Open Date Field | Closed Date Field | Lookback (Open) | Lookback (Closed) |
|--------|----------------|-------------------|------------------|--------------------|
| Admin Dashboard | `created_at` | `sent_to_accounting_date` | Current month | Current month |
| R-14 Branch | `created_at` | `sent_to_accounting_date` | 3 months (4 on 1st) | 1 month (2 on 1st) |
| Escrow Branch | `created_at` | `sent_to_accounting_date` | 3 months | 1 month |
| Sales Ranking | `created_at` | `sent_to_accounting_date` | 3 months | 1 month |
| TO Production | `created_at` | `sent_to_accounting_date` | 3 months | 1 month |
| Branch Analytics | `created_at` | `sent_to_accounting_date` | **1 month** | **1 month** |
| Sales Dashboard | `created_at` | `sent_to_accounting_date` | Current month | Current month |
| Commission | N/A | `sent_to_accounting_date` | N/A | Current month |

## Filter Inclusion Matrix

| Filter | Admin Dash | R-14 | TO Prod | Branch Analytics | Sales Dash | Commission |
|--------|-----------|------|---------|-----------------|------------|------------|
| `is_softpro_order=1` | NO | YES | YES | YES | YES | YES |
| `file_number IS NOT NULL` | NO | YES | YES | YES | YES | YES |
| `transaction_type` filter | By `prod_type` | YES | YES | YES | YES | N/A |
| `sales_representative` | NO | YES | NO | NO | YES | YES |
| `title_officer` | NO | NO | YES | NO | NO | NO |
| `underwriter IS NOT NULL` | NO | NO | NO | NO | NO | YES |

## Closing Ratio Formulas

### Sales Rep (R-14 + Dashboard):
```
created_count = COUNT(orders WHERE created_at IN window AND sales_rep = X)
closed_count = COUNT(orders WHERE created_at IN window AND sent_to_accounting_date IN window AND sales_rep = X)
ratio = closed_count / created_count * 100
```
**Note:** Requires BOTH dates in window. Understates ratio for long-running orders.

### Title Officer:
```
created_count = COUNT(orders WHERE created_at IN window AND title_officer = X)
closed_count = COUNT(orders WHERE sent_to_accounting_date IN window AND title_officer = X)
ratio = closed_count / created_count * 100
```
**Note:** Does NOT require created_at in window for closed count. More inclusive.

## Revenue Sources

| Source | Sets `premium` | Sets `sent_to_accounting_date` | Sets `bill_code` | Sets `prod_type` |
|--------|---------------|-------------------------------|-------------------|-------------------|
| SoftPro Sync | NO | NO (commented out) | NO | NO |
| Revenue Import (Excel) | YES | YES (from transaction_date) | YES | YES (if provided) |
| Legacy Resware Import | YES | YES | NO | NO |

## Branch Determination

Branch is derived from `file_number` prefix (not stored as a field):
- `GLT` = Glendale
- `OCT` = Orange County
- `ONT` = Inland Empire
- `PRV` = Porterville
- `TSG` = TSG

**Risk:** Unrecognized prefixes cause orders to be silently skipped in branch-level reports with `continue` statements.

## Recommended Fix: Unified MetricsEngine

```php
class MetricsEngine {
    // Single source of truth for all report queries

    const OPEN_FILTERS = [
        'is_softpro_order' => 1,
        'file_number IS NOT NULL',
        'softpro_status NOT IN' => ['closed', 'canceled', 'inprocess', 'duplicate']
    ];

    const CLOSED_FILTERS = [
        'is_softpro_order' => 1,
        'file_number IS NOT NULL',
        'sent_to_accounting_date IS NOT NULL'
    ];

    // One method, all reports call this
    public function getOrderCounts($dateRange, $filters) { ... }
    public function getRevenue($dateRange, $filters) { ... }
    public function getClosingRatio($dateRange, $personId, $personType) { ... }
}
```
