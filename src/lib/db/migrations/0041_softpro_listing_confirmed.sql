-- 0041 — Split SoftPro write-accepted from listing-confirmed.
--
-- WHY
--   GetAttachedDocuments does not see Production Documents subfolders
--   (legal-vesting / grant-deed / tax). AddDocuments 200 (and a later
--   "already exists by that name" 400) means the write was accepted.
--   An empty listing is not proof the file is missing.
--
--   is_synced_to_softpro stays the retry/cron gate: true = we believe the
--   file is in SoftPro (accepted OR confirmed). This column is the third
--   state: listing-confirmed vs listing-blind accepted.
--
--   Existing non-title synced rows (prelim / policy / CPL / …) were either
--   fetched FROM a listing or attached to a folder GetAttached can see.
--   They backfill to confirmed so the hub copy "filed, listing not
--   verifiable" only appears on title docs we pushed listing-blind.
--   Title docs already marked synced (20021642-OCT / 8123) stay accepted.
--
-- ADD COLUMN is a no-op when the column already exists (prod).
-- The UPDATE is the one-time backfill. Skip it when any row is already
-- true — that means the hand-apply already ran. Re-running the UPDATE
-- after writers ship would flip later accepted (listing-blind) non-title
-- rows to confirmed. Fresh rebuilds have every row still false, so the
-- backfill runs and matches prod.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "softpro_listing_confirmed" boolean NOT NULL DEFAULT false;

UPDATE "documents"
SET "softpro_listing_confirmed" = true
WHERE "is_synced_to_softpro" = true
  AND "softpro_listing_confirmed" = false
  AND "category" NOT IN ('legal_vesting', 'grant_deed', 'tax')
  AND NOT EXISTS (
    SELECT 1 FROM "documents" existing
    WHERE existing."softpro_listing_confirmed" = true
  );
