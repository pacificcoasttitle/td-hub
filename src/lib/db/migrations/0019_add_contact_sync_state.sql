CREATE TABLE IF NOT EXISTS contact_sync_state (
  entity_type varchar(100) PRIMARY KEY,
  job_type varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'idle',
  cursor_lookup_code varchar(200),
  last_started_at timestamp,
  last_completed_at timestamp,
  next_allowed_at timestamp,
  total_fetched integer NOT NULL DEFAULT 0,
  last_result jsonb,
  last_error text,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_sync_state_job_type_idx
  ON contact_sync_state (job_type);

CREATE INDEX IF NOT EXISTS contact_sync_state_next_allowed_idx
  ON contact_sync_state (next_allowed_at);
