-- 0053 — orders.contacts_read_at: when SoftPro last RETURNED this order's contacts.
--
-- WHY
--   Since 2026-08-31 most orders are created in the hub (source = manual_entry)
--   rather than synced from SoftPro. softpro.enrich_orders only picks an order
--   that is missing something — no party rows, no client contact, or none of the
--   four company FKs — and a hub-created order is born with a client contact, an
--   underwriter and buyer/seller rows. So it never qualified: on 2026-09-16, 482
--   orders (465 active) had never had their SoftPro contacts read, and 48 of the
--   60 most recent confirmed orders carried no escrow company at all.
--
--   The fix selects orders whose contacts have never been read. That needs a
--   column that means "read", not "attempted": last_contacts_fetch_at is stamped
--   BEFORE the vendor call, so an order whose first read times out would look
--   fetched and never be selected again. contacts_read_at is written only when
--   GetOrderContacts returns data. last_contacts_fetch_at keeps its job as the
--   retry cooldown.
--
-- BACKFILL
--   Every order already attempted under the old selector is treated as read, so
--   this migration does not queue a re-read of the ~8,300 synced orders — those
--   are the weekly drift check's job, not this one's. After the backfill the new
--   arm selects exactly the orders never attempted (482 when measured).
--   updated_at is not touched.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS contacts_read_at timestamp;

UPDATE orders
   SET contacts_read_at = last_contacts_fetch_at
 WHERE contacts_read_at IS NULL
   AND last_contacts_fetch_at IS NOT NULL;

-- VERIFY
--   SELECT count(*) FROM orders WHERE contacts_read_at IS NULL;                 -- never read
--   SELECT count(*) FROM orders WHERE last_contacts_fetch_at IS NULL;           -- same number
