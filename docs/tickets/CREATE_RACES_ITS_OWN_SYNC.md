# The hub's own create races the hub's own sync

**Opened:** 2026-09-14 · **Status:** open, not fixed

## What happens

A hub create calls SoftPro `create_order`, waits for the 200, and only then
inserts the local `orders` row. `softpro.sync_recent_orders` polls SoftPro for
recently opened files and inserts any it does not hold. When SoftPro is slow,
the sync sees the new file first and imports it, and the hub's own insert then
fails on `orders_file_number_idx` (unique).

Both occurrences since the recorder went live on 2026-09-09:

| File | SoftPro opened | Sync inserted the row | `create_order` returned | Hub insert failed |
|---|---|---|---|---|
| `20022044-GLT` | 07:00:18Z | 07:00:30Z (`source softpro_sync`) | 07:00:53Z (35 s) | 07:00:53Z |
| `20022165-OCT` | 00:00:23Z | 00:00:29Z (`source softpro_sync`) | 00:00:51Z (28 s) | 00:00:51Z |

The recorded failure is the `orders` insert. Its Postgres code was not captured
— the recorder read Drizzle's wrapper, fixed in #130 — so the unique violation
is established from the row having existed 22–23 seconds before the insert and
from the unique index, not from a recorded `23505`. The next occurrence will
carry the code.

## Why it matters

The order exists and looks normal; `20022044-GLT` was later delivered a prelim
(2026-09-11). What it lacks is whatever only the hub create writes: the
operator's parties as entered, `created_by`, deliverable emails, the SiteX
property values. **Not yet checked field by field.** The operator was told the
file was created in SoftPro and not to re-enter, which was true.

The recorder's `stage` said `after_properties` for both, because it infers the
stage from which rows exist afterwards and the sync had written them. #130
records the failing statement from the SQL instead.

## The fix

The create must **take over the row the sync already made** rather than fail on
the duplicate. On a unique violation on `orders.file_number` where the existing
row is `source = 'softpro_sync'` and was created after this create began, update
that row with the hub's values and continue with property, parties and status
against its id. This is the same take-over reconcile needs
(`CREATE_LOCAL_FAILURE_IS_UNDIAGNOSABLE.md`, "The transaction, rethought").

Not in scope: slowing the sync down. The sync importing new files within seconds
is correct; the create should not assume it is alone.
