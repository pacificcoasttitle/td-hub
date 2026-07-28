-- Atomic outbox claim for */1 process_outbox overlap safety.
-- claimed_at marks in-flight rows so FOR UPDATE SKIP LOCKED workers never
-- double-dispatch the same event. Stale claims (>5 min) are re-claimable.

ALTER TABLE "event_outbox" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;

CREATE INDEX IF NOT EXISTS "outbox_claimable_idx"
  ON "event_outbox" ("created_at", "id")
  WHERE "published_at" IS NULL;
