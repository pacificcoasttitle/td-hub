-- A multi-match is answerable: keep the parcels SiteX offered.
--
-- A 300 from /realestatedata/search means "that address matches more than one
-- property" and carries one candidate per parcel, with its own APN and FIPS.
-- It costs nothing. Until now the feed client called it an API error and the
-- row said "SiteX returned HTTP 300" with the candidates discarded, so the
-- operator had no way to answer the question they had just been asked.
--
-- Stored on the row rather than only returned to the browser, so a failed
-- profile stays answerable after the modal is closed.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS match_candidates jsonb;

-- The parcel this request was searched BY, when it was searched by one at all.
-- subject_apn/subject_fips are what came BACK; these are what went out, and the
-- difference matters when asking why a retry still missed.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS requested_apn varchar(50);
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS requested_fips varchar(10);
