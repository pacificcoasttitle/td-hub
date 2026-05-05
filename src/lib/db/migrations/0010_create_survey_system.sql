-- Survey System tables, columns, and seed data

-- 1. Add columns to companies
ALTER TABLE companies
  ADD COLUMN surveys_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN surveys_disabled_reason text;

-- 2. Create surveys table
CREATE TABLE surveys (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id),
  recipient_type varchar(20) NOT NULL,
  recipient_email varchar(200) NOT NULL,
  recipient_name varchar(200),
  recipient_contact_id integer REFERENCES contacts(id),
  recipient_company_id integer REFERENCES companies(id),
  token varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'sent',
  sent_at timestamp NOT NULL DEFAULT NOW(),
  expires_at timestamp NOT NULL,
  completed_at timestamp,
  bounced_at timestamp,
  bounce_reason text,
  sendgrid_message_id varchar(200),
  notification_log_id integer,
  created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX surveys_token_idx ON surveys(token);
CREATE UNIQUE INDEX surveys_order_recipient_idx ON surveys(order_id, recipient_type);
CREATE INDEX surveys_status_idx ON surveys(status);
CREATE INDEX surveys_sent_at_idx ON surveys(sent_at);

-- 3. Create survey_responses table
CREATE TABLE survey_responses (
  id serial PRIMARY KEY,
  survey_id integer NOT NULL UNIQUE REFERENCES surveys(id),
  communication_rating integer NOT NULL,
  timeliness_rating integer NOT NULL,
  overall_rating integer NOT NULL,
  comment text,
  submitted_at timestamp NOT NULL DEFAULT NOW(),
  ip_address varchar(50),
  user_agent text,
  CONSTRAINT survey_responses_rating_check CHECK (
    communication_rating BETWEEN 1 AND 5
    AND timeliness_rating BETWEEN 1 AND 5
    AND overall_rating BETWEEN 1 AND 5
  )
);

-- 4. Create survey_send_log table
CREATE TABLE survey_send_log (
  id serial PRIMARY KEY,
  order_id integer REFERENCES orders(id),
  recipient_type varchar(20),
  result varchar(40) NOT NULL,
  error_message text,
  attempted_at timestamp NOT NULL DEFAULT NOW(),
  cron_run_id varchar(64)
);
CREATE INDEX survey_send_log_order_idx ON survey_send_log(order_id);
CREATE INDEX survey_send_log_result_idx ON survey_send_log(result);
CREATE INDEX survey_send_log_attempted_at_idx ON survey_send_log(attempted_at);

-- 5. Create survey_optout_audit table
CREATE TABLE survey_optout_audit (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  previous_value boolean NOT NULL,
  new_value boolean NOT NULL,
  reason text,
  changed_by varchar(64) NOT NULL REFERENCES profiles(id),
  changed_at timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX survey_optout_audit_company_idx ON survey_optout_audit(company_id);

-- 6. Insert global enable flag into existing settings table
INSERT INTO settings (key, value, description)
VALUES ('surveys.enabled', 'true'::jsonb, 'Master switch for post-close survey system')
ON CONFLICT (key) DO NOTHING;
