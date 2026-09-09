-- 0046 — The internal alert that makes "we will send these separately" true.
--
-- WHY
--   The confirmation tells a customer that outstanding title documents will
--   follow separately. Nothing sent them. Not a cron, not a queue, not a
--   routine — 60 of 244 confirmations in 90 days went out with a promised
--   document missing and no follow-up existed anywhere.
--
--   This row is the recipient list for the alert that keeps the promise. It
--   fires when the document lands (median 1.0 minutes later), or after two
--   hours to report that it never came at all (13 of those 60).
--
-- recipient_roles = {internal} makes resolveRecipients read internal_cc, which
-- is editable in Admin → Notifications. Same shape as Request Updated Prelim:
-- changing who gets this must not require a deploy.
--
-- Seeded with openorders@pct.com, which is already CC'd on every confirmation,
-- so the people who would forward the document are already receiving the email
-- that went out without it. No new address is invented here.
--
-- The slug is also the dispatch event type — mapEventToSlug falls through to
-- the event type for anything it does not special-case, so the two must match.
-- It is an identifier, not copy; renaming it needs code and database moved
-- together or the alert silently resolves no recipients.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running cannot reset recipients an
-- operator has since edited.

INSERT INTO "notification_types"
  ("slug", "display_name", "description", "channels", "is_enabled", "recipient_roles", "internal_cc")
VALUES (
  'order.documents.outstanding',
  'Outstanding Documents — Send to Client',
  'The order confirmation went out without a title document the customer was promised. Fires when the document becomes available (so it can be forwarded immediately), or after two hours to report that it was never produced.',
  '{email}',
  true,
  '{internal}',
  '{openorders@pct.com}'
)
ON CONFLICT ("slug") DO NOTHING;
