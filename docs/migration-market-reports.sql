-- Migration: market_intelligence_phase_a
-- Date: 2026-08-24
-- Purpose: the shared persistence layer for the PCT Market Intelligence report
--          system — enough stored to REGENERATE and DEFEND any report months
--          after it was emailed to a client.
--
-- APPLY BEFORE DEPLOYING THE CODE. Three tables, no enum changes, no ALTER TYPE.
--
-- ═══ WHY THIS IS SHAPED THIS WAY ════════════════════════════════════════════
--
-- LEGACY STORES A FILENAME AND A FEW DROPDOWN VALUES. Per the source audit
-- (§7), across all three products there is no source snapshot, no file hash,
-- no row counts, no calculation version, no template version, no report date
-- range, no rep-branding snapshot and no delivery history. Farm Analysis goes
-- further and DELETES its imported rows before the PDF is even rendered. A
-- report generated today cannot be reproduced tomorrow. Every column below
-- exists to make one of those questions answerable.
--
-- THE DATASET IS SEPARATE FROM THE RUN, and it is called a dataset rather than
-- an upload on purpose. v1 ingests a CSV; the destination is SiteX farm
-- retrieval. Those differ ONLY in how the rows arrived, so `origin` plus two
-- nullable column groups covers both and the run table never learns the
-- difference. This mirrors the config panel, where only the source region
-- changes between the two.
--
-- PROPERTY TYPE IS ONE COLUMN, NOT TWO. The audit's most serious defect (§4)
-- is that the selected property type is a LABEL ONLY — a PDF headed "Total
-- Condo Sales" can contain every property type in the file. There is
-- deliberately no separate label column here. `property_class` is the filter
-- and the heading; they cannot disagree because they are the same value.
--
-- PERIODS ARE REAL DATES. Legacy compares the two-digit month and ignores the
-- year, so a multi-year CSV mixes every January together. period_start and
-- period_end are dates, NOT NULL, and checked for order.
--
-- OWNER-OCCUPANCY IS THREE-STATE. Legacy treats `owner_occupied` as absentee
-- only when the lowercased value is exactly 'n', so "No", "false", "0" and
-- blank all silently count as owner-occupied. `owner_occupied boolean NULL`
-- makes "we do not know" representable, and the absentee calculation excludes
-- unknowns from its denominator instead of guessing.
--
-- EVERY ACCEPTED ROW IS KEPT, and the rejected ones are counted and sampled.
-- That is what lets someone ask "why is Glendale missing" and get an answer.
--
-- DELIVERY RECORDS WHO THE SERVER RESOLVED, NOT WHO THE BROWSER ASKED FOR.
-- Legacy posts the recipient address and the S3 attachment URL from the page,
-- so anyone can email any S3 URL to anyone under PCT branding, and every send
-- is CC'd to a hard-coded yopmail.com disposable address. recipient_source is
-- constrained to values the server can derive on its own; there is no value
-- meaning "the browser told us".
--
-- A FAILED RUN IS A ROW, NOT A GAP. status='failed' carries a reason and no
-- PDF. A run that produced nothing must never silently vanish.
--
-- TIMESTAMPS are `timestamp` (no time zone), matching every existing column in
-- this database. MONEY is numeric(12,2), matching orders.sales_price.
-- profiles.id is varchar(64); contacts.id is integer.


-- ── 1. The dataset a report was calculated from ─────────────────────────────
--
-- One row per ingested dataset. Immutable once accepted: a correction is a new
-- dataset, never an edit, because runs point at this row as their evidence.

CREATE TABLE IF NOT EXISTS market_report_datasets (
  id                    serial PRIMARY KEY,

  -- Which report schema was applied when parsing. The same bytes parsed under
  -- a different schema are a different dataset.
  report_type           varchar(32) NOT NULL,
  schema_version        varchar(20) NOT NULL,

  -- ── how the rows arrived ──────────────────────────────────────────────────
  origin                varchar(20) NOT NULL,

  -- csv_upload only
  original_filename     varchar(255),
  source_sha256         char(64),
  source_bytes          integer,
  -- The raw file exactly as received. Immutable key; never overwritten.
  source_storage_key    varchar(500),

  -- sitex_farm only — the request that produced the rows, so the same
  -- retrieval can be replayed and compared.
  retrieval_request     jsonb,
  retrieval_reference   varchar(100),

  -- ── what the parser saw ───────────────────────────────────────────────────
  -- Verbatim headers, in file order, before any normalization. Legacy matches
  -- header names exactly and fails opaquely; keeping the originals is how a
  -- rejected upload gets explained to the person who uploaded it.
  detected_headers      jsonb,

  rows_total            integer NOT NULL DEFAULT 0,
  rows_accepted         integer NOT NULL DEFAULT 0,
  rows_rejected         integer NOT NULL DEFAULT 0,
  -- A capped sample of rejections: [{row, column, value, reason}]. Capped
  -- because a wrong-file upload can reject every row and the point is to show
  -- the user the shape of the problem, not to mirror the file.
  rejections            jsonb,
  warnings              jsonb,

  -- The vintage of the underlying data, which is NOT the upload date. Legacy
  -- prints no data-as-of anywhere, so a report says nothing about how stale it
  -- is. Nullable because a CSV may not disclose it.
  data_as_of            date,

  status                varchar(20) NOT NULL DEFAULT 'pending',
  error_message         text,

  created_at            timestamp NOT NULL DEFAULT now(),
  created_by            varchar(64) REFERENCES profiles(id),

  CONSTRAINT market_report_datasets_origin_check
    CHECK (origin IN ('csv_upload', 'sitex_farm')),
  CONSTRAINT market_report_datasets_type_check
    CHECK (report_type IN ('county_sales', 'sales_activity', 'carrier_route')),
  CONSTRAINT market_report_datasets_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected')),

  -- An upload must be able to prove which bytes it was. A retrieval must be
  -- able to prove which request it was. Neither can be blank.
  CONSTRAINT market_report_datasets_upload_has_file
    CHECK (origin <> 'csv_upload'
           OR (source_sha256 IS NOT NULL AND source_storage_key IS NOT NULL)),
  CONSTRAINT market_report_datasets_retrieval_has_request
    CHECK (origin <> 'sitex_farm' OR retrieval_request IS NOT NULL),

  CONSTRAINT market_report_datasets_rejected_has_reason
    CHECK (status <> 'rejected' OR error_message IS NOT NULL),

  -- Row counts must add up. If they do not, the parser lost rows and nobody
  -- would otherwise notice.
  CONSTRAINT market_report_datasets_counts_sane
    CHECK (rows_total >= 0 AND rows_accepted >= 0 AND rows_rejected >= 0
           AND rows_accepted + rows_rejected = rows_total),

  CONSTRAINT market_report_datasets_bytes_sane
    CHECK (source_bytes IS NULL OR source_bytes > 0),
  CONSTRAINT market_report_datasets_sha_lower
    CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$')
);

-- Deliberately NOT unique. The same file legitimately arrives twice, and
-- deduplication is a product decision. The index exists so the UI can find and
-- offer a prior identical upload rather than the schema forbidding one.
CREATE INDEX IF NOT EXISTS market_report_datasets_sha_idx
  ON market_report_datasets (source_sha256);
CREATE INDEX IF NOT EXISTS market_report_datasets_created_idx
  ON market_report_datasets (created_at DESC);
CREATE INDEX IF NOT EXISTS market_report_datasets_type_idx
  ON market_report_datasets (report_type, status);


-- ── 2. Normalized property-sale rows ────────────────────────────────────────
--
-- One row per ACCEPTED source row. Kept, not deleted: Farm Analysis deletes
-- its imported rows immediately after ranking them, which is why no legacy
-- report can be audited.
--
-- Every numeric column here has already been parsed and validated. Legacy does
-- arithmetic directly on CSV strings — "$450,000" and "" both enter a sum.
-- `raw` keeps the original row so a parsing decision can always be re-examined.
--
-- Carrier Route needs a different grain (one row per route, not per property)
-- and is NOT defined here. Its rebuilt shape adds opportunity scoring and
-- minimum-volume rules that will change what is worth storing, and guessing
-- that now is the same forward-copying this whole rebuild exists to stop. It
-- gets its own small migration when that report is built.

CREATE TABLE IF NOT EXISTS market_sale_records (
  id                    bigserial PRIMARY KEY,
  dataset_id            integer NOT NULL
                          REFERENCES market_report_datasets(id) ON DELETE CASCADE,
  -- 1-based position in the source file, so a row in the report can be pointed
  -- back at a line in the CSV the client sent us.
  row_number            integer NOT NULL,

  -- ── geography ─────────────────────────────────────────────────────────────
  -- site_city is the normalized grouping key (trimmed, case-folded for
  -- comparison); site_city_raw is what the file actually said. Legacy groups on
  -- the exact string, so "Glendale", "glendale " and "GLENDALE" become three
  -- separate cities in the same table.
  site_city             varchar(120),
  site_city_raw         varchar(200),
  site_zip              varchar(20),
  county_name           varchar(120),
  county_fips           varchar(10),
  carrier_route         varchar(20),
  apn                   varchar(50),
  latitude              numeric(10,6),
  longitude             numeric(10,6),

  -- ── classification ────────────────────────────────────────────────────────
  use_code              varchar(20),
  use_code_description  varchar(200),
  -- The normalized class the report filters on. 'unknown' is a real, expected
  -- value and must stay visible: legacy silently drops anything that is not
  -- exactly 'rsfr' or 'rcon' from its totals, so the printed count is smaller
  -- than the file and nothing says so.
  property_class        varchar(20) NOT NULL DEFAULT 'unknown',

  -- ── the transaction ───────────────────────────────────────────────────────
  sale_price            numeric(12,2),
  sale_date             date,
  sale_type             varchar(40),
  document_number       varchar(60),

  -- ── characteristics ───────────────────────────────────────────────────────
  bedrooms              numeric(5,1),
  baths                 numeric(5,1),
  building_area         integer,
  lot_area              integer,
  year_built            integer,

  -- ── occupancy ─────────────────────────────────────────────────────────────
  -- NULL means unknown and is excluded from the absentee denominator. See the
  -- header note: legacy's exact-'n' test makes every unknown an owner.
  owner_occupied        boolean,

  -- The original row, verbatim, keyed by original header.
  raw                   jsonb NOT NULL,

  created_at            timestamp NOT NULL DEFAULT now(),

  CONSTRAINT market_sale_records_class_check
    CHECK (property_class IN ('sfr', 'condo', 'multi_2_4', 'multi_5_plus',
                              'land', 'commercial', 'other', 'unknown')),
  -- A row is stored once per source line. Re-ingesting is a new dataset.
  CONSTRAINT market_sale_records_row_unique UNIQUE (dataset_id, row_number),
  CONSTRAINT market_sale_records_row_positive CHECK (row_number > 0),

  -- Zero and negative are not the same as absent. A $0 sale price is a real
  -- non-arms-length recording and must not enter an average; it is stored as
  -- 0 and excluded by the calculation, not stored as NULL.
  CONSTRAINT market_sale_records_price_sane
    CHECK (sale_price IS NULL OR sale_price >= 0),
  CONSTRAINT market_sale_records_area_sane
    CHECK ((building_area IS NULL OR building_area >= 0)
           AND (lot_area IS NULL OR lot_area >= 0)),
  CONSTRAINT market_sale_records_rooms_sane
    CHECK ((bedrooms IS NULL OR bedrooms >= 0) AND (baths IS NULL OR baths >= 0)),
  CONSTRAINT market_sale_records_year_sane
    CHECK (year_built IS NULL OR (year_built BETWEEN 1600 AND 2200))
);

CREATE INDEX IF NOT EXISTS market_sale_records_dataset_idx
  ON market_sale_records (dataset_id);
-- The shape every calculation filters on: dataset, then class, then date.
CREATE INDEX IF NOT EXISTS market_sale_records_filter_idx
  ON market_sale_records (dataset_id, property_class, sale_date);
CREATE INDEX IF NOT EXISTS market_sale_records_city_idx
  ON market_sale_records (dataset_id, site_city);


-- ── 3. One row per report run ───────────────────────────────────────────────
--
-- The run holds what was ASKED FOR (criteria_*, period_*, property_class) and
-- what HAPPENED (records_*, metrics, the artifact). Those are never derived
-- from each other. If they disagree it is visible in the row rather than the
-- report inventing a filter it never applied.

CREATE TABLE IF NOT EXISTS market_report_runs (
  id                    serial PRIMARY KEY,

  -- The handle used in URLs and in delivery. Opaque so a report cannot be
  -- found by counting, and stable so a link in an email keeps working.
  public_id             uuid NOT NULL DEFAULT gen_random_uuid(),

  report_type           varchar(32) NOT NULL,
  -- RESTRICT, not SET NULL, and this was found by trying it. SET NULL blanks
  -- dataset_id, which immediately violates market_report_runs_upload_has_dataset
  -- below — so the delete failed anyway, with an error about a CHECK constraint
  -- that says nothing about the real problem. RESTRICT says the true thing: a
  -- dataset that a report was calculated from cannot be deleted while that
  -- report exists. Orphaning the evidence is precisely the failure this schema
  -- is here to prevent. A dataset nothing cites still deletes, and takes its
  -- rows with it.
  dataset_id            integer REFERENCES market_report_datasets(id) ON DELETE RESTRICT,

  -- Mirrors the dataset's origin so a run can be understood without joining,
  -- and so the value survives the dataset being removed.
  data_source           varchar(20) NOT NULL,

  -- ── the four-stage pipeline ───────────────────────────────────────────────
  -- resolving -> retrieving -> validating -> publishing -> generated | failed.
  -- The stage is stored, not just the outcome: these runs take long enough
  -- that the UI shows progress, and a run that died needs to say where.
  status                varchar(20) NOT NULL DEFAULT 'queued',
  stage_started_at      timestamp,

  -- ── criteria, exactly as applied ──────────────────────────────────────────
  area_label            varchar(200) NOT NULL,
  county_fips           varchar(10),
  county_name           varchar(120),
  -- NULL = every city in the dataset. A list = exactly these, and the report
  -- says so.
  cities                jsonb,

  -- Real dates, both required. Not a month number, not a "3/6/12" enum: the
  -- duration choice configures these, and the report prints them.
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  -- The immediately preceding equal-length window, when one exists. NULL means
  -- no baseline was available and the report shows no change figure rather
  -- than printing 0%.
  compare_start         date,
  compare_end           date,

  -- THE FILTER AND THE HEADING, one column. NULL = all classes, and the
  -- heading then reads "All property types". See the header note.
  property_class        varchar(20),

  -- Anything else the config panel collects. Named criteria get columns; this
  -- is for knobs that are still moving.
  criteria_extra        jsonb,

  -- ── provenance ────────────────────────────────────────────────────────────
  data_as_of            date,
  calculation_version   varchar(20) NOT NULL,
  template_version      varchar(20) NOT NULL,
  renderer_version      varchar(40),

  -- ── what actually happened ────────────────────────────────────────────────
  -- considered = rows in the dataset; matched = rows that passed every
  -- criterion and fed the numbers on the page.
  records_considered    integer NOT NULL DEFAULT 0,
  records_matched       integer NOT NULL DEFAULT 0,
  -- Computed figures, stored so the PDF and the database cannot drift.
  metrics               jsonb,
  warnings              jsonb,

  -- ── the representative, snapshotted AS OF GENERATION ──────────────────────
  -- Reps change title, phone, and employer. A report reprinted in a year must
  -- show what it showed when it was sent.
  rep_contact_id        integer REFERENCES contacts(id) ON DELETE SET NULL,
  rep_snapshot          jsonb,

  -- Who it was prepared for, when that is someone other than the rep.
  prepared_for_name     varchar(200),
  prepared_for_company  varchar(200),

  -- ── the artifact ──────────────────────────────────────────────────────────
  pdf_storage_key       varchar(500),
  pdf_sha256            char(64),
  pdf_bytes             integer,
  pdf_page_count        integer,

  error_message         text,

  created_at            timestamp NOT NULL DEFAULT now(),
  completed_at          timestamp,
  created_by            varchar(64) REFERENCES profiles(id),

  CONSTRAINT market_report_runs_public_id_unique UNIQUE (public_id),
  CONSTRAINT market_report_runs_type_check
    CHECK (report_type IN ('county_sales', 'sales_activity', 'carrier_route')),
  CONSTRAINT market_report_runs_source_check
    CHECK (data_source IN ('csv_upload', 'sitex_farm')),
  CONSTRAINT market_report_runs_status_check
    CHECK (status IN ('queued', 'resolving', 'retrieving', 'validating',
                      'publishing', 'generated', 'failed', 'canceled')),
  CONSTRAINT market_report_runs_class_check
    CHECK (property_class IS NULL
           OR property_class IN ('sfr', 'condo', 'multi_2_4', 'multi_5_plus',
                                 'land', 'commercial', 'other')),

  -- A finished report must have an artifact; a failed one must not pretend to.
  CONSTRAINT market_report_runs_generated_has_pdf
    CHECK (status <> 'generated'
           OR (pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CONSTRAINT market_report_runs_failed_has_reason
    CHECK (status <> 'failed' OR error_message IS NOT NULL),
  CONSTRAINT market_report_runs_generated_has_completion
    CHECK (status NOT IN ('generated', 'failed') OR completed_at IS NOT NULL),

  -- A period must run forwards, and a comparison window must be complete and
  -- strictly before the reporting period.
  CONSTRAINT market_report_runs_period_order
    CHECK (period_end >= period_start),
  CONSTRAINT market_report_runs_compare_complete
    CHECK ((compare_start IS NULL) = (compare_end IS NULL)),
  CONSTRAINT market_report_runs_compare_order
    CHECK (compare_start IS NULL
           OR (compare_end >= compare_start AND compare_end < period_start)),

  -- You cannot match more rows than you considered.
  CONSTRAINT market_report_runs_counts_sane
    CHECK (records_considered >= 0 AND records_matched >= 0
           AND records_matched <= records_considered),

  -- A CSV-sourced run must name the dataset it came from. Without this a run
  -- can outlive its evidence and still claim to be reproducible.
  CONSTRAINT market_report_runs_upload_has_dataset
    CHECK (data_source <> 'csv_upload' OR dataset_id IS NOT NULL),

  CONSTRAINT market_report_runs_sha_lower
    CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS market_report_runs_created_idx
  ON market_report_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS market_report_runs_type_idx
  ON market_report_runs (report_type, created_at DESC);
CREATE INDEX IF NOT EXISTS market_report_runs_dataset_idx
  ON market_report_runs (dataset_id);
CREATE INDEX IF NOT EXISTS market_report_runs_rep_idx
  ON market_report_runs (rep_contact_id, created_at DESC);
-- The report library's "still running / needs attention" view.
CREATE INDEX IF NOT EXISTS market_report_runs_active_idx
  ON market_report_runs (status, created_at DESC)
  WHERE status NOT IN ('generated', 'canceled');


-- ── 4. Delivery events ──────────────────────────────────────────────────────
--
-- One row per send attempt. Legacy stores nothing: there is no record that a
-- report was emailed, to whom, or whether it arrived.
--
-- recipient_email is what the SERVER RESOLVED, recorded after the fact as
-- evidence. recipient_source says how it was derived, and every permitted
-- value is something the server can work out on its own from the run. There is
-- deliberately no value meaning "supplied by the browser" — the current
-- endpoint accepts a recipient and an S3 attachment URL straight from the
-- page, which lets anyone email any S3 object to any address under PCT
-- branding.

CREATE TABLE IF NOT EXISTS market_report_deliveries (
  id                    serial PRIMARY KEY,
  run_id                integer NOT NULL
                          REFERENCES market_report_runs(id) ON DELETE CASCADE,

  channel               varchar(20) NOT NULL DEFAULT 'email',
  recipient_email       varchar(320) NOT NULL,
  recipient_name        varchar(200),
  recipient_source      varchar(30) NOT NULL,

  subject               varchar(300),
  template_key          varchar(60),

  status                varchar(20) NOT NULL DEFAULT 'queued',
  provider              varchar(40),
  provider_message_id   varchar(200),
  error_message         text,

  requested_by          varchar(64) REFERENCES profiles(id),
  created_at            timestamp NOT NULL DEFAULT now(),
  sent_at               timestamp,

  CONSTRAINT market_report_deliveries_channel_check
    CHECK (channel IN ('email')),
  CONSTRAINT market_report_deliveries_status_check
    CHECK (status IN ('queued', 'sent', 'failed', 'bounced')),

  -- Every value here is server-derivable. Adding one that is not would need a
  -- migration, which is the point.
  CONSTRAINT market_report_deliveries_source_check
    CHECK (recipient_source IN ('rep_contact', 'requesting_user', 'prepared_for')),

  CONSTRAINT market_report_deliveries_sent_has_time
    CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT market_report_deliveries_failed_has_reason
    CHECK (status <> 'failed' OR error_message IS NOT NULL),
  CONSTRAINT market_report_deliveries_email_shape
    CHECK (position('@' IN recipient_email) > 1)
);

CREATE INDEX IF NOT EXISTS market_report_deliveries_run_idx
  ON market_report_deliveries (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_report_deliveries_status_idx
  ON market_report_deliveries (status, created_at DESC)
  WHERE status IN ('queued', 'failed');
