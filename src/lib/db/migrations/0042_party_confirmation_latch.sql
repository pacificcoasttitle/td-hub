-- 0042 — Party confirmation latch.
--
-- WHY
--   A value a named human confirmed (party wizard submit — changed or left
--   as-prefilled) must survive every later enrichment: SoftPro sync, SiteX,
--   lookback, enrich, merge. order_parties.source is write-origin and is null
--   on every existing row; it is not this latch.
--
--   party_confirmed_at on the party row is the gate. A non-empty name / email
--   / phone / company on a confirmed row is frozen; an empty field on that
--   row may still be filled.
--
--   party_submissions keeps what we showed (prefilled_values) and which keys
--   the human changed, so a later replay can tell confirm-as-shown from edit.
--
-- HAND-APPLY TO PROD before deploying code that reads these columns.
-- Additive and nullable. No backfill — nothing has been confirmed yet.

ALTER TABLE "order_parties"
  ADD COLUMN IF NOT EXISTS "party_confirmed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "party_confirmed_submission_id" integer
    REFERENCES "party_submissions"("id") ON DELETE SET NULL;

ALTER TABLE "party_submissions"
  ADD COLUMN IF NOT EXISTS "prefilled_values" jsonb,
  ADD COLUMN IF NOT EXISTS "changed_keys" jsonb;
