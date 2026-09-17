-- 0057 — the three farming report types.
--
-- WHY THREE TABLES AND NOT ONE
--   The list page unions four types and prints Subject and Settings per row.
--   Those differ per type — an area and a window, a route ranking, a county and
--   a month — and a single table would carry three sets of half-null columns
--   plus a discriminator nobody can constrain. The shared columns are repeated
--   deliberately; the union is a view concern, not a storage one.
--
-- WHAT IS STORED, AND WHY THE NUMBERS AND NOT THE ROWS
--   The dataset is stored as the uploaded file (S3 key + hash + row counts),
--   and the REPORT is stored as the computed figures. A re-render therefore
--   costs nothing and cannot change, the same property the concierge profile
--   has: the document and the database can never drift because the document is
--   rendered from the stored numbers.
--
-- ABSENCES AND REJECTS ARE RECORDED
--   dataset_rows / dataset_used / dataset_rejected, and rejected_types as a
--   count per unrecognised value. Legacy lowercased and kept only 'rsfr' and
--   'rcon', so Condo and SFR were silently dropped while RCON and RSFR worked,
--   and the subtitle promised new homes no column could hold. An unrecognised
--   property type is REPORTED, never discarded in silence.
--
-- MEDIANS
--   Every price figure in these reports is a true median, computed from
--   per-sale rows — including price per square foot, which is the median of
--   each home's own rate, never a ratio of two sums. Legacy's County report
--   labelled a column Median and computed array_sum / count. The label was
--   right, so the maths changed. The CSVs have been per-sale all along.
--
-- BRANDING
--   branded_to_* is snapshotted at generation. The rep's name, title, phone and
--   photo are printed on every page, and a rep who later changes title must not
--   change a report already handed across a table.
--
-- RLS
--   Enabled in the same migration as the CREATE, per 0038/0040.

-- ── 1. Sales Activity ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_activity_reports (
  id                    serial PRIMARY KEY,

  -- Subject column on the list: the place, then what qualifies it.
  area_name             varchar(200) NOT NULL,
  property_type         varchar(40),                   -- null = all types

  -- Settings column: a REAL date range. Legacy matched month-number regardless
  -- of year, so a 12-month run ignored the year entirely.
  window_months         integer NOT NULL,
  window_start          date NOT NULL,
  window_end            date NOT NULL,

  -- Branded To, snapshotted.
  branded_to_contact_id integer REFERENCES contacts(id) ON DELETE SET NULL,
  branded_to_name       varchar(200) NOT NULL,
  branded_to_title      varchar(120),
  branded_to_email      varchar(200),
  branded_to_phone      varchar(50),
  branded_to_photo_key  varchar(500),

  -- Provenance of the dataset this was computed from.
  dataset_source        varchar(20) NOT NULL DEFAULT 'csv_upload',
  dataset_storage_key   varchar(500),
  dataset_sha256        char(64),
  dataset_rows          integer NOT NULL DEFAULT 0,
  dataset_used          integer NOT NULL DEFAULT 0,
  dataset_rejected      integer NOT NULL DEFAULT 0,
  rejected_types        jsonb,                         -- {"Land": 4, "": 2}

  -- The six tiles, and the month-by-month table, as rendered.
  metrics               jsonb,
  months                jsonb,

  template_version      varchar(20) NOT NULL,
  pdf_storage_key       varchar(500),
  pdf_sha256            char(64),
  pdf_bytes             integer,
  pdf_page_count        integer,

  status                varchar(20) NOT NULL DEFAULT 'pending',
  error_message         text,
  created_at            timestamp NOT NULL DEFAULT now(),
  created_by            varchar(100),

  CONSTRAINT sales_activity_status_check
    CHECK (status IN ('pending', 'generated', 'failed')),
  CONSTRAINT sales_activity_generated_has_pdf
    CHECK (status <> 'generated' OR (pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CONSTRAINT sales_activity_failed_has_reason
    CHECK (status <> 'failed' OR error_message IS NOT NULL),
  CONSTRAINT sales_activity_window_sane
    CHECK (window_end >= window_start)
);

CREATE INDEX IF NOT EXISTS sales_activity_created_idx ON sales_activity_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS sales_activity_branded_idx ON sales_activity_reports (branded_to_contact_id);

-- ── 2. Carrier Route Analysis ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carrier_route_reports (
  id                    serial PRIMARY KEY,

  area_name             varchar(200) NOT NULL,
  -- Settings column. One of the six the modal offers.
  rank_by               varchar(30) NOT NULL,

  branded_to_contact_id integer REFERENCES contacts(id) ON DELETE SET NULL,
  branded_to_name       varchar(200) NOT NULL,
  branded_to_title      varchar(120),
  branded_to_email      varchar(200),
  branded_to_phone      varchar(50),
  branded_to_photo_key  varchar(500),

  dataset_source        varchar(20) NOT NULL DEFAULT 'csv_upload',
  dataset_storage_key   varchar(500),
  dataset_sha256        char(64),
  dataset_rows          integer NOT NULL DEFAULT 0,
  dataset_used          integer NOT NULL DEFAULT 0,
  dataset_rejected      integer NOT NULL DEFAULT 0,
  rejected_types        jsonb,

  -- Each standout is computed from ITS OWN field. Legacy's "Highest Non-Owner"
  -- tile printed the turnover winner's route beside the non-owner percentage.
  standouts             jsonb,
  -- The ten shown, ranked by rank_by. Standouts are the best of these ten, not
  -- of the whole file, and the page says so.
  routes                jsonb,

  template_version      varchar(20) NOT NULL,
  pdf_storage_key       varchar(500),
  pdf_sha256            char(64),
  pdf_bytes             integer,
  pdf_page_count        integer,

  status                varchar(20) NOT NULL DEFAULT 'pending',
  error_message         text,
  created_at            timestamp NOT NULL DEFAULT now(),
  created_by            varchar(100),

  CONSTRAINT carrier_route_status_check
    CHECK (status IN ('pending', 'generated', 'failed')),
  CONSTRAINT carrier_route_generated_has_pdf
    CHECK (status <> 'generated' OR (pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CONSTRAINT carrier_route_failed_has_reason
    CHECK (status <> 'failed' OR error_message IS NOT NULL),
  CONSTRAINT carrier_route_rank_by_check
    CHECK (rank_by IN ('turnover', 'non_owner', 'units', 'sales', 'price', 'years_held'))
);

CREATE INDEX IF NOT EXISTS carrier_route_created_idx ON carrier_route_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS carrier_route_branded_idx ON carrier_route_reports (branded_to_contact_id);

-- ── 3. County Sales ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS county_sales_reports (
  id                    serial PRIMARY KEY,

  county                varchar(60) NOT NULL,
  -- The month reported, as a real date (first of the month), not a month number.
  month                 date NOT NULL,

  branded_to_contact_id integer REFERENCES contacts(id) ON DELETE SET NULL,
  branded_to_name       varchar(200) NOT NULL,
  branded_to_title      varchar(120),
  branded_to_email      varchar(200),
  branded_to_phone      varchar(50),
  branded_to_photo_key  varchar(500),

  dataset_source        varchar(20) NOT NULL DEFAULT 'csv_upload',
  dataset_storage_key   varchar(500),
  dataset_sha256        char(64),
  dataset_rows          integer NOT NULL DEFAULT 0,
  dataset_used          integer NOT NULL DEFAULT 0,
  dataset_rejected      integer NOT NULL DEFAULT 0,
  rejected_types        jsonb,

  -- One entry per city: houses sold + median, condos sold + median. A city with
  -- no condo sales carries a null median and the document prints an em dash —
  -- never a zero.
  cities                jsonb,
  -- The county total row, computed from the per-sale rows, not from the city
  -- figures: a median of medians is not a median.
  totals                jsonb,

  template_version      varchar(20) NOT NULL,
  pdf_storage_key       varchar(500),
  pdf_sha256            char(64),
  pdf_bytes             integer,
  pdf_page_count        integer,

  status                varchar(20) NOT NULL DEFAULT 'pending',
  error_message         text,
  created_at            timestamp NOT NULL DEFAULT now(),
  created_by            varchar(100),

  CONSTRAINT county_sales_status_check
    CHECK (status IN ('pending', 'generated', 'failed')),
  CONSTRAINT county_sales_generated_has_pdf
    CHECK (status <> 'generated' OR (pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL)),
  CONSTRAINT county_sales_failed_has_reason
    CHECK (status <> 'failed' OR error_message IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS county_sales_created_idx ON county_sales_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS county_sales_branded_idx ON county_sales_reports (branded_to_contact_id);

ALTER TABLE public.sales_activity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_route_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.county_sales_reports   ENABLE ROW LEVEL SECURITY;

-- VERIFY
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('sales_activity_reports','carrier_route_reports','county_sales_reports');
--   -- 3 rows, all true
--   SELECT count(*) FROM sales_activity_reports;  -- 0
