-- SoftPro document write-back proof + retry scheduling.
-- HAND-APPLY TO PROD before deploying code that reads these columns.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "softpro_document_id" varchar(128);

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "softpro_attach_attempt_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "softpro_attach_next_retry_at" timestamp;

CREATE INDEX IF NOT EXISTS "documents_softpro_retry_idx"
  ON "documents" ("is_synced_to_softpro", "softpro_attach_next_retry_at")
  WHERE "is_synced_to_softpro" = false AND "status" = 'active';
