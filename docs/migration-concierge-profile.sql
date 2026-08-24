-- Migration: concierge_property_profile_phase1
-- Date: 2026-08-24
-- Purpose: full generation snapshot for the Concierge Property Profile, so any
--          report can be reproduced and defended months later.
--
-- APPLY BEFORE DEPLOYING THE CODE. Three tables, no enum changes, no ALTER TYPE.
--
-- ═══ WHY THIS IS SHAPED THIS WAY ════════════════════════════════════════════
--
-- THE LEGACY SYSTEM STORES A FILENAME. Nothing else. A report cannot be
-- reproduced, and if a client disputes a comparable there is no record of what
-- was returned, what was filtered out, or on what basis. Every column below
-- exists to make one of those questions answerable.
--
-- THE REPORT MUST NEVER COMPUTE ITS OWN CRITERIA BACKWARDS FROM RESULTS.
-- criteria_* holds what we ASKED FOR; comps_returned/qualified/shown hold what
-- happened. Page 5 prints the criteria columns. If those two ever disagree it
-- is visible, rather than the report inventing a filter it never applied.
--
-- NEVER PAD TO REACH A COUNT. comps_shown may be less than criteria_max_comps
-- and that is a correct outcome, not an error. There is deliberately NO
-- constraint requiring comps_shown = criteria_max_comps.
--
-- EVERY RETURNED COMP IS STORED, selected or not, with the reason it was
-- excluded. That is what makes a challenged comparable defensible.
--
-- A FAILED GENERATION IS A ROW, NOT A GAP. status='failed' with an error and no
-- PDF. A failed retrieval must never yield a document, and must never silently
-- vanish either.
--
-- TIMESTAMPS are `timestamp` (no time zone) to match all existing columns.
-- MONEY is numeric(12,2), matching orders.sales_price.


-- ── 1. One row per generation attempt ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS concierge_profiles (
  id                        serial PRIMARY KEY,

  -- Optional: a profile can be run for an address that is not (yet) an order.
  order_id                  integer REFERENCES orders(id) ON DELETE SET NULL,

  -- ── what we searched for, exactly as submitted ────────────────────────────
  requested_address         varchar(500) NOT NULL,
  requested_city            varchar(100),
  requested_state           varchar(10),
  requested_zip             varchar(20),

  -- ── the vendor call ───────────────────────────────────────────────────────
  sitex_feed_id             varchar(20)  NOT NULL,
  -- SearchId is the only per-call handle SiteX returns; it is how a line on an
  -- invoice is reconciled back to a report we generated.
  sitex_search_id           bigint,
  sitex_requested_at        timestamp,
  sitex_duration_ms         integer,
  sitex_credits_charged     integer NOT NULL DEFAULT 0,

  -- ── the anti-wrong-house guard, recorded as evidence ──────────────────────
  -- Generation is refused unless is_valid_address AND NOT outside_coverage AND
  -- location_count = 1. Storing the values proves the guard was satisfied.
  is_valid_address          boolean,
  outside_coverage          boolean,
  location_count            integer,
  match_method_code         varchar(10),

  -- ── the raw payload, so everything else is re-derivable ───────────────────
  raw_storage_key           varchar(500),
  raw_sha256                char(64),
  raw_bytes                 integer,

  -- ── plat map (the reason we chose feed 100001 over 100002) ────────────────
  -- NOT a URL. SiteX returns PlatMap as an OBJECT:
  --   {"FileName":"<guid>.tif","Content":"<base64>","Status":"Available"}
  -- so there is nothing to link to — the image arrives inline and we decode and
  -- store it ourselves. Promoted to columns because the plat map is a page in
  -- the document; re-deriving it from the raw payload on every render is cheap
  -- now and irritating later.
  --
  -- Status can be other than 'Available', so the document must be able to
  -- render the absence rather than assume an image exists.
  platmap_filename          varchar(200),
  platmap_status            varchar(30),
  platmap_storage_key       varchar(500),
  platmap_sha256            char(64),

  -- ── comps map (PropertyMapURL) ────────────────────────────────────────────
  -- TEXT, not varchar(n), and that is deliberate. The URL carries one `pp=`
  -- point per plotted comp at ~31 chars each: measured 622 chars for 15 points,
  -- which projects past 1000 at ~40 points. comp_max is accepted-and-ignored on
  -- this feed, so we cannot bound how many comps come back — a dense market
  -- could overflow any length we picked. Sizing this from the /sample payload
  -- would have been worse still: the sample truncates it to the bare host
  -- (34 chars), so a varchar sized off it would have silently cut real URLs.
  comp_map_url              text,
  -- The rendered map image is SNAPSHOTTED, not just linked. The URL points at
  -- SiteX's own renderer and is very likely time- or session-bound, so a report
  -- regenerated in three years would render a broken map — which fails exactly
  -- the test this whole schema exists to pass. A few hundred KB against a
  -- document we are already storing. The plat map arrives inline as base64 and
  -- is stored either way; this makes the two maps consistent.
  comp_map_storage_key      varchar(500),
  comp_map_sha256           char(64),

  -- ── normalized subject (queryable; raw remains the source of truth) ───────
  subject_apn               varchar(50),
  subject_fips              varchar(10),
  subject_county            varchar(100),
  subject_use_code          varchar(20),
  subject_use_description   varchar(200),
  subject_beds              integer,
  subject_baths             numeric(4,1),
  subject_building_area     integer,
  subject_lot_size          integer,
  subject_year_built        integer,
  subject_latitude          numeric(10,6),
  subject_longitude         numeric(10,6),

  -- NULLABLE ON PURPOSE. SaleLoanInfo came back with zero keys on a real
  -- property, so the subject's own last sale can legitimately be absent. The
  -- report renders the gap; it must never borrow a comparable's figure.
  subject_last_sale_date    date,
  subject_last_sale_price   numeric(12,2),

  -- ── normalized tax/assessment ─────────────────────────────────────────────
  tax_year                  integer,
  tax_assessed_value        numeric(12,2),
  tax_land_value            numeric(12,2),
  tax_improvement_value     numeric(12,2),
  tax_market_value          numeric(12,2),
  tax_amount                numeric(12,2),
  tax_status                varchar(50),

  -- ── the criteria we APPLIED (never derived from results) ──────────────────
  criteria_same_use_code    boolean NOT NULL,
  criteria_living_area_pct  integer,          -- e.g. 30 => +/-30%
  criteria_bed_delta        integer,          -- e.g. 1  => +/-1 bedroom
  criteria_bath_delta       integer,
  criteria_radius_miles     numeric(5,2),     -- the radius we applied
  criteria_months           integer,          -- sale recency window
  criteria_max_comps        integer NOT NULL, -- a TARGET, not a quota
  criteria_extra            jsonb,            -- room for future sliders

  -- ── what actually happened ────────────────────────────────────────────────
  comps_returned            integer NOT NULL DEFAULT 0,
  comps_qualified           integer NOT NULL DEFAULT 0,
  comps_shown               integer NOT NULL DEFAULT 0,

  -- ── calculated metrics, stored so the PDF and the DB cannot drift ─────────
  metrics                   jsonb,

  -- ── people, snapshotted AS OF GENERATION (they change; the report must not)
  prepared_for_name         varchar(200),
  prepared_for_email        varchar(200),
  prepared_for_company      varchar(200),
  presenting_rep_name       varchar(200),
  presenting_rep_email      varchar(200),
  presenting_rep_phone      varchar(50),
  presenting_rep_title      varchar(120),

  -- ── the artifact ──────────────────────────────────────────────────────────
  template_version          varchar(20) NOT NULL,
  pdf_storage_key           varchar(500),
  pdf_sha256                char(64),
  pdf_bytes                 integer,
  pdf_page_count            integer,

  status                    varchar(20) NOT NULL DEFAULT 'pending',
  error_message             text,

  created_at                timestamp NOT NULL DEFAULT now(),
  created_by                varchar(100),

  CONSTRAINT concierge_profiles_status_check
    CHECK (status IN ('pending', 'retrieved', 'generated', 'failed')),

  -- A completed report must have an artifact. A failed one must not pretend to.
  CONSTRAINT concierge_profiles_generated_has_pdf
    CHECK (status <> 'generated' OR (pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CONSTRAINT concierge_profiles_failed_has_reason
    CHECK (status <> 'failed' OR error_message IS NOT NULL),

  -- Counts must be internally consistent: you cannot show more than qualified,
  -- nor qualify more than were returned.
  CONSTRAINT concierge_profiles_counts_sane
    CHECK (comps_shown <= comps_qualified AND comps_qualified <= comps_returned)
);

CREATE INDEX IF NOT EXISTS concierge_profiles_order_idx    ON concierge_profiles (order_id);
CREATE INDEX IF NOT EXISTS concierge_profiles_created_idx  ON concierge_profiles (created_at DESC);
CREATE INDEX IF NOT EXISTS concierge_profiles_apn_idx      ON concierge_profiles (subject_apn);
CREATE INDEX IF NOT EXISTS concierge_profiles_searchid_idx ON concierge_profiles (sitex_search_id);
CREATE INDEX IF NOT EXISTS concierge_profiles_status_idx   ON concierge_profiles (status)
  WHERE status IN ('pending', 'failed');


-- ── 2. Every comparable SiteX returned — selected or not ────────────────────
-- The exclusion reason is the point: it is what makes a challenged comparable
-- defensible six months later.

CREATE TABLE IF NOT EXISTS concierge_profile_comps (
  id                serial PRIMARY KEY,
  profile_id        integer NOT NULL REFERENCES concierge_profiles(id) ON DELETE CASCADE,

  -- Order as returned by SiteX, so the original set can be reconstructed.
  source_position   integer NOT NULL,

  selected          boolean NOT NULL DEFAULT false,
  -- NULL when selected; otherwise which rule rejected it.
  exclusion_reason  varchar(40),
  -- Rank among SELECTED comps, as printed. NULL when not selected.
  display_position  integer,

  address           varchar(500),
  city              varchar(100),
  state             varchar(10),
  zip               varchar(20),
  apn               varchar(50),

  sale_price        numeric(12,2),
  -- Use SiteX's own PricePerSQFT. Do NOT recompute from BuildingArea.
  price_per_sqft    numeric(10,2),
  recording_date    date,
  document_number   varchar(50),
  document_type     varchar(100),

  building_area     integer,
  bedrooms          integer,
  baths             numeric(4,1),
  year_built        integer,
  lot_size          integer,
  use_description   varchar(200),

  proximity_miles   numeric(6,3),
  latitude          numeric(10,6),
  longitude         numeric(10,6),

  raw               jsonb NOT NULL,

  CONSTRAINT concierge_comps_exclusion_shape
    CHECK ((selected AND exclusion_reason IS NULL AND display_position IS NOT NULL)
        OR (NOT selected AND exclusion_reason IS NOT NULL AND display_position IS NULL))
);

CREATE INDEX IF NOT EXISTS concierge_comps_profile_idx ON concierge_profile_comps (profile_id, source_position);
CREATE INDEX IF NOT EXISTS concierge_comps_selected_idx ON concierge_profile_comps (profile_id, display_position)
  WHERE selected;


-- ── 3. Transfer history, normalized ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concierge_profile_transfers (
  id                  serial PRIMARY KEY,
  profile_id          integer NOT NULL REFERENCES concierge_profiles(id) ON DELETE CASCADE,
  source_position     integer NOT NULL,

  transaction_type    varchar(60),
  document_type       varchar(100),
  recording_date      date,
  contract_date       date,
  document_number     varchar(50),
  book_number         varchar(30),
  page_number         varchar(30),
  current_owner_flag  boolean,
  is_foreclosure      boolean,

  raw                 jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS concierge_transfers_profile_idx
  ON concierge_profile_transfers (profile_id, recording_date DESC);


-- ── VERIFICATION ────────────────────────────────────────────────────────────
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name LIKE 'concierge_%';
--   -- expect 3 rows
--
--   SELECT conname FROM pg_constraint
--    WHERE conname LIKE 'concierge_%';
--   -- expect 6 (status, generated_has_pdf, failed_has_reason, counts_sane,
--   --           exclusion_shape, + PK/FK names vary)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='concierge_profiles' AND column_name LIKE 'platmap%';
--   -- expect 4 rows
--
--   SELECT data_type FROM information_schema.columns
--    WHERE table_name='concierge_profiles' AND column_name='comp_map_url';
--   -- expect 'text' (NOT character varying)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='concierge_profiles' AND column_name LIKE 'comp_map%';
--   -- expect 3 rows (url, storage_key, sha256)
--
--   SELECT count(*) FROM concierge_profiles;   -- expect 0


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Safe while no concierge code is deployed. Children cascade from the parent,
-- but drop explicitly so the intent is visible.
--
--   DROP TABLE IF EXISTS concierge_profile_transfers;
--   DROP TABLE IF EXISTS concierge_profile_comps;
--   DROP TABLE IF EXISTS concierge_profiles;
