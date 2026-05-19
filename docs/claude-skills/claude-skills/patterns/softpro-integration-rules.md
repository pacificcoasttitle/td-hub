# Pattern: SoftPro Integration Rules

## Summary

Hard-won rules from integrating with SoftPro's API. Apply to every SoftPro call.

## Connection details

- **Base URL:** `SOFTPRO_API_URL` env var
- **Production:** port 3000
- **Staging:** port 8081
- **Auth:** None in production (network-restricted IP allowlist)
- **Content-Type:** `application/json`
- **Timeout:** 60s default (legacy was 540s — don't go above 120s in production)
- **Response envelope:** `{ Status: 200, Message: "...", data: T }`

## The Core Rule

**Per-order calls work. Date-range calls don't.**

This is the single most important SoftPro rule. Apply it everywhere.

```typescript
// ✓ DO — per-order
const result = await getOrderDetails({ orderNumber: '20017840-GLT' });

// ❌ DON'T — date range (times out at 120s, fails silently)
const result = await getOrderDetails({ 
  dateFrom: '2026-05-19', 
  dateTo: '2026-05-19' 
});
```

The legacy PHP system used date-range. It worked years ago, stopped working at some point, and nobody noticed because the cron silently marked itself "completed."

## Endpoints we use

| Endpoint | Method | Purpose | Common usage |
|----------|--------|---------|--------------|
| GetOrderDetails | GET | Order header, parties, status, dates | Enrichment (per-order) |
| GetOrderContacts | GET | Buyer/seller/escrow/lender/agent | Enrichment (per-order) |
| GetOrders | GET | List orders changed in date range | sync_recent_orders (this one IS date-range and works because it returns just headers, not full data) |
| GetAttachedDocumentsPrelim | GET | Prelim docs URLs | fetch_prelims cron |
| GetAttachedDocumentsPolicy | GET | Policy docs by type | On-demand |
| GetFees | GET | Order fees and invoices | Detail modal Fees tab |
| AddDocuments | POST | Upload document to order | Document upload flow |
| AddNotes | POST | Add note to order | NotesTab inline add |
| AddTask | POST | Update task/milestone | Webhook handler reactions |
| GetLookUpTable | GET | Sync contacts/companies by userType | sync_contacts cron |
| GetMilestoneNotification | GET | Single milestone status | Webhook reactions |
| create | POST | Create new order | New-order wizard submit |
| updateOrder | POST | Update loan/order fields | Specific update flows |

## Field name conventions

SoftPro uses inconsistent naming. Don't normalize — match exactly:

- `OrderNumber` (not orderNumber, OrderNo, OrderID)
- `PreimaryBorrower` (their typo — preserve it)
- `EscrowOfficer` (string name — used for resolution by name match)
- `TitleOfficer` (same)
- `MarketingRep` (their term for sales rep)
- `PersonLookupCode` / `CompanyLookUpCode` (note inconsistent capitalization)
- `EscrowCompanies` / `Lenders` / `ListingAgentBrokers` (plurals on root section names)

## Response handling

Every response comes wrapped in `{ Status, Message, data }`:

```typescript
type SoftProResponse<T> = {
  Status: number;
  Message: string;
  data?: T;
  OrderNumber?: string;
};
```

Always check:
1. `Status === 200`
2. `data` is present
3. If `data` is an array, check `data.length > 0`
4. For per-order calls, prefer exact match if multiple results returned

```typescript
const matchingOrder = result.data?.find(o => o.OrderNumber === orderNumber) 
                    ?? result.data?.[0];
```

## Legacy date format quirks

SoftPro returns dates in multiple formats:

- `n/j/Y g:i:s A` — `3/26/2025 2:30:00 PM`
- `m/d/Y h:i:s A` — `03/26/2025 02:30:00 PM`
- ISO 8601 — `2025-03-26T14:30:00Z`

Use centralized parser:

```typescript
function parseSoftProDate(str: string | null): Date | null {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
```

## Logging requirement

Every SoftPro call MUST log to `vendor_api_logs`:

```typescript
await db.insert(vendorApiLogs).values({
  vendor: 'softpro',
  operation: 'get_order_details',
  requestMeta: { url, method: 'GET', queryParams: { OrderNumber } },
  responseMeta: { status: result.Status, message: result.Message, resultCount: result.data?.length ?? 0 },
  success: result.Status === 200,
  httpStatus: result.Status,
  errorCategory: result.Status === 200 ? null : 'API_ERROR',
  startedAt: new Date(startTime),
});
```

The Director relies on these logs for forensic debugging. Skipping them creates invisible bugs.

## Critical anti-patterns

### Anti-pattern: Don't spread vendor responses into request payloads

```typescript
// ❌ DON'T — security risk; their response may contain extra fields
const updatePayload = { ...softProResponse.data };
await db.update(orders).set(updatePayload).where(...);
```

```typescript
// ✓ DO — explicit field mapping
const updatePayload = {
  address: softProResponse.data.Address,
  salesPrice: softProResponse.data.SalesPrice,
  // etc — only the fields you explicitly want
};
```

### Anti-pattern: Don't trust string name matches for IDs

When SoftPro returns `EscrowOfficer: "Martin Aguilar"`:
- Name match is fuzzy and can match the wrong person
- Always log unresolved name matches for debugging
- Consider exact-match-first, then fallback to fuzzy

### Anti-pattern: Don't assume fields exist

SoftPro sometimes returns sections with empty content. `EscrowCompanies` may exist but `PersonLookupCode` inside it may be empty string. Always null-check at every level.

## Data latency caveat

When you call `GetOrderDetails` for an order that was JUST created in SoftPro (within hours), the response may come back with `Status: 200, resultCount: 1` but with most fields empty or null.

This is SoftPro's internal data lag, not our bug. The backlog-aware cron pattern handles this gracefully — the next attempt 6 hours later usually gets full data.

See `watch-outs/softpro-data-latency.md`.

## Legacy code is the spec

Before changing how TD Hub calls SoftPro:
1. Read the legacy PHP equivalent in canon references
2. If the new behavior diverges, document WHY
3. Default to parity

Examples of legacy patterns to preserve:
- TitlePoint WAF bypass via unencoded body (`patterns/softpro-source-of-truth.md`)
- SoftPro `Country` field actually means county name (preserve this misnaming)
- Specific date parsing quirks

## Cross-references

- `/docs/claude-skills/patterns/backlog-aware-crons.md`
- `/docs/claude-skills/patterns/cooldown-column-per-endpoint.md`
- `/docs/claude-skills/patterns/softpro-source-of-truth.md`
- `/docs/claude-skills/watch-outs/softpro-data-latency.md`
- Project knowledge: `Softpro-API.md`, `softpro.md`, `softpro-route-extraction.md`
