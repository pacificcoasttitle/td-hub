ALTER TABLE "order_notes"
  ADD COLUMN IF NOT EXISTS "is_internal" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "order_notes_order_internal_idx"
  ON "order_notes" ("order_id", "is_internal");
