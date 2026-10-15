-- Keep MyNHD's PDF, and record what we rasterised it at.
--
-- The hazard preview now comes from MyNHD's /pdf endpoint rather than /image:
-- their PNG is 1024px wide, which is 140 dpi across the document's 528pt
-- content width and leaves their disclaimer type at about 5pt and blurred.
-- The PDF has vector text, so we redraw it at 300 dpi ourselves.
--
-- hazard_pdf_storage_key is the vendor's own bytes, archived unchanged before
-- anything transforms them — the same rule the raw SiteX payload follows. If
-- the rasteriser is wrong, or a later version wants a different resolution,
-- the source is already here and no second vendor call is needed.
--
-- hazard_dpi records what the stored PNG was drawn at, so "is this sheet
-- print quality?" is answerable from the row instead of inferred from the
-- pixel count and an assumption about the page size.
--
-- Purely additive: two nullable columns, no index, no constraint, nothing
-- renamed or dropped. Existing rows read exactly as they do today.
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_pdf_storage_key varchar(500);
ALTER TABLE concierge_profiles
  ADD COLUMN IF NOT EXISTS hazard_dpi integer;
