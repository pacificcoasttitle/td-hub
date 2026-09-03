-- 0044 — Rename the notification's operator-visible copy to "Request Updated Prelim".
--
-- WHY A SECOND MIGRATION
--   0043 seeded this row and is already applied. Editing 0043 in place would
--   change a migration after the fact, which is the thing that burned us on
--   0041. So the rename is its own file: committed, then applied.
--
-- WHAT IS AND IS NOT RENAMED
--   display_name and description are copy — an operator reads them in
--   Admin → Notifications, so they get the settled name.
--
--   The slug does NOT change. `order.prelim.updated` is an identifier, passed
--   as dispatchNotification({ eventType }) from the job handler. Renaming it
--   would need code and database changed in lockstep or every email silently
--   resolves no recipients. It is not copy and nobody sees it.
--
--   internal_cc is NOT touched. Whatever recipients have been set in Admin
--   stay set; this migration must not quietly reset them to the seed value.
--
-- Idempotent: matches on slug, and re-running writes the same strings.

UPDATE "notification_types"
SET
  "display_name" = 'Request Updated Prelim',
  "description" = 'A sales rep sent an updated prelim and asked production to action it: attached to SoftPro, note added, task 03-005 opened.'
WHERE "slug" = 'order.prelim.updated';
