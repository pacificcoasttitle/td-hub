-- 0050 — The contact sync resumes across runs, one page at a time.
--
-- WHY
--   SoftPro takes 65-95s per GetLookuptable page (all 16 person pages read on
--   2026-09-15: average 70.8s). The sync fetched every page before processing
--   any, under a 60s per-request timeout and a 300s function ceiling, so it
--   could not finish: `Order Contact - Person` last completed on 2026-09-03,
--   and the lender, title officer, escrow officer and underwriter syncs have
--   been failing the same way. See docs/tickets/RESUMABLE_CONTACT_SYNC.md.
--
-- WHAT
--   Per-entity-type sweep state. `cursor_lookup_code` (existing) becomes the
--   boundary code — the last lookup code of the last completed page.
--
--   The UPDATE clears the old 16-hour cooldowns left by the batch design so the
--   first sweep starts on the next scheduled run rather than tomorrow. Sales Rep
--   keeps its cooldown: it is one request, not paged, and not part of this change.
ALTER TABLE contact_sync_state
  ADD COLUMN IF NOT EXISTS next_page integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_pages integer,
  ADD COLUMN IF NOT EXISTS sweep_started_at timestamp,
  ADD COLUMN IF NOT EXISTS sweep_total_rows integer,
  ADD COLUMN IF NOT EXISTS last_sweep_completed_at timestamp,
  ADD COLUMN IF NOT EXISTS drift_suspected boolean NOT NULL DEFAULT false;

UPDATE contact_sync_state
  SET next_allowed_at = NULL, cursor_lookup_code = NULL, updated_at = now()
  WHERE entity_type <> 'Sales Rep';
