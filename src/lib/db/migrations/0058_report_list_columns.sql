-- 0058 — Subject and Settings, stored as text on every report row.
--
-- WHY STORED AND NOT DERIVED (Gerard, 2026-09-17)
--   The Reports list prints Subject (the place or property an agent recognises)
--   and Settings (the parameters that built it) for four report types that live
--   in four tables with four different column sets. Deriving them needs a
--   type-to-column mapping that every reader must share and every new type must
--   join; storing them makes the union the same columns from every table, and a
--   fifth report type a migration and nothing else.
--
--   It also cannot drift. These strings describe what was ACTUALLY generated —
--   the same reasoning as stamping template_version, so an old PDF stays tied to
--   the template that made it. A row in the list should say what the document
--   says.
--
--   The trade, accepted deliberately: stored strings cannot be reformatted
--   retroactively. If the wording of "6 months to August 2026" changes, old rows
--   keep the old phrasing — which is correct, because each row describes a
--   document that already exists and still reads that way.
--
-- THE RULE THAT COMES WITH IT
--   Whenever a document is REGENERATED with different parameters, these strings
--   are rewritten in the same statement that changes them. The concierge
--   criteria panel re-renders a profile with adjusted comparables; if Settings
--   were left alone there, the row would describe criteria the PDF no longer
--   uses. Stored does not mean written once — it means written with the thing
--   it describes.
--
-- NULLABLE, DELIBERATELY
--   A row is created before its document exists (status 'pending'), and a failed
--   generation may never learn its subject — a concierge address that resolved
--   to three locations has no property to name. The list renders an em dash for
--   an absent value, the way every other absence in this system is rendered.
--
-- branded_to stays a REFERENCE, not a copy: a rep's name can legitimately
--   change, and the list should follow it. The PDF's own footer is already
--   snapshotted separately on the farming tables.

ALTER TABLE concierge_profiles      ADD COLUMN IF NOT EXISTS list_subject        varchar(300);
ALTER TABLE concierge_profiles      ADD COLUMN IF NOT EXISTS list_subject_detail varchar(300);
ALTER TABLE concierge_profiles      ADD COLUMN IF NOT EXISTS list_settings       varchar(300);

ALTER TABLE sales_activity_reports  ADD COLUMN IF NOT EXISTS list_subject        varchar(300);
ALTER TABLE sales_activity_reports  ADD COLUMN IF NOT EXISTS list_subject_detail varchar(300);
ALTER TABLE sales_activity_reports  ADD COLUMN IF NOT EXISTS list_settings       varchar(300);

ALTER TABLE carrier_route_reports   ADD COLUMN IF NOT EXISTS list_subject        varchar(300);
ALTER TABLE carrier_route_reports   ADD COLUMN IF NOT EXISTS list_subject_detail varchar(300);
ALTER TABLE carrier_route_reports   ADD COLUMN IF NOT EXISTS list_settings       varchar(300);

ALTER TABLE county_sales_reports    ADD COLUMN IF NOT EXISTS list_subject        varchar(300);
ALTER TABLE county_sales_reports    ADD COLUMN IF NOT EXISTS list_subject_detail varchar(300);
ALTER TABLE county_sales_reports    ADD COLUMN IF NOT EXISTS list_settings       varchar(300);

-- VERIFY
--   SELECT table_name, count(*) FROM information_schema.columns
--    WHERE column_name LIKE 'list_%' GROUP BY 1;   -- four tables, 3 each
