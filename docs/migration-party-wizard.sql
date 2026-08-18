-- Migration: party_collection_wizard_v1
-- Date: 2026-08-18
-- Purpose: storage for the party-collection wizard — tokenized links, submission
--          events, and a provenance tag on order_parties.
--
-- APPLY THIS BEFORE DEPLOYING THE WIZARD CODE. The code reads and writes all
-- three objects below; deploying first produces "relation does not exist".
--
-- ═══ DESIGN NOTES (read before changing anything) ═══════════════════════════
--
-- SUBMISSIONS ARE EVENTS, order_parties IS A PROJECTION.
--   order_parties has no provenance columns and is upserted with a SET clause
--   that overwrites unconditionally. If a submission lived only there, the next
--   SoftPro sync would silently erase it. party_submissions is the durable
--   record; order_parties is the current view, and is expendable.
--
-- EVERY SUBMISSION IS REPLAYABLE.
--   SoftPro's updateOrder cannot reliably attach parties today: the create path
--   writes the wrong name and drops the company, and the update path returns
--   200 while changing nothing. So v1 collects into TD Hub and posts a note.
--   When the party-attach fix ships, we replay stored submissions into SoftPro
--   rather than having lost everything collected in the gap.
--
--   Replay needs the eventual TWO-STEP write to be reconstructible from a row
--   alone: CreateUser mints a contact, then the order attaches it by lookup
--   code. That is why the party fields are DISCRETE COLUMNS, not just the jsonb
--   blob — a replay job builds a CreateUser payload straight from the row — and
--   why the minted lookup codes are stored back onto it, so a retry after a
--   partial failure does not mint a second contact for the same person.
--
--   softpro_party_status is the replay queue. Every row lands on 'pending' and
--   stays there until the fix ships. Nothing sets it to 'attached' in v1.
--
-- ONE ROW PER ROLE.
--   The discrete columns describe the party named by `role`. The wizard also
--   asks the listing agent for a seller contact; when present that becomes a
--   SECOND row with role='seller', so it replays through the same path. The
--   complete raw payload always goes to submitted_values as well, so a field we
--   forgot to promote to a column is never lost.
--
-- TWO EMAIL COLUMNS, DELIBERATELY.
--   submitter_email = who filled the form in (provenance: "who told us").
--   submitted_email = the party's own email (data: what goes into SoftPro).
--   They are usually the same person and occasionally are not.
--
-- TOKENS ARE STORED HASHED, NEVER IN PLAINTEXT.
--   These links go to external parties and write data. A read-only leak of this
--   table must not yield working links, so we store SHA-256 of the token and
--   compare digests.
--
-- STATUS COLUMNS ARE varchar + CHECK, NOT enums.
--   Deliberate. Postgres enums cannot gain a value inside a transaction and the
--   migration runner does not reliably apply ALTER TYPE — see
--   docs/migration-lookback-sync-enum.sql. A CHECK is editable in one statement
--   and expresses the same invariant. Replay states will need extending.
--
-- TIMESTAMPS ARE `timestamp` (no time zone) to match all 80 existing timestamp
--   columns in this schema. The application writes UTC.


-- ── 1. Tokenized links ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS party_wizard_links (
  id                 serial PRIMARY KEY,
  order_id           integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  role               party_role NOT NULL,

  -- Public opaque id, appears in the URL. Safe to log and to correlate on.
  token_id           varchar(32) NOT NULL UNIQUE,
  -- SHA-256 of the full token secret. NEVER store the secret itself.
  token_hash         char(64) NOT NULL,

  -- 60 days: orders run long and a link may sit in an inbox for weeks.
  expires_at         timestamp NOT NULL,
  revoked_at         timestamp,

  -- Access telemetry. first/last access answer "did the forward actually land?"
  first_accessed_at  timestamp,
  last_accessed_at   timestamp,
  access_count       integer NOT NULL DEFAULT 0,

  -- Set on the FIRST successful submission. The link stays usable afterwards so
  -- an agent can resume or correct a typo; this is a milestone, not a lock.
  used_at            timestamp,
  submission_count   integer NOT NULL DEFAULT 0,
  -- Per-token rate limiting lives here, not in memory: the runtime is
  -- serverless, so an in-process counter caps nothing across instances.
  last_submitted_at  timestamp,

  created_at         timestamp NOT NULL DEFAULT now(),
  created_by         varchar(100),

  CONSTRAINT party_wizard_links_expiry_after_creation CHECK (expires_at > created_at)
);

-- NOTE: no separate index on token_id. The UNIQUE column constraint already
-- creates party_wizard_links_token_id_key, which serves the hot-path lookup.

-- "does this order already have a live link for this role?" — stops the 3-day
-- job minting a second link on every run.
CREATE INDEX IF NOT EXISTS party_wizard_links_order_role_idx
  ON party_wizard_links (order_id, role);

CREATE INDEX IF NOT EXISTS party_wizard_links_expires_idx
  ON party_wizard_links (expires_at);


-- ── 2. Submission events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS party_submissions (
  id                     serial PRIMARY KEY,
  order_id               integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  role                   party_role NOT NULL,

  -- FK to the link, plus the opaque token id denormalized. The id survives if
  -- the link row is ever pruned; the FK gives the join while it exists.
  source_link_id         integer REFERENCES party_wizard_links(id) ON DELETE SET NULL,
  token_id               varchar(32),

  -- Provenance: who filled the form in.
  submitter_email        varchar(200),

  -- ── the party itself, discrete so a replay can build CreateUser from the row
  submitted_name         varchar(200),
  submitted_company      varchar(200),
  submitted_email        varchar(200),
  submitted_phone        varchar(50),

  -- Complete raw payload, post-validation. Superset of the columns above;
  -- carries anything not promoted to a column (and future roles' fields).
  submitted_values       jsonb NOT NULL,

  submitted_at           timestamp NOT NULL DEFAULT now(),

  -- ── v1 write path: the structured note (AddNotes; works on both builds) ────
  softpro_note_status    varchar(20) NOT NULL DEFAULT 'pending',
  softpro_note_id        varchar(100),
  softpro_note_error     text,
  softpro_note_at        timestamp,

  -- ── deferred write path: the real party attach, replayed once it works ────
  -- Everything lands on 'pending'. v1 never sets 'attached'.
  softpro_party_status   varchar(20) NOT NULL DEFAULT 'pending',
  softpro_party_error    text,
  softpro_party_at       timestamp,
  softpro_party_attempts integer NOT NULL DEFAULT 0,
  -- Lookup codes minted during a two-step write, stored back so a retry after a
  -- partial failure attaches the existing contact instead of minting a duplicate.
  softpro_client_lookup_code   varchar(50),
  softpro_company_lookup_code  varchar(50),

  CONSTRAINT party_submissions_note_status_check
    CHECK (softpro_note_status IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT party_submissions_party_status_check
    CHECK (softpro_party_status IN ('pending', 'attached', 'failed', 'skipped', 'superseded'))
);

-- Replay and projection both read "latest submission per order+role".
CREATE INDEX IF NOT EXISTS party_submissions_order_role_idx
  ON party_submissions (order_id, role, submitted_at DESC);

CREATE INDEX IF NOT EXISTS party_submissions_link_idx
  ON party_submissions (source_link_id);

-- Drives the note retry sweep.
CREATE INDEX IF NOT EXISTS party_submissions_note_status_idx
  ON party_submissions (softpro_note_status)
  WHERE softpro_note_status IN ('pending', 'failed');

-- Drives the replay queue once the party-attach fix ships. Partial, because
-- 'attached' rows will eventually dominate the table and are never re-read.
CREATE INDEX IF NOT EXISTS party_submissions_party_status_idx
  ON party_submissions (softpro_party_status, submitted_at)
  WHERE softpro_party_status IN ('pending', 'failed');


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


-- ═══ ⚠️  ONE DECISION THIS MIGRATION DOES NOT MAKE ══════════════════════════
--
-- order_parties is upserted on (order_id, role, is_primary) with an
-- unconditional SET. A wizard value written there WILL be overwritten by the
-- next enrich_orders run that returns anything for the same slot. The `source`
-- column records where a value came from; it does not protect it.
--
-- That is survivable precisely because submissions are events: the record is
-- never lost, only the projection is. But the writer still has to choose:
--   (a) skip rows whose source = 'party_wizard' — the agent's answer wins;
--   (b) overwrite only when the incoming value is non-empty — SoftPro wins,
--       but a blank can never clobber a collected value;
--   (c) let SoftPro win outright and treat order_parties as advisory.
--
-- (a) is the recommendation: the wizard exists because the slot is empty, so a
-- later sync returning empty must not erase what the agent told us. Whichever
-- is chosen, party_submissions remains the system of record.


-- ── VERIFICATION ────────────────────────────────────────────────────────────
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('party_wizard_links','party_submissions');
--   -- expect 2 rows
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='party_submissions'
--      AND column_name IN ('submitted_name','submitted_company','submitted_email',
--                          'submitted_phone','softpro_party_status');
--   -- expect 5 rows
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='order_parties' AND column_name='source';
--   -- expect 1 row
--
--   SELECT conname FROM pg_constraint
--    WHERE conname IN ('order_parties_source_check',
--                      'party_submissions_note_status_check',
--                      'party_submissions_party_status_check');
--   -- expect 3 rows


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Safe while no wizard code is deployed. DROP TABLE discards submissions —
-- export party_submissions first if any real ones exist.
--
--   DROP TABLE IF EXISTS party_submissions;
--   DROP TABLE IF EXISTS party_wizard_links;
--   ALTER TABLE order_parties DROP CONSTRAINT IF EXISTS order_parties_source_check;
--   ALTER TABLE order_parties DROP COLUMN IF EXISTS source;
