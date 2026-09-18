-- 0059 — the property a profile is OF, stored as the key the guard uses.
--
-- WHY THIS COLUMN EXISTS (Gerard, 2026-09-18)
--   Fifteen minutes is currently the only thing standing between us and paying
--   twice for the same property. `concierge_profile_claims` holds one row per
--   normalized address and expires after CONCIERGE_CLAIM_WINDOW_MINUTES; after
--   that, the same address generates again and charges again, silently. That
--   window is right for what it does — it defeats a double-click and an
--   impatient second operator — and wrong as a memory of what we already own.
--
--   So the profile row itself records which property it is of, using the SAME
--   key: propertyRequestKey() in lib/domain/concierge/claim.ts. An operator
--   about to spend is then told "a profile for this property was generated on
--   12 September", and chooses.
--
-- WHY THE KEY AND NOT THE ADDRESS COLUMNS
--   requested_address/city/state/zip are what the operator typed. Two people
--   typing the same property produce different strings — case, punctuation,
--   "St" and "Street", a ZIP+4 — and the whole point of the key is that they do
--   not buy two reports. Re-deriving that normalization in SQL would put a
--   second implementation next to the first, and the two would drift. The key
--   is computed once, in TypeScript, and stored.
--
-- WHY NOT THE APN, AGAIN
--   The APN arrives FROM the spend — one SiteX call both resolves the address
--   and charges — so it cannot key a question asked BEFORE the money is gone.
--   It stays what it has always been: evidence written afterwards.
--
-- NULLABLE
--   Historic rows predate the column, and a row is created before anything is
--   known about it. A NULL key simply means this profile answers no
--   "do we already have it?" question; it never means "we do not".

ALTER TABLE concierge_profiles ADD COLUMN IF NOT EXISTS property_key varchar(200);

-- Backfill from the claims table rather than by re-normalizing the address:
-- claim.request_key IS the output of propertyRequestKey() for that generation,
-- so this copies the real value instead of a second guess at it.
UPDATE concierge_profiles p
   SET property_key = c.request_key
  FROM concierge_profile_claims c
 WHERE c.profile_id = p.id
   AND p.property_key IS NULL;

-- The lookup is "the most recent profile for this property", so the index
-- carries the order with it.
CREATE INDEX IF NOT EXISTS concierge_profiles_property_key_idx
    ON concierge_profiles (property_key, created_at DESC);

-- VERIFY
--   SELECT id, property_key, status, created_at FROM concierge_profiles ORDER BY id;
--   -- profile 3 should read '1358 5th st|la verne|ca|91750'
