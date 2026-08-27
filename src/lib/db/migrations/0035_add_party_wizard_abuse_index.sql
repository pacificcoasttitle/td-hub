-- Index for the party wizard per-IP rate limit counter.
--
-- The limiter counts rows in vendor_api_logs (see
-- src/lib/domain/parties/party-wizard-abuse.ts) and runs on the critical path of
-- an unauthenticated page render, so the count must not be allowed to widen into
-- the table's history. vendor_api_logs held ~1.1M rows at the time of writing
-- while only ~750 land per hour, so the existing vendor_logs_created_idx already
-- keeps the scan small; this partial index makes it exact by covering only the
-- public party wizard rows and ordering them the way the query reads them.
--
-- Partial rather than a plain composite so it stays tiny: it indexes public
-- party wizard traffic only, not the million SoftPro and TitlePoint rows.
CREATE INDEX IF NOT EXISTS vendor_logs_party_wizard_ip_idx
  ON vendor_api_logs ((request_meta->>'ipHash'), created_at DESC)
  WHERE vendor = 'party_wizard';
