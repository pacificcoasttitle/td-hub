ALTER TYPE "doc_action" ADD VALUE IF NOT EXISTS 'delivered';

ALTER TABLE "order_notes"
  ADD COLUMN IF NOT EXISTS "synced_at" timestamp;
