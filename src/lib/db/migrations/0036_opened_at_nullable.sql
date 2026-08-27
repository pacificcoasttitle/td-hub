-- orders.opened_at: stop fabricating a date the vendor never gave us.
--
-- The column was `timestamp not null default now()`. SoftPro's GetOrders carries
-- no open date, so every row inserted from that path claimed to have opened at
-- the exact moment we happened to write it. That is not "unknown" - it is a
-- false statement, and it propagated further than the column:
--
--   * it blinded the prelim backfill gate, which measures how far a row's
--     creation trails its open date. A fabricated date gives a lag of zero, so a
--     14-month-old order read as opened today and its prelim was eligible to be
--     auto-mailed to an escrow officer.
--   * it moved rows into the party wizard's 3-7 day eligibility window, which
--     emails external escrow officers.
--   * it corrupted every latency figure measured from this column, and the CRM's
--     recency and "gone quiet" signals, where a fake recent date makes a dormant
--     client read as active.
--
-- 174 rows carried a fabricated value when this shipped; they are left as they
-- are rather than guessed at a second time. Going forward the three insert paths
-- write the real ReceivedDate or NULL, and enrich_order_details fills it in when
-- the vendor later supplies one.
--
-- Safe and backwards compatible: dropping NOT NULL and the default cannot fail
-- on existing rows and cannot orphan any reader. It MUST be applied before the
-- code that writes NULL, or those inserts violate the constraint.

ALTER TABLE orders ALTER COLUMN opened_at DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN opened_at DROP DEFAULT;

COMMENT ON COLUMN orders.opened_at IS
  'When the order opened, per SoftPro ReceivedDate. NULL when the vendor has not told us. Never defaulted to now() - a fabricated open date blinds the prelim backfill gate and skews CRM recency.';
