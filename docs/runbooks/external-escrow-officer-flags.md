# External escrow officer flags — rollout

Run **Fix 1** in Supabase SQL Editor **before** deploying the TD Hub changes that add `/contacts/external-escrow-officers`, so the admin list is populated immediately.

## Fix 1 — One-time backfill (`is_escrow_officer`)

Flag every contact that has been assigned as escrow officer on at least one order:

```sql
UPDATE contacts
SET is_escrow_officer = true
WHERE id IN (
  SELECT DISTINCT escrow_officer_id
  FROM orders
  WHERE escrow_officer_id IS NOT NULL
)
  AND is_escrow_officer = false;
```

Internal PCT officers that were already `true` are unchanged.

## After deploy

- **`/contacts/escrow-officers`** — internal roster (`scope=internal`).
- **`/contacts/external-escrow-officers`** — external roster (`scope=external`).
- **`GET /api/escrow/officers`** — Hub officer chips: internal contacts only (`@pct.com` or linked profile).
- **`sync-contacts`** — each successful sync run reconciles flags from live order assignments (idempotent).
