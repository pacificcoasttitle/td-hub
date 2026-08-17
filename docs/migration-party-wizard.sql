-- Migration: party_collection_wizard_v1
-- Date: 2026-08-12
-- Purpose: storage for the party-collection wizard — tokenized links, submission
--          events, and a provenance tag on order_parties.
--
-- APPLY THIS BEFORE DEPLOYING THE WIZARD CODE. The code reads and writes all
-- three objects below; deploying first produces "relation does not exist".
--
-- ═══ DESIGN NOTES (read before changing anything) ═══════════════════════════
--
-- SUBMISSIONS ARE EVENTS, order_parties IS A PROJECTION.
--   order_parties has no source/created_by columns and is written with an
--   upsert whose SET clause overwrites on every sync. If provenance lived only
--   there, the next enrich_orders run would erase who told us and when.
--   party_submissions is the durable record; order_parties is the current view.
--
-- TOKENS ARE STORED HASHED, NEVER IN PLAINTEXT.
--   These links go to external parties and write data. A read-only leak of this
--   table must not yield working links, so we store SHA-256 of the token and
--   compare digests. Same reasoning as the bearer secret in the marketing plan.
--
-- STATUS COLUMNS ARE varchar + CHECK, NOT enums.
--   Deliberate. Postgres enums cannot gain a value inside a transaction, the
--   migration runner does not reliably apply ALTER TYPE, and this session has
--   already lost a day to exactly that (docs/migration-lookback-sync-enum.sql).
--   A CHECK constraint is editable in one statement and expresses the same
--   invariant.
--
-- TIMESTAMPS ARE `timestamp` (no time zone) to match all 80 existing timestamp
--   columns in this schema. The application writes UTC. Introducing the only
--   timestamptz columns here would be inconsistent, not an improvement.


-- ── 1. Tokenized links ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS party_wizard_links (
  id                 serial PRIMARY KEY,
  order_id           integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  role               party_role NOT NULL,

  -- Public opaque id, appears in the URL. Safe to log and to correlate on.
  token_id           varchar(32) NOT NULL UNIQUE,
  -- SHA-256 of the full token secret. NEVER store the secret itself.
  token_hash         char(64) NOT NULL,

  expires_at         timestamp NOT NULL,
  revoked_at         timestamp,

  -- Access telemetry. first/last access answer "did the forward actually land?"
  first_accessed_at  timestamp,
  last_accessed_at   timestamp,
  access_count       integer NOT NULL DEFAULT 0,

  -- Set on the FIRST successful submission. The link stays usable afterwards
  -- (an agent may correct a typo), so this is a milestone, not a lock.
  used_at            timestamp,
  submission_count   integer NOT NULL DEFAULT 0,
  -- Rate limiting per token lives here rather than in memory: the job runner is
  -- serverless, so an in-process counter caps nothing across instances.
  last_submitted_at  timestamp,

  created_at         timestamp NOT NULL DEFAULT now(),
  created_by         varchar(100),

  CONSTRAINT party_wizard_links_expiry_after_creation CHECK (expires_at > created_at)
);

-- NOTE: no separate index on token_id. The UNIQUE column constraint above
-- already creates party_wizard_links_token_id_key, which serves the hot-path
-- lookup. A second index would be pure duplicate write cost.

-- "does this order already have a live link for this role?" — prevents the
-- 3-day job minting a second link on every run.
CREATE INDEX IF NOT EXISTS party_wizard_links_order_role_idx
  ON party_wizard_links (order_id, role);

CREATE INDEX IF NOT EXISTS party_wizard_links_expires_idx
  ON party_wizard_links (expires_at);


-- ── 2. Submission events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS party_submissions (
  id                   serial PRIMARY KEY,
  order_id             integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  role                 party_role NOT NULL,

  -- FK to the link, plus the opaque token id denormalized. The id survives if
  -- the link row is ever pruned; the FK gives the join while it exists.
  source_link_id       integer REFERENCES party_wizard_links(id) ON DELETE SET NULL,
  token_id             varchar(32),

  -- Who filled the form in, as they identified themselves. This is the
  -- provenance answer to "who told us this".
  submitter_email      varchar(200),

  -- The full submitted payload, exactly as received after validation.
  -- jsonb so v2 roles can add fields without a migration.
  submitted_values     jsonb NOT NULL,

  submitted_at         timestamp NOT NULL DEFAULT now(),

  -- Outcome of the AddNotes write-back to SoftPro.
  softpro_note_status  varchar(20) NOT NULL DEFAULT 'pending',
  softpro_note_id      varchar(100),
  softpro_note_error   text,
  softpro_note_at      timestamp,

  CONSTRAINT party_submissions_note_status_check
    CHECK (softpro_note_status IN ('pending', 'sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS party_submissions_order_idx
  ON party_submissions (order_id, role);

CREATE INDEX IF NOT EXISTS party_submissions_link_idx
  ON party_submissions (source_link_id);

-- Drives the retry sweep for note write-backs that failed.
CREATE INDEX IF NOT EXISTS party_submissions_note_status_idx
  ON party_submissions (softpro_note_status)
  WHERE softpro_note_status IN ('pending', 'failed');


-- ── 3. Provenance tag on the projection ─────────────────────────────────────
-- Nullable: every existing row is SoftPro-sourced and stays NULL. Only rows the
-- wizard touches get a value, so this backfills nothing and locks nothing.

ALTER TABLE order_parties
  ADD COLUMN IF NOT EXISTS source varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_parties_source_check'
  ) THEN
    ALTER TABLE order_parties
      ADD CONSTRAINT order_parties_source_check
      CHECK (source IS NULL OR source IN ('softpro_sync', 'party_wizard', 'manual'));
  END IF;
END $$;


-- ═══ ⚠️  KNOWN HAZARD — NOT FIXED BY THIS MIGRATION ═════════════════════════
--
-- order_parties is upserted on (order_id, role, is_primary) and the SET clause
-- overwrites unconditionally. A wizard submission written into order_parties
-- WILL be silently overwritten by the next enrich_orders run that returns a
-- value for the same slot.
--
-- The `source` column records where a value came from; it does NOT protect it.
--
-- Protecting wizard values requires a decision that belongs to the writer, not
-- to schema:
--   (a) do not overwrite a row whose source = 'party_wizard'; or
--   (b) only overwrite when the incoming value is non-empty and differs; or
--   (c) accept that SoftPro wins and treat order_parties as advisory, with
--       party_submissions as the record of what the agent actually said.
--
-- Until that is decided, party_submissions is the ONLY durable copy of a
-- submission. Do not treat order_parties as the system of record.


-- ── VERIFICATION ────────────────────────────────────────────────────────────
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('party_wizard_links','party_submissions');
--   -- expect 2 rows
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='order_parties' AND column_name='source';
--   -- expect 1 row
--
--   SELECT conname FROM pg_constraint
--    WHERE conname IN ('order_parties_source_check','party_submissions_note_status_check');
--   -- expect 2 rows


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Safe while no wizard code is deployed. DROP TABLE discards submissions —
-- export party_submissions first if any real ones exist.
--
--   DROP TABLE IF EXISTS party_submissions;
--   DROP TABLE IF EXISTS party_wizard_links;
--   ALTER TABLE order_parties DROP CONSTRAINT IF EXISTS order_parties_source_check;
--   ALTER TABLE order_parties DROP COLUMN IF EXISTS source;
