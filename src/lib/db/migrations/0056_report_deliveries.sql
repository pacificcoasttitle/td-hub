-- 0056 — the delivery log for reports. One row per ATTEMPT, failures included.
--
-- WHY THIS EXISTS BEFORE ANY SEND DOES
--   The prelim path has the opposite rule — logging must never block a send —
--   and it recorded 1 delivery out of 1,083. A screen that reads a log which is
--   only written when convenient shows silence as success. Building the table
--   first, while nothing writes to it, is the cheap moment to make the rule
--   structural rather than aspirational.
--
-- THE WRITE RULE, which lives in the code that sends:
--   The row is written in the SAME TRANSACTION as the attempt, failures
--   included. If the log write fails, the send fails. Not best-effort, not
--   fire-and-forget, not a queue that can drop.
--
-- THE READ RULE:
--   The Delivery column on the reports list derives from this table. There is
--   deliberately NO `sent` boolean on any report row: a flag and a log disagree
--   eventually, and then neither is trusted. "Never sent" is the absence of a
--   row, and must read differently from "delivered" on every screen.
--
-- NOTIFY REP IS NOT SEND TO AGENT
--   Telling the branded rep a report exists and delivering it to an outside
--   agent are different acts, and only the first is in scope. `kind` carries
--   that distinction so the second can arrive without a migration, and nothing
--   here is named "send".
--
-- NO PERMANENT PUBLIC LINK
--   Legacy wrote these PDFs to S3 with public read and emailed the raw URL;
--   the URLs are guessable and the reports carry property and sales data.
--   Delivery is an attachment or a short-lived signed link, and which one was
--   used is recorded — with the expiry, so a link in an old email can be shown
--   to have died.
--
-- RLS
--   Enabled in the same migration as the CREATE, per 0038/0040.

CREATE TABLE IF NOT EXISTS report_deliveries (
  id              serial PRIMARY KEY,

  -- What was delivered. Not a foreign key: the four report types live in four
  -- tables, and a log that only references one of them is the log we cannot
  -- keep. report_type + report_id is the pair every reader uses.
  report_type     varchar(40) NOT NULL,
  report_id       integer NOT NULL,

  -- notify_rep today; send_to_agent later, without a migration.
  kind            varchar(20) NOT NULL DEFAULT 'notify_rep',

  -- A rep today, an outside agent later. The same two columns either way.
  recipient_name  varchar(200),
  recipient_email varchar(200) NOT NULL,

  sent_by         varchar(100),

  -- Of the ATTEMPT, not of the success. A failed attempt has a time too.
  attempted_at    timestamp NOT NULL DEFAULT now(),

  outcome         varchar(20) NOT NULL,
  -- The provider's reason, kept verbatim. "Failed" with no reason is how a
  -- delivery problem becomes unfixable a week later.
  outcome_detail  text,

  payload_mode    varchar(20) NOT NULL,
  -- Only for signed_link, so a link in an old email can be shown to have died.
  link_expires_at timestamp,

  CONSTRAINT report_deliveries_kind_check
    CHECK (kind IN ('notify_rep', 'send_to_agent')),
  CONSTRAINT report_deliveries_outcome_check
    CHECK (outcome IN ('delivered', 'failed')),
  CONSTRAINT report_deliveries_payload_mode_check
    CHECK (payload_mode IN ('attachment', 'signed_link')),
  -- A failure must say why; a link must say when it dies.
  CONSTRAINT report_deliveries_failed_has_detail
    CHECK (outcome <> 'failed' OR outcome_detail IS NOT NULL),
  CONSTRAINT report_deliveries_link_has_expiry
    CHECK (payload_mode <> 'signed_link' OR link_expires_at IS NOT NULL)
);

-- The Delivery column reads the latest attempt per report.
CREATE INDEX IF NOT EXISTS report_deliveries_report_idx
  ON report_deliveries (report_type, report_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS report_deliveries_attempted_idx
  ON report_deliveries (attempted_at DESC);

ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;

-- VERIFY
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'report_deliveries';  -- true
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'report_deliveries%';
--   SELECT count(*) FROM report_deliveries;                                    -- 0
