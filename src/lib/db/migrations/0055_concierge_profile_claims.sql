-- 0055 — the double-charge guard for the Concierge profile, keyed on the property.
--
-- WHY THE OLD GUARD HAD TO GO
--   It was "one profile per order": the route called getProfileForOrder and
--   refused with 409. The entry point is moving off the order to the Reports
--   page, where a request carries no order at all — so that guard would protect
--   nothing, and two clicks would be two SiteX credits.
--
-- WHAT REPLACES IT, AND THE THING THE HANDOVER GETS WRONG
--   There is NO free address-resolution step to key on. fetchConciergeProfile
--   makes exactly one SiteX call and it both resolves the address and returns
--   the data; creditsCharged is 1 on any 2xx. The APN, the location count and
--   the SearchId all arrive FROM that call. Nothing derived from resolution
--   exists before the money is spent.
--
--   So the claim is taken on the NORMALIZED REQUESTED ADDRESS, before the call,
--   and the APN is written onto the claim afterwards as evidence of which
--   property the address turned out to be.
--
-- HOW IT WORKS
--   One row per request key. A request claims it with
--     INSERT ... ON CONFLICT (request_key) DO UPDATE ... WHERE claimed_at < cutoff
--   which is atomic: two simultaneous requests cannot both come away holding it.
--   The loser reads the winner's profile_id and returns that profile instead of
--   generating. A claim older than the window is taken over, because comps move
--   and a genuine re-run next quarter must still work.
--
--   The window is minutes, not days — long enough that a double-click or a
--   refresh returns the existing profile, short enough that it never blocks a
--   real second look. The exact figure lives in the code
--   (CONCIERGE_CLAIM_WINDOW_MINUTES) so it can change without a migration.
--
--   A generation that spent nothing releases its claim, so a network failure
--   does not lock a property out. One that charged keeps it: the credit is gone
--   and a second click must not spend another.
--
-- RLS
--   Enabled in the same migration as the CREATE, per 0038/0040.

CREATE TABLE IF NOT EXISTS concierge_profile_claims (
  request_key   varchar(200) PRIMARY KEY,
  profile_id    integer REFERENCES concierge_profiles(id) ON DELETE SET NULL,
  -- The property the address resolved to. Written after the call, for evidence:
  -- it cannot be part of the pre-spend key because it does not exist yet.
  apn           varchar(50),
  claimed_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concierge_profile_claims_claimed_idx
  ON concierge_profile_claims (claimed_at);

ALTER TABLE public.concierge_profile_claims ENABLE ROW LEVEL SECURITY;

-- VERIFY
--   SELECT relrowsecurity FROM pg_class WHERE relname='concierge_profile_claims';  -- true
--   SELECT count(*) FROM concierge_profile_claims;                                  -- 0
