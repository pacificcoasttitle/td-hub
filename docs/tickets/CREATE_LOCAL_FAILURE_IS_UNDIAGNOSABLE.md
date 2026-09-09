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

## SEPARATE DEFECT: there is no transaction

`createLocalRecords` inserts orders, then properties, then parties, then status
history, **with no transaction wrapping the sequence**. That is why a throw
leaves a half-built order rather than nothing at all — #8525 exists, is listed,
and is missing the row that makes it usable.

Wrapping the sequence would turn every one of these into a clean failure the
operator can simply retry, instead of wreckage that needs reconciling by hand.
It is a bigger change than the logging and is **not** made here, but it is the
reason each of these ten costs a manual repair.

## The reconcile gap, demonstrated

The create-lock message was reworded on 2026-09-09 to stop telling operators to
"repair it" — there being no repair screen — and now says to contact support.
It did its job here: the operator did not re-enter the order.

But "contact support" resolves to Gerard's inbox, and this order is the
demonstration that **a reconcile action is needed rather than better wording**.
Everything required to fix #8525 is already held: the address, city, state, zip,
county, APN and legal description are all in the `create_order` payload we sent
SoftPro and logged. It is one insert, and there is no button for it.
