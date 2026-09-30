-- 0062 — page 4: the TitlePoint tax detail, and what it cost.
--
-- WHY THESE COLUMNS EXIST (Gerard, 2026-09-29/30)
--   Page 4 of the Concierge profile has three layers. Layer 2 (SiteX
--   AssessmentTaxInfo) already arrives with the paid generate and needs no
--   storage — it is re-derived from raw_storage_key on every render. Layer 1 is
--   a TitlePoint tax search, which is a SEPARATE BILLABLE CALL, is create →
--   poll → fetch, and can take minutes. It therefore cannot live inside the
--   generate request and cannot be re-derived on demand. It has to be stored.
--
-- WHY THE NORMALIZED REPORT AND NOT THE RAW PAYLOAD
--   DelinquencyInformation is present on 1,322 of 1,322 stored tax payloads;
--   DelinquencyInstallments and RedemptionSchedules on 14 of the most recent 58;
--   OpenPriorYears on 16. Those families are excluded from the document on
--   privacy grounds, and storing the raw payload on a courtesy-document row
--   would put them one careless SELECT away from a client-facing page.
--
--   So tax_report holds the output of parseTitlePointTaxReport() — a type with
--   no field for them — and the raw stays in title_point_data, which is where
--   vendor payloads already live and are already governed. titlepoint_data_id
--   is the link, so the raw is findable without being duplicated here.
--
-- WHY THE CHARGE IS NOT IN sitex_credits_charged
--   It is a different vendor with a different unit and a different invoice. A
--   blended number cannot be reconciled against either bill, and the admin
--   usage view is required to show the two side by side rather than summed.
--   titlepoint_request_id is the reconciliation handle — it is the only
--   per-call identifier TitlePoint issues, and it is what maps an invoice line
--   to a profile.
--
-- WHY A DENIAL IS FREE, AND RECORDED ANYWAY
--   Verified: 61 county denials, zero TitlePoint request ids issued. TitlePoint
--   refuses at create_service before doing any work, so there is no unit of
--   work to bill. We still record it, because the set of counties we are not
--   entitled to is growing and a hardcoded list would stop us noticing.
--   tax_detail_status = 'denied' with titlepoint_charges = 0 is that record.
--
-- WHY tax_assessed_basis
--   Layer 1 carries no assessed total: AssessedValuation is empty on all 1,322
--   payloads. The total is composed from land + improvements and printed only
--   when it reconciles against the billed tax to within 0.5%
--   (see titlepoint-tax-report.ts). It is suppressed on about 2%. A suppression
--   nobody can account for later is how a real vendor problem gets filed as a
--   rendering quirk, so the reason is stored: verified / mismatch /
--   unverifiable / absent / stated.

ALTER TABLE concierge_profiles
  -- The operator asked for it. Default FALSE: this is opt-in and it costs money.
  ADD COLUMN IF NOT EXISTS tax_detail_requested  boolean NOT NULL DEFAULT false,
  -- pending | ready | empty | denied | failed. NULL means never asked for.
  --   pending — create succeeded; the poll is in flight or timed out PAID
  --   ready   — a report with content is stored; page 4 renders on layer 1
  --   empty   — the search ran and the county holds nothing; page 4 falls to 2
  --   denied  — the county is not entitled; free; nothing was charged
  --   failed  — an error we could not classify
  ADD COLUMN IF NOT EXISTS tax_detail_status     varchar(20),
  -- Which layer page 4 actually rendered on, as rendered. 'titlepoint' | 'sitex'.
  ADD COLUMN IF NOT EXISTS tax_detail_source     varchar(20),
  ADD COLUMN IF NOT EXISTS tax_detail_error      text,
  -- parseTitlePointTaxReport() output. NEVER the raw payload — see above.
  ADD COLUMN IF NOT EXISTS tax_report            jsonb,
  ADD COLUMN IF NOT EXISTS tax_assessed_basis    varchar(20),
  -- TitlePoint's own per-call id: the handle that maps an invoice line to this
  -- profile. Nothing else TitlePoint returns is per-call.
  ADD COLUMN IF NOT EXISTS titlepoint_request_id varchar(100),
  ADD COLUMN IF NOT EXISTS titlepoint_data_id    integer,
  -- Per-vendor, deliberately separate from sitex_credits_charged.
  ADD COLUMN IF NOT EXISTS titlepoint_charges    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS titlepoint_requested_at timestamp,
  ADD COLUMN IF NOT EXISTS titlepoint_duration_ms  integer;

-- No FK to title_point_data on purpose: that table is pruned on its own
-- schedule for orders, and a profile losing its raw link must not take the
-- profile with it. The link is evidence, not a dependency.

-- The background finisher asks one question — "which profiles are still
-- waiting?" — so the index answers exactly that and nothing else.
CREATE INDEX IF NOT EXISTS concierge_profiles_tax_pending_idx
    ON concierge_profiles (titlepoint_requested_at)
 WHERE tax_detail_status = 'pending';

-- Reconciliation against a TitlePoint invoice is by request id.
CREATE INDEX IF NOT EXISTS concierge_profiles_tp_request_idx
    ON concierge_profiles (titlepoint_request_id)
 WHERE titlepoint_request_id IS NOT NULL;

-- VERIFY
--   \d concierge_profiles
--   -- tax_detail_requested boolean NOT NULL DEFAULT false
--   -- titlepoint_charges   integer NOT NULL DEFAULT 0
--
--   -- Existing rows must be untouched and unrequested:
--   SELECT count(*) FILTER (WHERE tax_detail_requested) AS requested,
--          count(*) FILTER (WHERE titlepoint_charges > 0) AS charged,
--          count(*) AS total
--     FROM concierge_profiles;
--   -- expect requested = 0, charged = 0
--
--   -- And the SiteX charge column is unchanged by this migration:
--   SELECT id, sitex_credits_charged, titlepoint_charges FROM concierge_profiles ORDER BY id;
