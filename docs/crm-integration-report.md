# Sales Rep Client List — Build Brief

**Prepared:** Jul 28, 2026
**Codebase:** `td-hub` (TransactionDeskV2) — Next.js 16 App Router, React 19, TypeScript strict, Drizzle ORM 0.45 + `postgres` driver, Supabase Auth, Zod 4, Tailwind 4, Vitest, Vercel
**Audience:** Claude Code (implementation), Claude + Cursor (review)
**Status:** Approved direction. This document is the spec. Anything not in scope here is explicitly out of scope — see §8.

---

## 1. The goal

Give Pacific Coast Title's sales reps one simple place to:

1. **Store their personal list of clients** (the real estate agents, lenders, and escrow contacts they work).
2. **Add notes to a client** ("met at the Anaheim mixer, prefers texts, kid plays travel ball").
3. **See whether that client has given them business** — orders in td-hub where that person appears and the rep is the assigned sales rep.
4. **Import a list from a spreadsheet** (CSV) so they don't type 200 names by hand.

That's it. The reps are not technical. The bar is "as easy as the contacts app on their phone." If a screen needs explaining, it's too complicated.

## 2. The vision

Each rep gets a **"My Clients"** section inside the existing sales portal (the `(sales)` route group they already log into). It's their private rolodex:

- A list page: search box, "Add client" button, "Import" button. Rows show name, company, phone/email, and a small "business" indicator (e.g., "3 orders · last May 2026") when the client is linked to transaction data.
- A client detail view (drawer or page): contact info at top (editable), a **Notes** section that is the main event (a text box and a reverse-chronological list of timestamped notes), and a read-only **Business** section listing their orders with this rep.
- Managers see their reps' lists and notes (read-only rep selector, same pattern as the sales dashboard). Nobody else sees anything.

### The one architectural rule

**The client list is independent of SoftPro.** Rep-owned data lives in new `crm_` tables that the SoftPro sync jobs never touch. The connection to transaction data is a *nullable, read-only pointer* (`contactId`) from a rep's client row to the existing synced `contacts` table, confirmed by the rep, used only to display order history. Data flows one way: SoftPro → display. Never the reverse, and never merged.

This gives us both halves of the requirement: the list "sits independent of SoftPro" (reps can add/edit/delete freely; sync can never clobber their data), while still displaying the transactions they have with each client.

### Context: what already exists (build on it, don't duplicate it)

- **Client Intelligence** (`/sales/summary`, `src/components/sales/client-intelligence.tsx`) already shows top clients, revenue, deals, inactive-90-days. **Important:** its rows come from the external Managers Report API keyed by *name strings* — there is no stable ID, which is exactly why notes cannot be bolted onto that screen. Leave it as-is; My Clients complements it.
- **Sales portal auth & scoping**: `(sales)/layout.tsx` restricts to `sales_rep`/`sales_manager`; `src/app/api/sales/_helpers/validate-access.ts` (`validateSalesAccess`, `SalesAccessError`) and `src/lib/security/permissions.ts` (`getSalesScopedContactIds`, `getManagedRepIds` via `contacts.managerId`) handle rep-vs-manager scoping. Reuse these.
- **Synced contact database**: `contacts` (~18k rows) and `orders` with `salesRepId`, `clientContactId`, plus `orderParties` — in `src/lib/db/schema/contacts.ts` and `src/lib/db/schema/orders.ts`.
- **UI conventions**: server-paginated tables with debounced search (see `src/components/admin/contacts/contact-list-page.tsx`, `src/components/admin/shared-table.tsx`), modal shell `src/components/shared/action-modals/modal-shell.tsx`, sales sidebar `src/components/sales/sales-sidebar.tsx`, brand: sales accent orange `#F26B2B`, navy `#1B2A4A`.

---

## 3. Data model

Two new tables in a new schema file `src/lib/db/schema/crm.ts`, barrel-exported from `src/lib/db/schema/index.ts`, migration generated with `npm run db:generate` (migrations live in `src/lib/db/migrations/`, latest is 0028).

```ts
// crm_clients — a rep's personal client record. SoftPro-independent.
crmClients {
  id: serial PK
  ownerProfileId: varchar(64) NOT NULL → profiles.id   // the rep who owns this row
  name: varchar(200) NOT NULL
  company: varchar(200)
  email: varchar(200)
  phone: varchar(50)
  contactId: integer NULL → contacts.id                 // optional, rep-confirmed link to synced contact; READ-ONLY bridge
  createdAt / updatedAt: timestamps
  indexes: (ownerProfileId), (ownerProfileId, email), (contactId)
}

// crm_client_notes — timestamped free-text notes.
crmClientNotes {
  id: serial PK
  clientId: integer NOT NULL → crm_clients.id ON DELETE CASCADE
  authorProfileId: varchar(64) NOT NULL → profiles.id
  body: text NOT NULL
  createdAt: timestamp
  index: (clientId)
}
```

Deliberate choices:

- **No unique constraint on email.** Two reps may both have "Jane at Keller Williams." Duplicates *within one rep's list* are prevented at the application layer on create/import (case-insensitive email match against that rep's rows only), not by the DB, because email is optional.
- **No note editing/deleting in v1** beyond delete-own-note. Notes are append-mostly; keep it simple. (Allow delete of a note you authored; no edit.)
- **No tags, types, statuses, reminders, or pipeline fields.** See §8.
- **`ON DELETE CASCADE` on notes only.** Deleting a client (rep action, confirm dialog) removes its notes. Nothing else in the system references `crm_clients`, so deletion is safe and contained.

## 4. API surface

All under `src/app/api/sales/clients/…`, following existing route conventions exactly: `getSession()` → 401; role must be `sales_rep` or `sales_manager`; Zod validation with the `safeParse` → `400 { error: 'Invalid input', details }` idiom; thin routes delegating to a new domain module `src/lib/domain/crm/clients.ts` (+ colocated Vitest tests, matching the codebase's 70-test pattern).

| Method & path | Behavior |
|---|---|
| `GET /api/sales/clients?search&page&pageSize&repId` | List the caller's clients, server-side paginated (25/page) and searched (name/company/email, `ilike`). `repId` allowed only for managers over their own reps — validate with the same logic as `validateSalesAccess`. Each row includes a lightweight business summary (see below). |
| `POST /api/sales/clients` | Create. Requires `name`; optional company/email/phone. Rejects (409) if the same email already exists in this rep's list. Response includes up to 5 suggested `contacts` matches (by exact email, else name `ilike`) so the UI can offer "Link to transaction contact?" |
| `GET /api/sales/clients/[id]` | Detail: client + notes (newest first) + business summary (orders via `contactId`, if linked). 404 if not owned/in scope (owner, or manager of owner) — mirror the existing 404-not-403 convention. |
| `PATCH /api/sales/clients/[id]` | Update name/company/email/phone; set or clear `contactId` (the link action). Owner only (managers read-only). |
| `DELETE /api/sales/clients/[id]` | Delete with cascade to notes. Owner only. |
| `POST /api/sales/clients/[id]/notes` | Add note (owner or manager-of-owner? — **owner only writes; managers read**). |
| `DELETE /api/sales/clients/[id]/notes/[noteId]` | Delete own note. |
| `POST /api/sales/clients/import` | CSV import — §6. |

**Business summary query** (the "have they given me business" answer): for a client with `contactId` set, find orders where (`orders.clientContactId = contactId` OR the contact appears in `orderParties.contactId`) AND `orders.salesRepId` is in the caller's scoped contact IDs (`getSalesScopedContactIds` for managers; the rep's own `profiles.contactId` otherwise). Return count, last `openedAt`/`closedAt`, and for the detail view a short list (file number, status, transaction type, opened date, sales price) linking to the existing `/sales/orders` views. Unlinked clients simply show "No orders yet — link a transaction contact to see history." **This is a read query only; write nothing to `orders`/`contacts`.**

## 5. UI

New sidebar entry **"My Clients"** in `src/components/sales/sales-sidebar.tsx` (managers see the same entry; label stays the same). New route `src/app/(sales)/sales/clients/page.tsx` — server component doing session check, rendering a `'use client'` component, per codebase pattern.

- **List page**: table (name / company / contact info / business indicator / last note snippet), debounced search, pagination, `Add client` and `Import CSV` buttons, manager `RepSelector` (reuse `src/components/sales/rep-selector.tsx`). Empty state with a friendly "Add your first client or import a list."
- **Add/edit modal**: four fields. After save, if suggested contact matches came back, show a small inline card: "Is this the same person? *Jane Smith — Keller Williams (from transactions)* [Link] [Skip]". One tap. Never auto-link.
- **Detail drawer** (slide-over, consistent with existing modal patterns): header with contact info + edit; **Notes**: textarea + Add button, list below with date and author (author matters for the manager view); **Business**: order list or the unlinked empty state with a "Find match" button re-running suggestions.
- Skeletons, empty states, and error blocks per `shared-table.tsx` conventions. Mobile-friendly — reps live on phones; the sales layout already has a mobile drawer.

Keep language non-technical throughout: "Link to transactions," not "Associate contactId."

## 6. CSV import

One dialog, three steps, no wizardry:

1. **Upload** — accept `.csv`, parse client-side or in the route (no new heavy deps; a small hand-rolled parser or `papaparse` if truly needed — prefer no new dependency). Expected headers: `name` (required), `company`, `email`, `phone` — case-insensitive, extra columns ignored. Provide a downloadable sample file at `public/sample-clients.csv`.
2. **Preview** — show first rows + counts: N will be added, N skipped as duplicates (email already in *your* list), N errors (missing name). Nothing is written yet.
3. **Commit** — insert rows with `ownerProfileId = caller`; return per-row results; show a summary ("42 added, 3 skipped, 1 error — row 17 missing name").

Import limits: cap at 1,000 rows per file (friendly error above that). Do **not** attempt contact matching/linking during import — reps link individually from the detail view when they care. Do not import into or read from the SoftPro `contacts` table at any point.

Also include **Export CSV** of the rep's own list (same four columns + created date). It's ~30 lines in a route handler (`Content-Disposition: attachment`) and prevents lock-in anxiety. The admin-side document routes show the streaming pattern.

## 7. Pitfalls — read before coding

These are the rabbit holes. Each one has a seductive "wouldn't it be better if…" framing. The answer is no, in v1.

1. **Attaching notes to the shared `contacts` table.** It looks DRY — the contact already exists! But `contacts` is company-wide and SoftPro-synced: notes there are visible to (or entangled with) everyone, and the rep's "private rolodex" property dies. Notes attach to `crm_clients` only.
2. **Auto-linking by email/name without rep confirmation.** Silent wrong matches (two John Smiths, a shared office email) poison the business data and destroy trust in the tool. Suggest; never decide. The rep taps Link.
3. **Fuzzy matching / dedupe engines.** Exact email match, then name `ilike` for *suggestions* — that's the ceiling. No scoring, no Levenshtein, no merge UI.
4. **Write-back to SoftPro or to `contacts`.** Never. Not "just this one field." The sync jobs (`src/lib/jobs/handlers/sync-contacts.ts`) own that data.
5. **Editing synced data in the CRM UI.** The Business section is read-only. If a rep sees a wrong phone number on a transaction contact, that's a SoftPro fix, not a CRM feature.
6. **Scope creep into a "real CRM."** Tags, groups, reminders, tasks, pipelines, deal stages, bulk email, campaigns, opt-out management, attachments. Each was evaluated in the previous version of this analysis and deliberately cut. If someone asks mid-build, the answer is "separate project."
7. **Building on Client Intelligence rows.** They're name-strings from an external API (`getClientSummary` → Managers Report), not entities. Don't try to join notes, or the rep's list, to them. Leave that page alone.
8. **Per-route auth drift.** The codebase already has ~146 routes with copy-pasted role arrays, and `permissions.ts` contains stale nav/feature maps (`getNavItemsForRole`, `canAccessFeature` — do not extend them). Put CRM role checks in the domain module or the `_helpers` validator, once, and reuse.
9. **Client-side loading of the whole list.** The reference product this idea came from loaded all contacts client-side and searched in the browser. Server-paginate from day one, like every other td-hub table.
10. **New dependencies / component libraries.** The codebase has no shadcn/Radix/react-hook-form, and one file in `src/components/ui/`. Match the existing hand-rolled patterns; a CSV parser is the only dependency even worth discussing.
11. **Forgetting the manager path.** Manager visibility (read-only) must be in the queries from the start (`ownerProfileId IN (self + managed reps' profile ids)`); bolting it on later means touching every route. Note managed reps are found via `contacts.managerId` → you'll need the contact→profile hop (`profiles.contactId`) that the dashboards already do.
12. **Vercel/serverless constraints on import.** Keep the import request a single POST with the parsed rows (or a small file); no background jobs, no chunked resumable uploads. 1,000-row cap keeps it well inside limits.

## 8. Explicit non-goals (v1)

Groups/lists, bulk or individual email sending from the CRM, campaigns, unsubscribe/compliance work, tags, reminders/follow-up tasks, lead capture, mobile app, note editing, attachments, importing into the shared `contacts` table, any SoftPro write-back, any change to Client Intelligence, admin-console surfaces for CRM data. If v1 lands and reps ask for more, revisit deliberately.

## 9. Acceptance criteria

- [ ] A `sales_rep` can add, edit, delete a client; add and delete notes; import a CSV (sample file works); export their list.
- [ ] A rep sees **only their own** clients; a `sales_manager` can view (not edit) each managed rep's clients and notes via the rep selector; admins/other roles get 404s from these APIs.
- [ ] Linking a client to a suggested transaction contact populates the Business section with that client's orders **with this rep only**; unlinking clears it; nothing is ever written to `contacts`, `orders`, or any SoftPro-synced table (verify: no imports of those tables' write paths in `src/lib/domain/crm/`).
- [ ] Running the SoftPro contact sync jobs does not modify any `crm_*` row (trivially true by construction — assert no code path exists).
- [ ] List page server-paginates and searches; import of a 500-row file completes in one request with an accurate summary; a 1,001-row file is rejected with a friendly message.
- [ ] Zod validation + existing error idioms on every route; Vitest coverage for the domain module (scoping, dedupe-on-create, import row handling, business-summary query composition) colocated per codebase convention.
- [ ] UI matches sales-portal styling (orange `#F26B2B` accents, existing table/modal/skeleton patterns) and works on mobile.
- [ ] Migration generated via drizzle-kit; schema exported from `src/lib/db/schema/index.ts`; no edits to existing tables.

## 10. Reviewer checklist (Claude + Cursor)

Focus the review on the boundaries, not the CRUD:

1. **Isolation**: grep the diff for any import of `sync-contacts`, any write to `contacts`/`orders`/`companies`, any new column on existing tables. All should be absent.
2. **Scoping**: every route resolves visibility through one shared helper; manager access is read-only; cross-rep access returns 404.
3. **Suggestion queries** hit indexed columns (`contacts_email_idx`, `contacts_full_name_idx` exist) and are capped (LIMIT 5).
4. **Import**: duplicate detection is per-owner and case-insensitive; partial failures reported per-row; no transaction left half-committed (wrap commit step in one DB transaction).
5. **No stale-map extension**: `permissions.ts` legacy nav/feature maps untouched; sidebar change made in `sales-sidebar.tsx` only.
6. **Conventions**: `params: Promise<{}>` route signature, 404-not-403 for unauthorized records, thin routes / fat domain module, tests colocated.

## 11. Key file reference

| Purpose | Path |
|---|---|
| New schema (create) | `src/lib/db/schema/crm.ts` (+ export in `schema/index.ts`) |
| New domain logic (create) | `src/lib/domain/crm/clients.ts` (+ tests) |
| New routes (create) | `src/app/api/sales/clients/**` |
| New pages/components (create) | `src/app/(sales)/sales/clients/page.tsx`, `src/components/sales/clients/*` |
| Auth/session | `src/lib/security/auth.ts` |
| Sales access validation | `src/app/api/sales/_helpers/validate-access.ts` |
| Rep/manager scoping | `src/lib/security/permissions.ts` (`getSalesScopedContactIds`), `src/lib/domain/contacts/managed-reps.ts` |
| Synced contacts & profiles schema | `src/lib/db/schema/contacts.ts` |
| Orders & parties schema | `src/lib/db/schema/orders.ts` |
| Table/list UI patterns | `src/components/admin/contacts/contact-list-page.tsx`, `src/components/admin/shared-table.tsx` |
| Modal shell | `src/components/shared/action-modals/modal-shell.tsx` |
| Sales sidebar & rep selector | `src/components/sales/sales-sidebar.tsx`, `src/components/sales/rep-selector.tsx` |
| Client Intelligence (do not modify) | `src/components/sales/client-intelligence.tsx`, `src/app/api/sales/summary/route.ts` |
| Scoped order queries (pattern) | `src/lib/domain/orders/scoped-queries.ts` |
| Migrations | `src/lib/db/migrations/` (`npm run db:generate`) |
