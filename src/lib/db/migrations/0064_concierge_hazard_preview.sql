-- MyNHD flood-and-fire hazard preview: the columns for one preview per profile.
--
-- Mirrors 0062's tax columns, because the bridge mirrors tax-bridge.ts. Status
-- carries the same 'fetched' state between pending and ready, for the same
-- reason: 'ready' has to mean "on the document", which is the only thing an
-- operator can check. Profile 9 said ready over a PDF written five seconds
-- before its own search started.
--
-- FREE TO PCT (Gerard, 12 Oct 2026), so there is no charge column and nothing
-- to reconcile against an invoice. What IS recorded is the vendor's own
-- success/code/error, so a refused preview can be explained months later —
-- MyNHD reports a multi-match as HTTP 200 with success:false, and "it didn't
-- work" is not an answer anybody can act on in December.
--
-- Purely additive. Every column nullable or defaulted, no index, no constraint,
-- nothing renamed or dropped. Existing rows read exactly as they do today.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_requested boolean NOT NULL DEFAULT false;

-- pending | fetched | ready | failed. No 'empty': a preview either exists or
-- it does not, and "the vendor holds nothing for this parcel" arrives as a
-- refusal with a reason, not as an empty success.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_status varchar(20);
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_error text;

-- The PNG, in S3 under the profile. Key, digest and size, same as the plat map
-- and the comp map, so a sheet can be proved to be the bytes we were sent.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_storage_key varchar(500);
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_sha256 char(64);
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_bytes integer;

-- The PNG's own pixel dimensions, read from its IHDR rather than assumed. The
-- page layout depends on them: a preview sized for a screen may be too soft to
-- print, and that is a measurement, not a guess.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_width integer;
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_height integer;

-- Where the homeowner can order the full disclosure, from the same response
-- that carried the preview. PCT does not resell NHD reports: this is printed as
-- a plain footnote line, not a button and not branded.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_order_link text;

-- The vendor's own words about what it did. hazard_success is MyNHD's `success`
-- field as sent — true, false, or null when absent, which their error bodies
-- often are. Not our interpretation of it.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_success boolean;
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_code varchar(40);
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_http_status integer;
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_requested_at timestamp;
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_duration_ms integer;
