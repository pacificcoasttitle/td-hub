ALTER TABLE prelim_analyses
ADD CONSTRAINT prelim_analyses_document_id_unique UNIQUE (document_id);
