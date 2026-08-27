-- 0038 — SECURITY: close the five tables 0032 missed, and stop enumerating by hand.
--
-- WHY
--   0032 enabled RLS on 37 tables by hand-written name. Five tables added
--   afterwards — party_wizard_links, party_submissions, concierge_profiles,
--   concierge_profile_comps, concierge_profile_transfers — were pushed straight
--   from the Drizzle schema, never passed through a migration file, and so were
--   never appended to that list. They stayed RLS-off.
--
--   That is live exposure, not a latent one. The Supabase anon key is inlined
--   into the browser bundle by NEXT_PUBLIC_* and is served publicly at
--   /_next/static/chunks/a98b931760ed386f.js. Measured immediately before this
--   migration, with that key alone:
--
--     GET /rest/v1/party_wizard_links      -> HTTP 200, Content-Range 0-1/2
--     DELETE /rest/v1/party_submissions?id=eq.-2147483647
--                                          -> HTTP 200 (authorised; matched no rows
--                                             on purpose, so it destroyed nothing)
--
--   The DELETE mattered more than the read. anon holds arwdDxtm on all 42 public
--   tables, PostgREST offers a DELETE verb, and RLS is what gates DELETE. With
--   RLS off, an anonymous caller could have emptied all five row by row.
--
--   TRUNCATE is NOT the risk here even though anon holds it: row security does
--   not apply to TRUNCATE at all (it is gated only by the privilege), but
--   PostgREST has no TRUNCATE verb (HTTP 501), no function in an exposed schema
--   truncates anything, and anon.rolcanlogin = false so there is no libpq path
--   for the key. The TRUNCATE grant is unreachable with the anon key and is
--   therefore a separate, lower-urgency defence-in-depth item, not something
--   this migration can fix — see docs/security/OPEN_SECURITY_ITEMS.md item 6.
--
-- WHAT THIS DOES
--   Enables RLS with NO policies, exactly as 0032 did. A role with no policy
--   matching a command sees zero rows and may write nothing, which denies
--   anon/authenticated outright. No policy is created: nothing legitimate reaches
--   these tables through PostgREST, so there is no access pattern for a policy to
--   describe, and a policy nobody can test against would only look reviewed.
--
-- WHY IT IS A NO-OP FOR THE APPLICATION — and how that was actually tested
--   The app connects as `postgres` (src/lib/db/client.ts, DATABASE_URL), which
--   has rolbypassrls = true AND owns all 42 public tables. Two independent
--   bypasses; FORCE ROW LEVEL SECURITY is set nowhere and is not set here.
--
--   "Query as the app role and see rows" is not a test of that — it returns the
--   same answer whether RLS is on or off, so it cannot fail. The check that ran
--   (scripts/audit/rls-discriminating-test.ts, all inside one rolled-back
--   transaction) used three arms over the same tables with RLS enabled:
--
--     postgres      -> party_wizard_links 2 rows  (unchanged)
--     anon          -> party_wizard_links 0 rows  (was 2 — proves RLS enforces)
--     authenticated -> party_wizard_links 0 rows  (the failure shape, demonstrated)
--
--   The third arm is what makes the first a result: identical SQL, same tables,
--   same transaction, opposite answer, and the only variable is whether the role
--   bypasses. It is also literally what the app would have returned had its
--   connection not been a bypassing owner — the only way this change could break
--   anything. Measured, not assumed: FORCE does NOT override BYPASSRLS, so FORCE
--   could not have served as that falsification arm.
--
--   The wizard read path was run in the same transaction under RLS: the
--   resolvePartyWizardLink select returned link id 3 / order 7001, and the
--   loadOrderContext join returned file 20021035-GLT. Under `authenticated` the
--   same select returned nothing.
--
-- WHY THIS IS A SWEEP AND NOT FIVE NAMED STATEMENTS
--   A hand-written list is the defect being fixed; repeating it would reproduce
--   it. The named block below is the auditable record of intent and is what
--   src/lib/db/rls-lockdown.test.ts reconciles against the Drizzle schema on
--   every push. The DO block after it is the executable part, derived from
--   pg_class at apply time, so it also closes anything that drifted in between
--   this file being written and being applied — including a table another branch
--   merges today. It only ever touches tables in `public` that this role owns and
--   that are currently RLS-off, and it names each one it changes.
--
-- IDEMPOTENT. Re-running it is a no-op: ENABLE on an already-enabled table is
--   accepted, and the DO block selects only relrowsecurity = false.
--
-- REVERSIBLE per table with: ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
--
-- APPLY: hand-applied to production on 2026-08-27, ahead of any deploy, because
--   RLS-off plus a browser-reachable anon key is a live hole and waiting for a
--   deploy window would have left it open. Migrations here are not run
--   automatically. THIS IS ALREADY APPLIED — do not apply it a second time
--   expecting it to do something.

-- The five, named. Intent of record; reconciled against the Drizzle schema by
-- src/lib/db/rls-lockdown.test.ts in CI.
ALTER TABLE public.party_wizard_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_profile_comps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concierge_profile_transfers ENABLE ROW LEVEL SECURITY;

-- Derived backstop. Catches any public table that is still RLS-off at apply
-- time, whatever its name and whenever it landed.
DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      -- Never try to alter a table this role does not own; that would abort the
      -- whole migration over something outside its remit.
      AND pg_get_userbyid(c.relowner) = current_user
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    RAISE NOTICE '0038: enabled RLS on public.%', t.relname;
    n := n + 1;
  END LOOP;

  RAISE NOTICE '0038: derived sweep enabled RLS on % additional table(s)', n;

  -- Fail loudly rather than report success over a table left open.
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION '0038: public tables still have RLS disabled after the sweep — '
      'they are owned by another role and need that owner to enable it: %',
      (SELECT string_agg(c.relname || ' (owner ' || pg_get_userbyid(c.relowner) || ')', ', ')
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false);
  END IF;
END $$;
