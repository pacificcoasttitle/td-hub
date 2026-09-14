-- 0048 — The internal alert for a hub create that did not finish saving.
--
-- WHY
--   A hub create writes SoftPro first and the local order second. When the
--   local write throws, SoftPro has the file and the hub order has no property:
--   no address, no title search, no documents. Ten between 2026-09-09 and
--   2026-09-14. Each was found by the operator who hit it and reached Gerard as
--   a message. This row is the recipient list for the email that means the
--   system reports it instead.
--
-- recipient_roles = {internal} makes resolveRecipients read internal_cc, which
-- is editable in Admin → Notifications — changing who gets this must not need
-- a deploy. Seeded with two addresses already configured elsewhere, so none is
-- invented here:
--   ghernandez@pct.com   the ops daily report's recipient, and the internal CC
--                        on Request Updated Prelim
--   openorders@pct.com   the open order team, who press Finish saving; already
--                        the recipient of the outstanding-documents alert
--
-- The slug is also the dispatch event type (CREATE_FAILURE_ALERT_EVENT_TYPE in
-- src/lib/domain/orders/create-failure.ts) — mapEventToSlug falls through to
-- the event type, so the two must match or the alert resolves no recipients.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running cannot reset recipients an
-- operator has since edited.

INSERT INTO "notification_types"
  ("slug", "display_name", "description", "channels", "is_enabled", "recipient_roles", "internal_cc")
VALUES (
  'order.create.local_failed',
  'Hub Order Did Not Finish Saving',
  'SoftPro accepted a hub order and the hub''s own write failed, leaving the order without its property — no address, no title search, no documents. Fires once per failure with the recorded reason. Fix it with Finish saving on the order; never re-enter it.',
  '{email}',
  true,
  '{internal}',
  '{ghernandez@pct.com,openorders@pct.com}'
)
ON CONFLICT ("slug") DO NOTHING;
