-- 0054 — The reader: a job that is failing or stalled reaches a person.
--
-- WHY
--   On 2026-09-16 notifications.outstanding_documents_alert failed 538 runs in a
--   row over 14 hours. Every failure was recorded properly, with an error
--   message, and nothing read the records. Separately, softpro.enrich_orders
--   reported "completed" for two weeks while never reading the 482 orders
--   created in the hub. Recording what happens is not enough; something has to
--   look and tell someone.
--
--   jobs.watchdog (every 15 minutes) now checks each job type for two things —
--   every run failing, and work waiting that nothing is doing — and emails the
--   recipients below. This table is its memory, so an ongoing problem is one
--   alert, a reminder every few hours, and a note when it clears, not an email
--   every 15 minutes.
--
-- job_health_alerts
--   One OPEN row per (job_type, condition): opened when first seen, reminded
--   while it persists, resolved when a later check no longer sees it.
--
-- RLS
--   Enabled in the same migration as the CREATE, per 0038/0040. ENABLE, not
--   FORCE: the application connects as the owner.

CREATE TABLE IF NOT EXISTS job_health_alerts (
  id serial PRIMARY KEY,
  job_type varchar(100) NOT NULL,
  condition varchar(40) NOT NULL,
  summary text NOT NULL,
  detail jsonb,
  opened_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  last_alerted_at timestamp,
  alert_count integer NOT NULL DEFAULT 0,
  resolved_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS job_health_alerts_open_uniq
  ON job_health_alerts (job_type, condition) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS job_health_alerts_opened_idx
  ON job_health_alerts (opened_at);

ALTER TABLE public.job_health_alerts ENABLE ROW LEVEL SECURITY;

-- Recipients, editable in Admin → Notifications (internal_cc). Seeded with the
-- ops daily report's recipient, the address that already receives job health.
-- ON CONFLICT DO NOTHING so a re-run cannot reset an operator's edit.
INSERT INTO "notification_types"
  ("slug", "display_name", "description", "channels", "is_enabled", "recipient_roles", "internal_cc")
VALUES (
  'ops.jobs.unhealthy',
  'Background Job Failing Or Stalled',
  'Sent by the jobs watchdog when a background job has failed on every run for an hour (or its last three runs), or has work waiting that is not being done. One email when it starts, a reminder every six hours while it continues, and one when it clears.',
  '{email}',
  true,
  '{internal}',
  '{ghernandez@pct.com}'
)
ON CONFLICT ("slug") DO NOTHING;

-- VERIFY
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'job_health_alerts';   -- true
--   SELECT slug, is_enabled, internal_cc FROM notification_types WHERE slug = 'ops.jobs.unhealthy';
