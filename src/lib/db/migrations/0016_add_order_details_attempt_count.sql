ALTER TABLE orders
ADD COLUMN IF NOT EXISTS details_attempt_count integer NOT NULL DEFAULT 0;
