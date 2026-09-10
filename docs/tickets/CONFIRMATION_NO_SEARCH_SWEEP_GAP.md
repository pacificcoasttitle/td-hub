# Confirmations with no TitlePoint rows are never swept

**Status: FIXED FORWARD — historical rows deliberately untouched**
Opened: 2026-09-09

## The finding

Seven days of active orders:

```
TitlePoint rows present   175 orders   175 confirmations
TitlePoint rows absent     55 orders     0 confirmations
```

That 175-for-175 against 0-for-55 correlation is the mechanism, not a theory.

`getConfirmationReadiness` deliberately handles an order with zero TitlePoint
rows. It falls back to the order's age, waits for the confirmation timeout, and
returns a late, honest `timeout` result with `noDocuments: true`.

`sweepPendingConfirmations`, the only process that could call that fallback
without a TitlePoint completion callback, filtered the order out first:

```sql
and exists (
  select 1 from title_point_data t where t.order_id = o.id
)
```

The fallback was correct and unreachable. With no searches there is no callback;
without the sweep there is no outbox row; without the outbox row the
confirmation stays `pending` forever.

## The two reported orders were different

`20022040-GLT` sent successfully at 16:54:32 PDT to Ada Ruiz, CC Team
Meza and `openorders@pct.com`. Its recorded attachment set contains legal
vesting, tax, and grant deed, with nothing dropped.

`20022014-GLT` (order 8525) is the known partial-create failure. SoftPro created
the file, the Hub's local create failed at the property insert, and TitlePoint
was never invoked. Gerard chose not to re-run it. This ticket does not re-open
that diagnosis or repair that order; it addresses the confirmation failure
underneath it.

## Why removing `exists(title_point_data)` is wrong

The pre-change check was run before editing the sweep.

Today's eleven no-search, pending orders:

- **9** were `softpro_sync`
- **2** were `manual_entry`
- **5** had a client contact; **6** did not

A bare predicate removal would release all eleven. The no-client sends would
still go to `openorders@pct.com`, but that would not make imported orders part
of the Hub-created confirmation workflow.

Across seven days, the 55 split as:

- **50** `softpro_sync`
- **5** `manual_entry`

All 50 synced orders were never meant to confirm through this pipeline. A
negative test such as `source <> 'softpro_sync'` is also unsafe: the next enum
value would silently inherit a customer email. The no-search path must use an
explicit allowlist.

## Fix

Keep the existing search-backed path for every source. Add a second path only
for orders that:

1. have source `manual_entry` or `web_form`;
2. were created on or after `2026-09-10T01:35:00.000Z`, when the fix was
   authorized; and
3. otherwise satisfy the existing active-status, unsent, deduplication, and
   timeout checks.

Conceptually:

```sql
and (
  exists (select 1 from title_point_data where order_id = o.id)
  or (
    o.source in ('manual_entry', 'web_form')
    and o.created_at >= '2026-09-10T01:35:00.000Z'
  )
)
```

The timestamp is intentionally fixed in code. It makes "fix forward" stable
across cold starts and deploys without updating 877 historical rows merely to
manufacture a boundary.

## Resulting behavior

A new Hub-created order whose creation partially fails before TitlePoint starts
is picked up after the configured timeout (25 minutes). The normal confirmation
builder reads the documents table, sees no attachments, renders the
no-documents form of the email, and records the empty attachment set in
`notification_logs.metadata`.

It does **not** send immediately. It uses the existing order-age fallback and
the same outer-bound semantics as an in-flight search.

The eleven observed today, including order 8525, all predate the watermark and
are untouched. The 877 historical rows are untouched. No backfill, re-run,
status update, or outbox insertion was performed.

