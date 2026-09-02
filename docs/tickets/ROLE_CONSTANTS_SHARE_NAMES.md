# Two role-constant names, fifteen meanings

**Status: ONE site renamed. The survey below is not acted on — it is a
decision, not a cleanup.**
Opened: 2026-09-02

## What happened

`src/app/api/orders/create/route.ts` gated on a local `const ADMIN_ROLES`.
`src/lib/security/auth.ts` also exports an `ADMIN_ROLES`. Same name, different
contents:

```
security/auth.ts       ['super_admin', 'admin', 'cs_admin']
orders/create (local)  ['super_admin', 'admin', 'cs_admin',
                        'open_order_team', 'escrow_assistant']
```

I read the name in the route, attached the other one's meaning to it, and wrote
into `E2E_PIPELINE_TEST_SCOPE.md` that the create route "returns 403" without an
admin role — recommending the end-to-end suite run as an admin. That would have
tested the pipeline with permissions no operator has.

It also cost an hour of chasing a permission defect that does not exist.
Production says so plainly — the operators who open orders are exactly the role
the scope claimed was excluded:

```
who has actually created hub orders
  open_order_team   Amna Illyas       12
  super_admin       Jerry Hernandez   11
  open_order_team   Shean Veoh         9
  admin             Aileen Delfin      5
  open_order_team   Emelio Delfin      3
```

## The survey

Not two constants. Sixty-seven, under two names, with fifteen meanings.

### `ADMIN_ROLES` — 32 local definitions, 3 different contents

| Contents | Files |
|---|---:|
| `super_admin, admin, cs_admin` | 12 |
| `super_admin, admin, cs_admin, open_order_team, escrow_assistant` | 11 |
| `super_admin, admin` | 9 |

**A reader who learns what `ADMIN_ROLES` means in one file has a two-in-three
chance of being wrong in the next one.**

### `ALLOWED_ROLES` — 35 local definitions, 12 different contents

| Contents | Files |
|---|---:|
| `super_admin, admin` | 8 |
| `super_admin, admin, cs_admin` | 6 |
| `super_admin, admin, sales_manager` | 4 |
| `super_admin, admin, cs_admin, title_officer, escrow_officer, title_production, sales_rep, sales_manager, open_order_team, escrow_assistant` | 3 |
| `title_production, super_admin, admin` | 3 |
| `super_admin, admin, cs_admin, open_order_team, escrow_assistant, sales_rep, title_officer, escrow_officer` | 2 |
| `escrow_officer, super_admin, admin, cs_admin` | 2 |
| `sales_rep, super_admin, admin, cs_admin` | 2 |
| `title_officer, super_admin, admin, cs_admin` | 2 |
| `escrow_officer` | 1 |
| `escrow_assistant, escrow_officer, super_admin, admin, cs_admin` | 1 |
| `super_admin, admin, cs_admin, open_order_team, escrow_assistant, sales_rep, sales_manager` | 1 |

## What was changed

**One site.** `orders/create` now uses `ORDER_CREATE_ROLES`, with a comment
naming the confusion and pointing here. That is the constant that caused the
error; renaming it stops the specific trap.

**Nothing else was touched.** A mass rename across 67 sites is a large blast
radius on authorization code, and the right shape is a decision rather than a
sweep:

- **Leave them local.** Each route states its own rule where it is read. Verbose,
  duplicated, but nothing is action-at-a-distance and a route's guard cannot be
  silently widened by an edit somewhere else.
- **Centralise into named sets** — `ORDER_CREATE_ROLES`, `HUB_READ_ROLES`,
  `OPS_ADMIN_ROLES` — imported everywhere. Fewer definitions, real names, and a
  reader learns each one once. But an edit to a shared list changes every
  consumer, which on authorization is exactly the risk worth being deliberate
  about.
- **Rename in place only.** Keep them local, give each a name that describes
  what it gates. Cheapest, removes the ambiguity, keeps the locality.

The third is the smallest change that fixes the actual defect: the problem is
not duplication, it is that the same NAME means different things.

## The real finding is underneath the rename

**No test asserts any route's allowed set. The authorization surface is
entirely unverified.**

That is not a footnote to the naming problem — it is the reason the naming
problem was able to cost an hour, and it is worth fixing whether or not
anything is ever renamed. Today, a change to any of these 67 lists is invisible:
nothing fails, nothing warns, and the only way to notice is an operator getting
a 403 or — worse — someone reaching a route they should not.

### The prerequisite, not an optional companion

**A test per route asserting exactly which roles reach it, GENERATED FROM THE
CURRENT CONSTANTS.**

Generated, not hand-written, and that distinction is the whole point: it must
document **today's truth**, not somebody's intention about what the rules ought
to be. A hand-written expectation encodes what the author believed; a generated
one encodes what production actually does. If the current lists are wrong, the
test should record them as they are and the wrongness becomes a separate,
visible decision.

Once it exists, any future change to an allowed set shows up in a diff instead
of happening silently. That is what makes the sweep safe.

### Sequence

```
1. assert   — a test per route, generated from today's constants
2. sweep    — rename in place, and watch the assertions hold
```

Not the other way round. A 67-site rename with nothing to catch a widened list
is exactly the kind of unverified sweep this codebase has been bitten by.

**Neither step is scheduled yet.** Both go after the end-to-end harness: the
harness gives every later change a baseline, and building it first means a
regression can be told apart from a gap that was already there.

## Related

- `docs/tickets/E2E_PIPELINE_TEST_SCOPE.md` — the scope this error reached, now
  corrected.
- `docs/claude-skills/claude-skills/watch-outs/writing-from-the-shape-of-the-problem.md`
  — same failure mode: naming a source without reading the one in front of me.
