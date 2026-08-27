# The `roles` table is actively wrong, not merely unused

**Status: documented, not fixed.**
Opened: 2026-08-26, while mapping "open order team" to a real role for the concierge UI.

## The problem

`roles` looks like the authorization reference for this app. It is not, and it disagrees
with reality in both directions — so anyone who reads it to answer "what roles exist?" gets
a wrong answer that looks authoritative.

**Four roles it defines that ZERO users hold:**

| in `roles` | users |
|---|---:|
| `cs_admin` | 0 |
| `title_officer` | 0 |
| `escrow_officer` | 0 |
| `client` | 0 |

**Three roles eleven users actually hold that it does not define at all:**

| held by users | users | in `roles`? |
|---|---:|---|
| `open_order_team` | 9 | **no** |
| `escrow_assistant` | 1 | **no** |
| `title_production` | 1 | **no** |

Full picture as of 2026-08-26 — 67 users, 7 roles in use:

| role | users | active |
|---|---:|---:|
| `sales_rep` | 47 | 47 |
| `open_order_team` | 9 | 9 |
| `admin` | 4 | 4 |
| `super_admin` | 3 | 3 |
| `sales_manager` | 2 | 2 |
| `escrow_assistant` | 1 | 1 |
| `title_production` | 1 | 1 |

Note `sales_manager` is also absent from `roles`.

## Why it is wrong rather than stale

Nothing reads it. Authorization is string comparison against arrays declared in code, and
those arrays are the real source of truth:

| the actual gate | where |
|---|---|
| `HUB_ROLES` | `src/app/(hub)/hub/layout.tsx` — who reaches `/hub` |
| `FULL_ACCESS_ROLES` | `src/lib/domain/orders/scope.ts` — who sees every order |
| `ALLOWED_ROLES` | `src/app/api/admin/concierge/usage/route.ts` and siblings |
| per-role branches | `scope.ts`, `orders/route.ts` |

The table was seeded 2026-03-11 and has not tracked the app since. Its `permissions`
column — `['admin.*']`, `['orders.own']` — describes a permission model this codebase
never implemented.

## Why it matters

It is reference data shaped like a contract. Someone deciding who should be allowed to do
something will open `roles`, see `cs_admin` and `title_officer`, and write a gate for
people who do not exist — while omitting the nine `open_order_team` users who are the
actual operators. That is not hypothetical: mapping "the open order team" for the concierge
UI required querying `profiles` precisely because `roles` does not list it.

## Options, for whoever takes it

1. **Delete it.** Nothing reads it; the arrays in code are the truth. Cleanest.
2. **Make it true and keep it descriptive** — seed it from the roles actually in use, and
   say in a comment that it documents rather than enforces.
3. **Make it authoritative** — move the gates to read from it. The largest change, and only
   worth it if a real permission model is wanted.

Option 1 or 2. Option 3 is a project, not a fix.

## Related — and at four instances this is a pattern, not a coincidence

Every one of these is the same shape: **a column or table added, never written,
and silently empty forever.** None fails. None logs. Each one reads to the next
developer as a feature that exists.

| Field | Measured | What a reader assumes |
| --- | --- | --- |
| `roles` table | 4 roles nobody holds, 3 held roles missing | that it governs permissions |
| `order_properties.borrowers_vesting` | 0 of 7,381 rows populated | that vesting is captured |
| `officer_cc_defaults.cc_email` | table exists, read by no sending path | that officers have standing CCs |
| `order_parties.source` | **NULL on all 36,606 rows, every role** | that party provenance is tracked |

`order_parties.source` was found while sizing the hub detail pane. It is worth
noting precisely because of how it was found: nobody was looking for it, and
nothing would ever have surfaced it. It records nothing about where a party
came from — sync, party wizard, manual entry — on any of the 36,606 rows.

### Why this pattern deserves one owner

Individually each is minor. Together they are a reliability problem of a
specific kind: **the schema is not a trustworthy description of the system.**
Anyone reasoning from the column list — a new developer, a report author, an
AI agent reading the schema to answer a question — will conclude these fields
carry data. Three of the four have already cost investigation time.

The fix per field is one of: delete it, populate it, or comment it as reserved.
The fix for the pattern is a rule about not landing a column ahead of the code
that writes it.

Worth handling together, and worth a sweep for the fifth.
