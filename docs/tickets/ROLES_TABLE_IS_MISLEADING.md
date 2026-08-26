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

## Related

Same class as `order_properties.borrowers_vesting` (0 of 7,381 rows populated) and
`officer_cc_defaults.cc_email` — declared, wired to nothing, and misleading to a reader.
Worth handling together.
