-- FLAG: apply manually to prod (same process as 0024).
-- Adds 'hold' to operational_status so SoftPro "Hold" is a first-class status.
ALTER TYPE "public"."operational_status" ADD VALUE IF NOT EXISTS 'hold';
