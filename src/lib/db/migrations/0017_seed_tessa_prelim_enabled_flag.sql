-- BLD-TESSA-PRELIM-FEATURE-FLAG
-- Admin-controlled global switch for the AI Prelim (TESSA) feature.
-- Seed the flag OFF so the feature ships dark on deploy. The admin flips it ON
-- from Admin → Settings → TESSA without a redeploy. Idempotent: only inserts if
-- the key is absent, so re-running never resets an admin's chosen value.
INSERT INTO settings (key, value, description)
SELECT
  'tessa_prelim_enabled',
  'false'::jsonb,
  'When OFF, the AI Prelim feature is hidden from all users and no new analysis is triggered. Default OFF.'
WHERE NOT EXISTS (
  SELECT 1 FROM settings WHERE key = 'tessa_prelim_enabled'
);
