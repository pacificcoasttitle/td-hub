-- Throttle SiteX property backfill (apn / legal / property_type) for SoftPro-synced orders.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS last_sitex_fetch_at timestamp without time zone;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS sitex_attempt_count integer NOT NULL DEFAULT 0;
