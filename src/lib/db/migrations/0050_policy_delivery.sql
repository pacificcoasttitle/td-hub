-- 0050 — Final policy delivery types, and the off switch.
--
-- Apply this to production BEFORE the sender code merges. The rows tolerate
-- arriving early; the code does not tolerate arriving first.
--
-- policy.delivery is_enabled is FALSE on purpose. Production already maps
-- policy webhooks to this slug. Enabling the type before the new sender is
-- live would start emails from the old generic document path. After the
-- sender ships, sending is gated by settings.policy_delivery_enabled — do
-- not use this type's toggle as the switch.
--
-- policy.delivery.unresolved is also FALSE. The fail-closed alert is the
-- same send path and the same switch.
--
-- policy_delivery_enabled defaults OFF, same pattern as tessa_prelim_enabled.
-- Turn it on deliberately for one watched send — one policy, one order,
-- someone reading the email that goes out.

INSERT INTO "notification_types"
  ("slug", "display_name", "description", "channels", "is_enabled", "recipient_roles", "internal_cc")
VALUES
  (
    'policy.delivery',
    'Policy delivery',
    'Sends the lender''s policy to escrow and the lender, the owner''s policy to the owner, and the supplement to escrow. Do not enable this type — sending is gated by the policy_delivery_enabled setting.',
    '{email}',
    false,
    '{internal}',
    '{openorders@pct.com}'
  ),
  (
    'policy.delivery.unresolved',
    'Policy — recipient missing',
    'A policy is on file and was not sent because a required recipient could not be resolved. Do not guess. Do not enable this type — sending is gated by the policy_delivery_enabled setting.',
    '{email}',
    false,
    '{internal}',
    '{openorders@pct.com}'
  )
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO settings (key, value, description)
SELECT
  'policy_delivery_enabled',
  'false'::jsonb,
  'When OFF, incoming policies are stored and nobody is emailed. Default OFF. Turn ON only for a watched first send — one policy, one order, someone reading the email that goes out and confirming it reached the right firm. Same pattern as tessa_prelim_enabled.'
WHERE NOT EXISTS (
  SELECT 1 FROM settings WHERE key = 'policy_delivery_enabled'
);
