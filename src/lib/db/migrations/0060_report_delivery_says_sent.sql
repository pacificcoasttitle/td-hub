-- 0060 — a delivery row says SENT, because sent is what we know.
--
-- WHY (Gerard, 2026-09-22)
--   report_deliveries.outcome allowed 'delivered' and 'failed', and Notify rep
--   was about to write 'delivered' the moment SendGrid accepted a message.
--   Accepted is not delivered: a message SendGrid accepts can still bounce, be
--   refused, or land in spam, and we would never hear of it. The list's
--   Delivery column would have said Delivered on evidence of Sent.
--
--   That is the defect County Sales had — a column saying Median over a mean —
--   in a different column. The label comes down to the evidence.
--
-- WHAT WOULD EARN 'delivered'
--   SendGrid's event webhook, which reports delivered, bounce, dropped and
--   spam-report per message. That is a real build — see
--   docs/tickets/REPORT_DELIVERY_IS_SENT_NOT_DELIVERED.md — and when it lands,
--   it widens this constraint again, deliberately, rather than a hopeful word
--   being written before there is anything behind it.
--
-- NO ROWS TO MOVE
--   Checked 2026-09-22: report_deliveries has no rows in production. The UPDATE
--   below is here so the migration is correct whatever it finds.

UPDATE report_deliveries SET outcome = 'sent' WHERE outcome = 'delivered';

ALTER TABLE report_deliveries DROP CONSTRAINT IF EXISTS report_deliveries_outcome_check;
ALTER TABLE report_deliveries ADD CONSTRAINT report_deliveries_outcome_check
  CHECK (outcome IN ('sent', 'failed'));

-- VERIFY
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'report_deliveries_outcome_check';
--   -- CHECK (outcome IN ('sent','failed'))
