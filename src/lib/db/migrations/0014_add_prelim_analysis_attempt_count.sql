ALTER TABLE prelim_analyses
ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
