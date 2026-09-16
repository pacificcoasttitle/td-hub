-- 0052 — Where SoftPro and the hub disagree about an order's contact.
--
-- WHY
--   Before a prelim or policy is sent, the hub now re-reads the order's contacts
--   from SoftPro and sends to SoftPro's address when the two disagree (Gerard,
--   2026-09-16: SoftPro is the system of record; no hold queue). Measured first:
--   of 39 orders that received a prelim in the prior 30 days, 4 addressed a
--   different escrow contact from the one SoftPro holds now, three of them a
--   different firm.
--
--   Sending to SoftPro's address fixes the delivery. It does not tell anyone the
--   hub's record is stale. This table does: one open row per (order, role,
--   field), updated when seen again, closed as 'converged' when a later read
--   agrees. The weekly sweep designed in docs/tickets/ORDER_CONTACT_REFRESH.md
--   will write here too.
--
--   Nothing reads this to overwrite order_parties or orders. Recorded, not
--   silently resolved, so the drift rate stays measurable.
--
-- RLS
--   Enabled in the same migration as the CREATE, per 0038/0040: this table holds
--   the email addresses documents are sent to. ENABLE, not FORCE — the
--   application connects as the owner.

CREATE TABLE IF NOT EXISTS order_contact_drift (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  role varchar(40) NOT NULL,
  field varchar(40) NOT NULL DEFAULT 'email',
  kind varchar(40) NOT NULL,
  source varchar(20) NOT NULL,
  send_kind varchar(40),
  ours text,
  softpro text,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  times_seen integer NOT NULL DEFAULT 1,
  resolved_at timestamp,
  resolution varchar(40)
);

CREATE UNIQUE INDEX IF NOT EXISTS order_contact_drift_open_uniq
  ON order_contact_drift (order_id, role, field) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS order_contact_drift_last_seen_idx
  ON order_contact_drift (last_seen_at);

ALTER TABLE public.order_contact_drift ENABLE ROW LEVEL SECURITY;

-- The internal alert. recipient_roles = {internal} reads internal_cc, editable in
-- Admin → Notifications. Seeded with the two addresses already on the
-- create-failure alert (0048); none invented here. ON CONFLICT DO NOTHING so a
-- re-run cannot reset recipients an operator has edited.
INSERT INTO "notification_types"
  ("slug", "display_name", "description", "channels", "is_enabled", "recipient_roles", "internal_cc")
VALUES (
  'order.contacts.drift',
  'Document Sent To SoftPro''s Contact',
  'Before a prelim or policy is sent, the hub re-reads the order''s contacts from SoftPro. Fires when SoftPro holds a different recipient (the document went to SoftPro''s) or holds none (the document was not sent). The hub''s own record is not changed.',
  '{email}',
  true,
  '{internal}',
  '{ghernandez@pct.com,openorders@pct.com}'
)
ON CONFLICT ("slug") DO NOTHING;

-- VERIFY
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'order_contact_drift';   -- true
--   SELECT slug, is_enabled, internal_cc FROM notification_types WHERE slug = 'order.contacts.drift';
