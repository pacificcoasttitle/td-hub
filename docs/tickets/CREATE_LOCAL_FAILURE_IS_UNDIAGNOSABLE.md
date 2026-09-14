# The hub insert throws, the reason is discarded, and the wreckage stays

Order `20022014-GLT` (#8525), 2026-09-10. Reported by the open order team: the
order appears with no address.

## What actually happened

Narrower than "the hub didn't record it". The order row saved, the parties
saved. **One row is missing.**

`createLocalRecords` inserts in this sequence:

```
426  orders             present
476  orderProperties    MISSING
482  orderParties       never ran  (the 6 parties came from enrich_order_contacts at 02:30)
485  orderStatusHistory 0 rows
```

So it threw at the property insert.

## Why nobody could say more than that

```ts
try {
  ({ orderId } = await createLocalRecords(...));
} catch {                       // <- bare
  return foundDoNotReenter(fileNumber);
}
```

The error was **discarded**. Not logged, not stored, not categorised.

And it is not either cause we have fixed before:

```
Address1 "4560 N Webster Ave" (18)   address is varchar(500)
Zip      "92571"              (5)    zip is varchar(20)
City     "Perris"             (6)
County   "Riverside"          (9)
APN      "314-160-022"        (11)
```

Every value far inside its column limit, and `create_order` returned 200
immediately, so no timeout. **A third cause, and the code was written so it
could not be identified.**

## Not one incident — a daily leak

```
hub-created orders with no property row, all time : 10
   09-09 x1   09-08 x1   09-03 x2   09-02 x1   09-01 x3   08-31 x2
```

About one a day since at least 2026-08-31, roughly 1 in 20 hub orders, and
predating every deploy made on 2026-09-09. **Those orders have no property, so
no title search ever ran and those clients received no documents.**

## Fixed here

The catch now persists before returning: message, Postgres `code`,
`constraint`, `column`, `table` and `detail`, plus which rows landed before the
throw (so the stage is known even when the message is not) and the field lengths
that caused the two previous occurrences. Written to `admin_activity_logs` keyed
on the file number, because the order row may or may not exist at that point.

The helper cannot fail the create: its own body is wrapped, since recording a
reason must never turn a recoverable create into a 500.

Same rule as `THROWING_ON_A_VENDOR_ERROR_DISCARDS_THE_BODY.md`, applied to our
own database rather than a vendor's response.

## SEPARATE DEFECT: there is no transaction — and one alone would not help

`createLocalRecords` inserts orders, then properties, then parties, then status
history, **with no transaction wrapping the sequence**. That is why a throw
leaves a half-built order rather than nothing at all — #8525 exists, is listed,
and is missing the row that makes it usable.

*(Corrected 2026-09-14.)* This section originally said wrapping the sequence
would turn every failure into "a clean failure the operator can simply retry".
**It would not**, and the design is in "The transaction, rethought" below.

## The reconcile gap, demonstrated

The create-lock message was reworded on 2026-09-09 to stop telling operators to
"repair it" — there being no repair screen — and now says to contact support.
It did its job here: the operator did not re-enter the order.

But "contact support" resolves to Gerard's inbox, and this order is the
demonstration that **a reconcile action is needed rather than better wording**.
Everything required to fix #8525 is already held: the address, city, state, zip,
county, APN and legal description are all in the `create_order` payload we sent
SoftPro and logged. It is one insert, and there is no button for it.

---

## The cause, found 2026-09-14

Order `20022166-GLT` (#8687), opened 2026-09-14 for 805 Title, had the same
half-created shape. It was the first occurrence investigated after the recorder
above went live — and the recorder had stored nothing useful.

### The recorder read the wrapper

All ten `order_create_local_failed` rows from 2026-09-09 to 2026-09-14 have
`code`, `constraint`, `column` and `detail` **null**. Drizzle 0.45 throws a
`DrizzleQueryError`: its message is the failed statement plus its parameters,
and the postgres.js error carrying those fields is on `cause`. The recorder
read the wrapper. Fixed in #130 (`src/lib/db/pg-error.ts`).

The parameters were still in the message, so the reason could be recovered by
replaying them into a temp table shaped like `order_properties`:

```
code 22001 · "value too long for type character varying(50)" · routine varchar
```

A control insert — every other value from #8687, with the property type
shortened — succeeds.

### Two causes, not one

| Cause | Orders | Shape |
|---|---|---|
| **A. `property_type` overflow** | 8: `20022031-GLT`, `20022059-OCT`, `20022078-GLT`, `20022098-GLT`, `20022118-GLT`, `20022160-GLT`, `20022161-GLT`, `20022166-GLT` | Order row saved; no property, parties or status. **The no-address shape.** |
| **B. The sync imported the file first** | 2: `20022044-GLT`, `20022165-OCT` | A separate defect: `CREATE_RACES_ITS_OWN_SYNC.md`. |

`property_type` holds SiteX's `UseCodeDescription`, free text, unchecked, in
`varchar(50)`. The eight descriptions:

```
Mobile/Manufactured Home (regardless of Land ownership)      55   x4
Religious, Church, Worship (Synagogue, Temple, Parsonage)    57
Single Family Residential - Two or more SFR on one parcel    57   x2 (same property)
Retail Stores (Personal Services, Photography, Travel)      54
```

That is 8 of the 131 hub-created orders since 2026-09-09 (6%). Migration 0047
makes the column `text` (#130).

**The twelve before the recorder** (hub orders from 31 Aug to 10 Sep with a
missing or late property row) cannot be confirmed as cause A. The land use is
held nowhere we can read: not in SiteX logs, not in the SoftPro payload, and
there is no cache. Re-querying SiteX is billable and was declined — the rate
and shape match, and confirming would change nothing we do.

The earlier investigation of `20022014-GLT` (top of this ticket) checked
address, zip, city, county and APN lengths and concluded "a third cause". It
never checked `property_type`, and `CREATE_ORDER_ORPHANS_2026-08-31.md` — on
main since 1 September — already named this exact column.

## Why it came back

It was never fixed. On 2026-09-01 `CREATE_ORDER_ORPHANS_2026-08-31.md`
diagnosed the overflow correctly, by column and by SiteX field, and declared the
defect "closed in code". Searched on 2026-09-14:

- **No migration on any branch** has changed `property_type` since the March
  scaffold (`cfac6fb`, `varchar(50)`) — 74 migration files across all refs.
- **No commit on any branch** truncates `propertyType` in any writer.
- **No uncommitted change** in `td-hub-create-persist`, `td-hub-create-orphans`
  or `td-hub-create-timeout`. The branch named for the fix,
  `fix/create-persist-after-softpro-200`, has no commits beyond main — the
  1 September ticket says so itself.
- **What did ship that day** (#80, `7888b2b`) was the *handling*: after a
  SoftPro 200, a failed local write returns "created in SoftPro, do not
  re-enter" and locks Create. It sat behind a bare `catch {}` that discarded the
  error, and its test throws `new Error('value too long for type character
  varying(50)')` — the cause, by name, used as a fixture for the treatment.

So "closed" meant "the failure is handled", not "the failure cannot happen". The
handling was also what hid it: the bare catch is why the recurrence on
2026-09-10 looked like an unknown cause.

The same shape as the other two this month:

| Fix | Declared | What was actually true |
|---|---|---|
| Lookup-code overflow | fixed 2 Sep (`902df82`) | sat on a branch until 10 Sep (#121) |
| Address blanking | fixed on contacts 9 Sep (#115) | companies had the identical defect until 12 Sep (#126) |
| `property_type` overflow | "closed in code" 1 Sep | the symptom was handled; the column was never touched |

In all three, *fixed* was attached to something other than a check, in
production, that the failure can no longer occur.

## The transaction, rethought

"Wrap orders, property, parties and status in a transaction, all or nothing"
does not remove the category, because **SoftPro is written first, outside any
transaction we can open**:

1. **A rollback leaves a live SoftPro file with no hub order.** `create_order`
   returns 200 before `createLocalRecords` begins. Nothing can undo it — there
   is no SoftPro cancel API, and cancelling is Select's decision.
2. **Telling the operator to re-enter mints another SoftPro file.** The failure
   is deterministic for a given property: the same description overflows again.
   `20022160-GLT` and `20022161-GLT` are the proof — the same Fontana property
   entered by two people seven minutes apart, both failing on the same
   57-character string: **two SoftPro files for one property.**
3. **"No order at all" does not hold either.** `softpro.sync_recent_orders`
   imports new files within seconds (cause B). A rolled-back create reappears as
   a sync-imported order without what the operator entered.

**The design:** the transaction is still right, but its failure path is *roll
back locally and hand off to reconcile* — **never tell the operator to
re-enter.**

- The local sequence runs in one transaction, so a failure leaves no partial
  rows.
- On failure, the file number, the SoftPro create payload and the recorded
  Postgres error are persisted **outside** the transaction. The recorder already
  does this, and must stay outside it.
- The operator sees: the file exists in SoftPro as `<file>`, it is being
  finished, do not re-enter. Create stays locked for that file.
- **Reconcile** finishes the write from what we hold: the logged payload, the
  recorded statement and parameters, and the operator's input. It must take over
  a row the sync has since imported rather than insert beside it
  (`CREATE_RACES_ITS_OWN_SYNC.md`).
- **The alert** fires on every `order_create_local_failed`, so the people who
  can reconcile hear about it from the system, not from the operator.
