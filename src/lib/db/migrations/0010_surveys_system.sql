-- ─── Surveys ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" integer NOT NULL REFERENCES "orders"("id"),
  "recipient_type" text NOT NULL,
  "recipient_email" text NOT NULL,
  "recipient_name" text,
  "recipient_contact_id" integer REFERENCES "contacts"("id"),
  "recipient_company_id" integer REFERENCES "companies"("id"),
  "token" text NOT NULL,
  "status" text NOT NULL DEFAULT 'sent',
  "sent_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "bounced_at" timestamp with time zone,
  "bounce_reason" text,
  "sendgrid_message_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "surveys_token_idx" ON "surveys" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "surveys_order_recipient_idx" ON "surveys" ("order_id", "recipient_type");
CREATE INDEX IF NOT EXISTS "surveys_status_idx" ON "surveys" ("status");
CREATE INDEX IF NOT EXISTS "surveys_sent_at_idx" ON "surveys" ("sent_at");

-- ─── Survey Responses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "survey_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_id" uuid NOT NULL REFERENCES "surveys"("id"),
  "communication_rating" integer NOT NULL,
  "timeliness_rating" integer NOT NULL,
  "overall_rating" integer NOT NULL,
  "comment" text,
  "submitted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ip_address" text,
  "user_agent" text,
  CONSTRAINT "survey_responses_rating_check" CHECK (
    "communication_rating" BETWEEN 1 AND 5
    AND "timeliness_rating" BETWEEN 1 AND 5
    AND "overall_rating" BETWEEN 1 AND 5
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "survey_responses_survey_idx" ON "survey_responses" ("survey_id");

-- ─── Survey Send Log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "survey_send_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" integer REFERENCES "orders"("id"),
  "recipient_type" text,
  "result" text NOT NULL,
  "error_message" text,
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "cron_run_id" uuid
);
CREATE INDEX IF NOT EXISTS "survey_send_log_order_idx" ON "survey_send_log" ("order_id");
CREATE INDEX IF NOT EXISTS "survey_send_log_result_idx" ON "survey_send_log" ("result");
CREATE INDEX IF NOT EXISTS "survey_send_log_attempted_at_idx" ON "survey_send_log" ("attempted_at");

-- ─── Survey Opt-Out Audit ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "survey_optout_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "previous_value" boolean NOT NULL,
  "new_value" boolean NOT NULL,
  "reason" text,
  "changed_by" text NOT NULL REFERENCES "profiles"("id"),
  "changed_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "survey_optout_audit_company_idx" ON "survey_optout_audit" ("company_id");

-- ─── Companies: opt-out columns ────────────────────────────────────────────
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "surveys_disabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "surveys_disabled_reason" text;

-- ─── Settings: global kill switch ──────────────────────────────────────────
-- Uses the existing `settings` table (key/value/description, jsonb value).
-- Spec referenced `system_config` but no such table exists in TD Hub vNext.
INSERT INTO "settings" ("key", "value", "description")
VALUES ('surveys.enabled', 'true'::jsonb, 'Master switch for post-close survey system')
ON CONFLICT ("key") DO NOTHING;
