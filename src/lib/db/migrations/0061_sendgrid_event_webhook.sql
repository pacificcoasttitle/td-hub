-- 0061 — record what SendGrid actually did, not what it accepted.
--
-- WHY (Gerard, 2026-09-22, after the measurement)
--   Over 5,524 deliveries since April, SEVENTEEN went to addresses SendGrid
--   had already suppressed — six prelims and eleven confirmations, to twelve
--   addresses, the most recent that same day. SendGrid answered 202 to every
--   one, we logged success, and every screen said Sent. Nothing was delivered
--   and nobody was told. Six clients are still waiting for a title report.
--
--   0060 changed the WORD from Delivered to Sent because acceptance was all we
--   could prove. This is the evidence that earns the word back.
--
-- FILTERED TO OUR OWN MAIL, DELIBERATELY
--   The SendGrid account is not only ours: it shows ~99,900 requests against
--   our ~5,500, so something else at PCT sends on it. The webhook therefore
--   keeps ONLY events whose message id matches a send of ours. An unmatched
--   event is counted and dropped, never stored — otherwise every number we
--   build on this would be measuring a stranger's traffic.
--
-- TWO TABLES, ONE FACT EACH
--   email_events   what the provider said, verbatim, append-only.
--   report_deliveries.outcome   what a human is shown, derived from it.
--   Keeping them apart means a mapping we get wrong today can be recomputed
--   tomorrow from events we still hold.

CREATE TABLE IF NOT EXISTS email_events (
  id                 serial PRIMARY KEY,
  -- SendGrid's per-message id. The join to every send we made.
  sg_message_id      varchar(200) NOT NULL,
  -- delivered | bounce | dropped | deferred | spamreport | blocked | …
  -- Not constrained: SendGrid may add event types and losing one to a CHECK
  -- would be worse than storing a name we do not yet read.
  event              varchar(40)  NOT NULL,
  email              varchar(320) NOT NULL,
  -- When SendGrid says it happened, which is NOT when we heard about it.
  -- Events arrive out of order and are retried; both columns are needed.
  occurred_at        timestamptz  NOT NULL,
  received_at        timestamptz  NOT NULL DEFAULT now(),
  -- The provider's reason, verbatim. "550 5.1.1 User unknown" is the whole
  -- value of this table to whoever chases the client.
  reason             text,
  -- bounce vs blocked, and the smtp-id, live in here. Kept whole so a
  -- question we have not thought of yet is still answerable.
  raw                jsonb        NOT NULL
);

-- Idempotency. SendGrid retries a batch it could not deliver to us, and the
-- same event may arrive several times; (message, event, instant) is the
-- identity of one occurrence. A partial retry must not double-count a bounce.
CREATE UNIQUE INDEX IF NOT EXISTS email_events_once_idx
  ON email_events (sg_message_id, event, occurred_at);
CREATE INDEX IF NOT EXISTS email_events_message_idx ON email_events (sg_message_id);
CREATE INDEX IF NOT EXISTS email_events_email_idx   ON email_events (lower(email));

-- Every table in this database has row-level security; there is a test that
-- refuses a schema where one does not (src/lib/db/rls-lockdown.test.ts), and
-- it caught this table before it shipped. The application connects as the
-- owner, so this denies by default to everyone else — which is right for a
-- table holding recipient addresses and the reasons their mail failed.
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

-- ─── The message id gets its own column ─────────────────────────────────────
-- Notify rep wrote it into outcome_detail as prose ("Accepted by SendGrid,
-- message <id>. Delivery not confirmed."). Prose cannot be indexed or joined.
ALTER TABLE report_deliveries ADD COLUMN IF NOT EXISTS provider_message_id varchar(200);
CREATE INDEX IF NOT EXISTS report_deliveries_message_idx ON report_deliveries (provider_message_id);

-- Backfill from the prose, so rows sent before this migration can still be
-- matched by an event that arrives after it.
UPDATE report_deliveries
   SET provider_message_id = substring(outcome_detail from 'message ([^.\s]+)')
 WHERE provider_message_id IS NULL
   AND outcome_detail LIKE '%message %';

-- ─── Widening the outcome, deliberately ─────────────────────────────────────
-- 0060 narrowed this to ('sent','failed') because nothing could prove more.
-- Now something can. 'sent' remains the honest state between acceptance and
-- the first event, and most mail stays there for only seconds.
--
--   sent       accepted by SendGrid; nothing heard yet
--   delivered  the receiving server accepted it. EARNED, not assumed.
--   bounced    rejected by the receiving server
--   dropped    SendGrid did not even try — the silent case, and the reason
--              this whole build exists
--   spam       the recipient marked it as spam
--   failed     we never handed it over
--
-- 'deferred' is deliberately NOT here. It is a retry in progress, not an
-- outcome; treating it as one would show a scary word for the normal case.
ALTER TABLE report_deliveries DROP CONSTRAINT IF EXISTS report_deliveries_outcome_check;
ALTER TABLE report_deliveries ADD CONSTRAINT report_deliveries_outcome_check
  CHECK (outcome IN ('sent', 'failed', 'delivered', 'bounced', 'dropped', 'spam'));

-- VERIFY
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'report_deliveries_outcome_check';
--   SELECT count(*) FROM email_events;
--   SELECT count(*) FROM report_deliveries WHERE provider_message_id IS NOT NULL;
