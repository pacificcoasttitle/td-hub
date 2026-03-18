-- Migration: add_dup_override_and_email_status_to_orders
-- Date: 2026-03-17
-- Author: Director (Jerry Hernandez)
-- Purpose: Support duplicate override checkbox and email notification tracking on orders table
--
-- dup_override: When true, the open order form allows creating a new order
--               even if an existing order has the same property address/APN.
--               Toggled via admin Orders table checkbox.
--
-- email_status: Tracks whether the order confirmation email was sent.
--               Values: 'pending', 'sent', 'failed', 'skipped'
--
-- created_by:   References the user profile ID of whoever opened the order.
--               For orders created via the hub form, this is the open_order_team
--               member who submitted it. For SoftPro-synced orders, this is null.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS dup_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS email_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

-- Index for the duplicate check query (looks up orders by APN where override is false)
CREATE INDEX IF NOT EXISTS idx_orders_dup_check ON orders(dup_override) WHERE dup_override = FALSE;

-- Index for email status filtering in the admin orders table
CREATE INDEX IF NOT EXISTS idx_orders_email_status ON orders(email_status);
