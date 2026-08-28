-- Migration: order_deliverable_emails
-- Date: 2026-08-28
-- Purpose: per-order CC list for documents sent about that order. The operator
--          types addresses on the open-order form; those people are copied on
--          the confirmation, and later on every document for the life of the
--          order.
--
-- APPLY BEFORE DEPLOYING THE CODE. One table, one enum-free, additive change.
-- No ALTER TYPE, no changes to existing tables, no backfill.
--
-- ═══ WHY A TABLE AND NOT A text[] ON orders ═════════════════════════════════
--
-- The approved decisions (docs/tickets/DELIVERABLE_EMAILS.md, 25 Aug 2026) are
-- "every document for the LIFE OF THE ORDER" and "EDITABLE AFTER OPEN". Both
-- rule out a create-time snapshot, and together they want per-address
-- provenance: who added this address, and when. An array column cannot answer
-- that, and answering it is the point — an address that starts receiving a
-- client's documents mid-transaction should be attributable.
--
-- It also makes the later extension wiring rather than a migration. Only the
-- confirmation reads this today; prelims and other documents join by querying
-- the same table.
--
-- ═══ THE RULE THIS TABLE EXISTS TO ENFORCE ══════════════════════════════════
--
-- THE SEND PATH READS THE STORED LIST. It must never accept an address from a
-- request payload at send time.
--
-- That is the shape of the legacy delivery defect: the browser supplied both
-- the recipient and the attachment, and the server obliged. Storing the list
-- makes the safe path the only path — a send resolves recipients by order id,
-- and there is no parameter through which a caller could add one.
--
-- ═══ NOT A UNIQUE CONSTRAINT ON (order_id, email) ══════════════════════════
--
-- Deliberately absent. The same address added, removed, and added again is a
-- legitimate history, and a unique index would either reject the re-add or
-- force a destructive update that erases who added it the first time.
-- Deduplication happens at send time, where it belongs — the confirmation
-- resolver already dedupes TO against CC and will dedupe this list too.
--
-- Soft delete via removed_at for the same reason: removing an address should
-- not erase the fact that it was there.

BEGIN;

CREATE TABLE IF NOT EXISTS order_deliverable_emails (
  id           serial PRIMARY KEY,
  order_id     integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- Stored lowercase and trimmed by the application. Not a citext column:
  -- comparison happens in one place (the resolver) and a domain type here
  -- would be a second, silent normaliser that could disagree with it.
  email        varchar(320) NOT NULL,

  -- Provenance. The whole reason this is a table.
  added_by     varchar(64),
  added_at     timestamp NOT NULL DEFAULT now(),

  -- Soft delete. A removed address stays visible as history.
  removed_by   varchar(64),
  removed_at   timestamp
);

-- The only read pattern: every live address for one order, at send time.
CREATE INDEX IF NOT EXISTS order_deliverable_emails_order_active_idx
  ON order_deliverable_emails (order_id)
  WHERE removed_at IS NULL;

-- RLS. Added after the fact: this file was applied without it and the table
-- went live RLS-off, which rls-lockdown.test.ts caught on the next full run.
-- Kept here so anyone replaying this file gets a closed table, and mirrored as
-- numbered migration 0040 so the guard can see it.
ALTER TABLE public.order_deliverable_emails ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ═══ VERIFY ═════════════════════════════════════════════════════════════════
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'order_deliverable_emails'
--  ORDER BY ordinal_position;
--
-- Expected: id, order_id, email, added_by, added_at, removed_by, removed_at
--
-- ═══ ROLLBACK ═══════════════════════════════════════════════════════════════
--
-- DROP TABLE IF EXISTS order_deliverable_emails;
--
-- Safe: nothing else references it, and no existing table was altered.
