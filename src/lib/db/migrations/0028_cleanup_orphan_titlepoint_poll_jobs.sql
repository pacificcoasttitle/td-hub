-- One-off cleanup: orphan titlepoint.poll jobs left status='queued' with no consumer.
-- HAND-APPLY TO PROD (safe UPDATE). Companion to Tier-1 stop-enqueueing change.

UPDATE jobs
SET
  status = 'failed',
  error = 'Superseded: orphan titlepoint.poll queue row (no consumer). Use manual TitlePoint retry.',
  ended_at = COALESCE(ended_at, NOW())
WHERE job_type = 'titlepoint.poll'
  AND status = 'queued';
