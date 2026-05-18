# Escrow workspace — EW tickets

## EW‑3 — UI Builder: Escrow Assistant Hub enhancements

### PREREQUISITE CONFIRMED

- `GET /api/escrow/tasks` is live (committed `73c58fd`).
- `src/lib/domain/escrow/tasks.ts` has typed interfaces — **IMPORT FROM HERE**; do not duplicate types in UI code.

**TYPE IMPORTS REQUIRED**

- Import `EscrowTasksResponse`, `Task`, `TaskSummary` from `@/lib/domain/escrow/tasks`.
- **DO NOT** redefine these types in component files.
- The fetch JSON body is **`EscrowTasksResponse`** exactly (after `await res.json()` and validation if you add runtime checks).

`/api/escrow/officers` may not exist yet — if it doesn’t, **hardcode** the five officers temporarily and flag for Builder follow‑up:

| Name | Contact ID |
|------|------------|
| Christine Quintanar | 13 |
| Joseph Gomez | 10999 |
| Lupe Vidaca | 8996 |
| Anna Ballesteros | 17165 |
| Karla Casco | 10642 |

---

**Role:** UI Builder — `src/app/(hub)`, `src/components/**`; no new API routes unless coordinated.

**Depends on:** EW‑2 task signals API (confirmed above).

Add escrow workspace enhancements to the existing Hub for **`session.role === 'escrow_assistant'`** only. **Do not** create a new page — enhance **`/hub`**.

**Do not** show task cards or officer chips to **`open_order_team`**.

---

### SECTION 1: Task Signal Cards (`escrow_assistant` only)

Three clickable cards above the orders table.

**File:** `src/components/escrow/escrow-task-cards.tsx` (kebab-case; PascalCase export `EscrowTaskCards`)

**Props:**

```typescript
{
  onFilterChange: (priority: 1 | 2 | 3 | null) => void;
  activeFilter: 1 | 2 | 3 | null;
}
```

On mount, **`GET /api/escrow/tasks`**. Show counts from summary (priorities 1–3).

**Styling:**

- Priority 1: `bg-red-50 border-red-200 text-red-900 hover:bg-red-100`
- Priority 2: `bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100`
- Priority 3: `bg-gray-50 border-gray-200 text-gray-900 hover:bg-gray-100`

Use **`lucide-react`** icons (no emoji).

**Interaction:** Toggle filter on repeated click (`onFilterChange(null)`). Active card: `ring-2 ring-{color}-400`. Show **“Clear filter”** link when active.

---

### SECTION 2: Officer Filter Chips (`escrow_assistant` only)

Below cards, above table.

**File:** `src/components/escrow/officer-filter-chips.tsx`

**Props:**

```typescript
{
  activeOfficerId: number | null | 'unassigned';
  onChange: (officerId: number | null | 'unassigned') => void;
}
```

Pills: **`px-3 py-1`**; inactive `bg-gray-100 text-gray-700 hover:bg-gray-200`; active navy `bg-[#1B2A4A] text-white`. Default **All**.

---

### SECTION 3: Orders table — Escrow Officer column

Ticket text: column when **`role === 'escrow_assistant'`**.

**`OrdersHubTable` column behavior:**

`OrdersHubTable` may **not** already expose `showEscrowOfficerColumn`.

- **A.** If the table is easily extended — add the prop and a conditional header + cells.
- **B.** If not — follow whichever shared pattern fits (composition prop, column config, etc.). **Do not fork** the table into a duplicate file.

If you **cannot** add the column cleanly, **flag to the Director** and **ship cards + chips only**. The column is **lowest priority**.

Column content: officer display name when assigned; red **Unassigned** when `escrowOfficerId` / name is absent.

---

### SECTION 4: Filtering — `/api/orders` query vs client-side

**ACCEPTABLE CLIENT-SIDE FILTERING**

If `/api/orders` does **not** support `priority` or `escrowOfficerId` (or equivalent) yet:

- Filter the **already-fetched** order rows in the client layer (parent + table contract as needed).
- Add: `// TODO: Move to server-side filter when /api/orders supports it`
- ~329 scoped orders client-side is **acceptable**; not a scaling blocker.

**Visibility — do not silently fail**

If the implementation expects server query params **but** the API ignores them **and** no client-side filter is applied, the UI **must surface a warning** Directors can spot (banner, footer note, dev-only assert in dev, etc.) — not a silent no-op.

---

### SECTION 5: Layout sketch (`hub/page.tsx`)

```tsx
{session.role === 'escrow_assistant' && (
  <>
    <EscrowTaskCards … />
    <OfficerFilterChips … />
  </>
)}

<OrdersHubTable … showEscrowOfficerColumn={…} />
```

Preserve batch CPL / proposed / prelim and all existing Hub behavior for other roles. **No** assign-officer UI (SoftPro is source of truth). **No** new `/escrow` route.

---

### Done checklist

- Typecheck passes (`pnpm`/project script as available).
- Desktop 1280px+ verified.
- Suggested commit: `feat: escrow assistant Hub — task signal cards + officer filter chips`

