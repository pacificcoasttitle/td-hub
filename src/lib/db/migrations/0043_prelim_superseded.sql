-- 0043 — Supersede prior prelims instead of stacking active rows.
--
-- WHY
--   Legacy inserted a new prelim row on every Update Prelim and never
--   superseded, so an order accumulated N active prelims and "the prelim"
--   became whichever row a query happened to sort first.
--
--   hasPrelim / prelimAvailable / fetch-prelims all test
--   (category = 'prelim' AND status = 'active'). Deleting the old row would
--   lose the history and break the audit trail; leaving it active makes the
--   predicate ambiguous. So: keep the row active, stamp superseded_at, and
--   point it at the row that replaced it.
--
--   The current prelim is therefore:
--     category = 'prelim' AND status = 'active' AND superseded_at IS NULL
--
--   SoftPro has no delete on this path. Old prelims stay on the vendor file
--   forever, same as CPL. This column describes OUR side only — it is not a
--   claim about what SoftPro holds.
--
-- ADD COLUMN is a no-op when the column already exists (prod).
-- No backfill: every existing prelim row is by definition not yet superseded,
-- which is exactly what superseded_at IS NULL already says.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "superseded_at" timestamp;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "superseded_by_document_id" integer;

-- Partial index: every read of "the current prelim" carries these predicates.
CREATE INDEX IF NOT EXISTS "documents_current_prelim_idx"
  ON "documents" ("order_id")
  WHERE "category" = 'prelim'
    AND "status" = 'active'
    AND "superseded_at" IS NULL;

-- Update Prelim's internal notification.
--
-- Legacy hard-coded this recipient in PHP, so changing who gets it meant a
-- deploy. recipient_roles = {internal} makes resolveRecipients read
-- internal_cc, which is editable in Admin → Notifications.
--
-- Seeded with the one address this repo can evidence. Rudy's address is NOT
-- in the codebase and is not invented here — add it in Admin before the
-- button is turned on, or the email goes only to Gerard.
INSERT INTO "notification_types"
  ("slug", "display_name", "description", "channels", "is_enabled", "recipient_roles", "internal_cc")
VALUES (
  'order.prelim.updated',
  'Prelim Updated',
  'A sales rep uploaded an updated prelim: attached to SoftPro, note added, task 03-005 opened.',
  '{email}',
  true,
  '{internal}',
  '{ghernandez@pct.com}'
)
ON CONFLICT ("slug") DO NOTHING;
