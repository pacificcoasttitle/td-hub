# Watch-Out: Shape Mismatches Between API and UI

## The Trap

A component reads `data.field_name` but the API returns `data.fieldName` (or vice versa). The component renders blank or undefined values. No error is thrown — the field just doesn't exist on the response shape, so JavaScript silently returns `undefined`.

This is invisible until someone notices the UI looks wrong.

## Real Incident

On 2026-05-19 during the escrow workspace audit, three separate contract mismatches were discovered between shared components and their APIs:

### Bug 1: DetailModal vs /api/orders/[id]

DetailModal component expected a FLAT shape:
```typescript
data.propertyStreet
data.sellerFirstName
data.lenderName
```

But the API returned NESTED:
```typescript
data.property.address
data.parties.find(p => p.role === 'seller').externalName
data.parties.find(p => p.role === 'lender').externalCompany
```

Result: Property tab showed blank. Parties tab showed blank. Users assumed the order had no parties.

### Bug 2: NotesModal vs /api/orders/[id]/notes

NotesModal expected:
```typescript
note.note         // body of the note
note.createdBy    // author name
```

API returned:
```typescript
note.body
note.authorName
```

Result: Notes list rendered empty rows. New notes were saved correctly but didn't display.

### Bug 3: ActivityFeed vs /api/orders/[id]/activity

ActivityFeed expected:
```typescript
event.description
```

API returned:
```typescript
event.summary
```

Result: Activity timeline showed timestamps but blank descriptions. Users couldn't tell what events occurred.

All three bugs were invisible in code review because TypeScript types didn't match either side accurately — they were loosely typed as `any` or with overly broad shapes.

## Why This Happens

1. **Component built before API was finalized** — agent guessed at field names
2. **API was refactored** — server-side field names changed, component wasn't updated
3. **Two agents built the two ends in parallel** — they used different conventions
4. **TypeScript types loose** — `data: any` or `data: Record<string, unknown>` hide the mismatch
5. **Optional chaining masks the bug** — `data?.field?.value` returns `undefined` instead of throwing

## The Fix Pattern

When a UI is rendering blank data:

1. Open browser DevTools → Network tab → find the API call
2. Inspect the response body
3. Compare field names against what the component reads
4. If mismatched, fix one end (usually the component) to match the other

Fix the COMPONENT to match the API, not vice versa, unless the API field name is genuinely wrong. APIs have multiple consumers; components usually don't.

## Prevention

### Strong Typing At The Boundary

Every API response should have a TypeScript type that the component imports:

```typescript
// In src/lib/domain/orders/service.ts (the API's data source)
export type OrderDetailResponse = {
  id: number;
  fileNumber: string;
  property: {
    address: string;
    city: string;
    state: string;
  } | null;
  parties: Array<{
    role: 'buyer' | 'seller' | 'lender' | 'escrow' | 'agent';
    externalName: string | null;
    externalCompany: string | null;
    contact: {
      firstName: string | null;
      lastName: string | null;
    } | null;
  }>;
};

// In src/components/shared/action-modals/detail-modal.tsx
import type { OrderDetailResponse } from '@/lib/domain/orders/service';

const [data, setData] = useState<OrderDetailResponse | null>(null);
```

If the component imports the type from the API's source of truth, TypeScript catches mismatches at build time.

### Where TypeScript Helps

```typescript
// Good: explicit type
const seller = data.parties.find(p => p.role === 'seller');
const name = seller?.externalName;  // TypeScript knows this is string | null

// Bad: any escapes type checking
const data: any = await response.json();
const name = data.parties.find(p => p.role === 'seller').externalName;
// No error if 'parties' doesn't exist on the response
```

### Naming Conventions

Pick ONE convention for the project. Suggested:

- **camelCase everywhere** — match JavaScript/TypeScript convention
- API responses are objects, not row data — transform snake_case to camelCase in the API layer
- Database columns can be snake_case (Postgres convention); transform at the boundary

If you mix conventions (snake_case for some fields, camelCase for others), you WILL hit shape mismatches.

### Use Existing Patterns

Before building a new component:

1. Grep for similar existing components (`OrderDetailsModal` vs `DetailModal`)
2. Check what API they call and what fields they read
3. Match those conventions

Don't reinvent the read pattern.

## Detection

### Code review checklist

When reviewing component changes:

- [ ] Does the component reference an API endpoint?
- [ ] Open the API file and verify the response shape
- [ ] Compare field names exactly (case-sensitive)
- [ ] If the component uses optional chaining (`data?.field`), is it because the field might be missing, or because the agent wasn't sure of the name?

### Runtime detection

In dev tools, when a component renders blank:

1. Network tab → API response → inspect JSON
2. Console → log the data state: `console.log(data)`
3. Compare to what the component reads

If `data.someField` is `undefined` but `data.some_field` exists → shape mismatch.

### Quick grep

```bash
# Find optional chaining that might be masking bugs
grep -rn "data\?\.\|response\?\." src/components/

# Find type-as-any escape hatches
grep -rn ": any\b" src/components/
```

## When Both Ends Are Wrong

Sometimes the API and the component both have ad-hoc conventions and neither matches the database. In that case:

1. Decide on the canonical shape (usually camelCase output of the API layer)
2. Update the API to return the canonical shape consistently
3. Update components to read the canonical shape
4. Define a shared TypeScript type
5. Import it everywhere

Don't band-aid. Fix the contract.

## Historical Incident Summary

**Discovered:** 2026-05-19 during escrow workspace investigation  
**Components affected:** DetailModal, NotesModal, ActivityFeed  
**Impact:** Property tab, Parties tab, Notes display, Activity timeline all showed blank  
**Fix commit:** `ece232d` (paraphrasing — three contract mismatches resolved)  
**Root cause:** Components built before API contracts were finalized; types weren't tight enough to catch the drift  
**Lesson:** API response types must be defined ONCE and imported by all consumers.

## Reference Files

- `src/components/shared/action-modals/detail-modal.tsx` — fixed component
- `src/lib/domain/orders/service.ts` — getOrders/getOrderById response shape
- `src/lib/domain/orders/types.ts` — shared types

## Related Patterns

- `agents/ui-builder.md` — UI Builder responsibility for matching contracts
- `agents/builder.md` — Builder responsibility for defining contracts
