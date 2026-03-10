# 05 — SoftPro Integration

## Role in the Hub
SoftPro is the operational source of truth for orders, statuses, contacts, and companies. The Hub mirrors SoftPro data locally and pushes documents/actions back. The browser never talks to SoftPro directly.

## API Configuration

| Setting | Value | Source |
|---------|-------|--------|
| Base URL | `SOFTPRO_API_URL` env var | Legacy: `getenv("SOFT_PRO_API")` |
| Auth | None in production (network-restricted API) | Legacy: HMAC exists in code but is inside `if(false)` |
| Content-Type | `application/json` | |
| Timeout | 60s (reduced from legacy 540s) | |
| Response shape | `{ Status: 200, Message: "...", data: T }` | |

**Important:** Legacy `make_request()` sends no auth headers. The API appears to be network-restricted. Verify with Jerry whether HMAC auth is needed for the new deployment.

## Endpoints Used

### Core (Phase 1)
| Key | Path | Method | Purpose |
|-----|------|--------|---------|
| `getOrderDetails` | `ordercreation/GetOrderDetails` | GET | Full order sync (new + update) |
| `getOrders` | `ordercreation/GetOrders` | GET | Status-only sync |
| `uploadDocument` | `ordercreation/AddDocuments` | POST | Push docs to SoftPro |
| `getLookupTable` | `lookup/GetLookuptable` | GET | Contact/entity sync (parameterized by userType) |
| `getOrderMarketingRep` | `ordercreation/GetOrderMarketingRep` | GET | Sales rep sync |

### Secondary (Phase 3+)
| Key | Path | Method | Purpose |
|-----|------|--------|---------|
| `createOrder` | `ordercreation/create` | POST | Send order to SoftPro |
| `updateOrder` | `ordercreation/updateOrder` | POST | Update order in SoftPro |
| `getOrderContacts` | `ordercreation/GetOrderContacts` | GET | Sync contacts for specific order |
| `createUser` | `ordercreation/CreateUser` | POST | Create user in SoftPro |
| `updateUser` | `ordercreation/UpdateUser` | POST | Update user in SoftPro |
| `addCompany` | `ordercreation/AddCompany` | POST | Create company in SoftPro |
| `updateCompany` | `ordercreation/UpdateCompany` | POST | Update company in SoftPro |
| `addNote` | `ordercreation/AddNotes` | POST | Add note to order |
| `updateTask` | `ordercreation/AddTask` | POST | Update task status |

### Webhooks (SoftPro → Hub)
| Route | Payload | Purpose |
|-------|---------|---------|
| `POST /api/webhooks/softpro/prelim` | `{OrderNumber, Status, data[]}` | Prelim report push |
| `POST /api/webhooks/softpro/policy` | `{OrderNumber, data[]{FileName, FileUrl}}` | Policy document push |
| `POST /api/webhooks/softpro/milestone` | `{OrderNumber, Id, Status}` | Task/milestone event |

## Core Sync Flows

### Flow 1: Sync Recent Orders (Primary)
**Legacy:** `Cron::fetchSoftproOrders()` → `GetOrderDetails`
**vNext:** Job `softpro.sync_recent_orders`

```
1. Determine date range (default: today)
2. Call GetOrderDetails?DateFrom=MM-DD-YYYY&DateTo=MM-DD-YYYY
3. For each order in response:
   a. Look up by file_number in local DB
   b. If NEW:
      - Create order record
      - Create order_properties from Address/City/State/Country
      - Map MarketingRep → salesRepId via contacts.officerName
      - Map TitleOfficer → titleOfficerId via contacts.officerName
      - Map ProductType → productType via reference lookup
      - Set source = 'softpro_sync', isImported = true
   c. If EXISTS:
      - Update softproStatus
      - Update dates (completedAt, closedAt) if changed
      - Update salesPrice if changed
      - Do NOT overwrite existing property data
4. For newly closed orders: emit 'order.closed' event to outbox
5. Log results to vendor_api_logs
```

### Flow 2: Sync Order Statuses
**Legacy:** `Cron::updateAllSoftProOrderStatus()` → `GetOrders`
**vNext:** Job `softpro.sync_order_statuses`

```
1. Determine date range (default: last 30 days)
2. Chunk into 10-day intervals (matching legacy getDateIntervals behavior)
3. For each chunk: call GetOrders?DateFrom=X&DateTo=Y
4. For each order in response:
   a. Compare softproStatus with local
   b. If changed:
      - Update softproStatus
      - If status → 'completed': set completedAt
      - If status → 'closed': set closedAt (only if not already set)
      - Write to order_status_history
5. Collect closedFileNumbers for email trigger
```

### Flow 3: Sync Contacts (Unified)
**Legacy:** 9 separate cron jobs, one per entity type
**vNext:** Job `softpro.sync_contacts` (one job, parameterized)

```
Entity types to sync:
  - 'Order Contact - Person'
  - 'Escrow Company'
  - 'Escrow Officer'
  - 'Lender'
  - 'Mortgage Broker'
  - 'Selling Agent/Broker'
  - 'Title Officer'
  - 'Underwriter'
  - Sales Reps (via GetOrderMarketingRep — different endpoint)

For each entity type:
  1. Call GetLookuptable?userType={type}
  2. For each record:
     a. Match by softproLookupCode
     b. Upsert contact with mapped fields
     c. Set roles array based on entity type
```

## Data Mapping

### SoftPro Order → Hub Orders

| SoftPro Field | Hub Column | Transform |
|--------------|------------|-----------|
| `OrderNumber` | `orders.file_number` | Direct (match key) |
| `OrderStatus` | `orders.softpro_status` | Lowercase |
| `OrderStatus` | `orders.operational_status` | Map: open/completed/closed/canceled/duplicate |
| `TransactionType` | `orders.transaction_type` | Direct string |
| `ProductType` | `orders.product_type` | Direct string |
| `OrderType` | `orders.order_type` | Direct string |
| `SalesPrice` | `orders.sales_price` | Direct |
| `MarketingRep` | `orders.sales_rep_id` | Look up contact by officerName |
| `TitleOfficer` | `orders.title_officer_id` | Look up contact by officerName |
| `ReceivedDate` | `orders.opened_at` | Parse date |
| `CompletedDate` | `orders.completed_at` | Parse `n/j/Y g:i:s A` format |
| `ModifiedDate` | `orders.closed_at` | Only when status = 'closed' |
| `Address` | `order_properties.address` | Direct |
| `City` | `order_properties.city` | Direct |
| `State` | `order_properties.state` | Direct |
| `Country` | `order_properties.county` | **Legacy bug preserved**: 'Country' field contains county name |

### SoftPro Date Parsing
Legacy uses multiple date formats. Centralized parser must handle:
- `n/j/Y g:i:s A` → `3/26/2025 2:30:00 PM`
- `m/d/Y h:i:s A` → `03/26/2025 02:30:00 PM`
- Standard ISO strings

```typescript
function parseSoftProDate(str: string | null): Date | null {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
```

## Adapter Interface

```typescript
// lib/integrations/softpro/types.ts

export interface SoftProOrderItem {
  OrderNumber: string;
  OrderStatus: string;
  MarketingSource: string | null;
  OrderType: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Country: string | null;       // Actually county
  TitleOfficer: string | null;
  SalesPrice: string | null;
  TransactionType: string | null;
  ProductType: string | null;
  ReceivedDate: string | null;
  CompletedDate: string | null;
  ModifiedDate: string | null;
  MarketingRep: string | null;
  LastModifiedOn: string | null;
}

export interface SoftProResponse<T = unknown> {
  Status: number;
  Message: string;
  data?: T;
  OrderNumber?: string;
}
```

## Canon References
- `softpro-route-extraction.md` — Complete route map, all 21 endpoints, 10 flows, data mappings
- `td-source-extraction.md` §1 — SoftPro.php client source
- `td-source-extraction.md` §2 — Cron.php sync methods (fetchSoftproOrders, updateAllSoftProOrderStatus)
- `lean_transaction_desk_hub_plan.md` §9
