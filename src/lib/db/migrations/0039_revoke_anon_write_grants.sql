-- 0039 — SECURITY: take the write privileges off anon/authenticated in public,
--        at both layers, so the revoke survives the next CREATE TABLE.
--
-- WHY
--   0032 and 0038 enabled RLS on all 42 public tables with no policies, which
--   denies anon and authenticated every SELECT, INSERT, UPDATE and DELETE. That
--   closed the reachable hole. It did not close two things:
--
--   1. TRUNCATE is never subject to row security. Row security covers SELECT,
--      INSERT, UPDATE and DELETE only; TRUNCATE is gated solely by the privilege.
--      anon held TRUNCATE on all 42 tables, and RLS did nothing about it. Same for
--      REFERENCES, TRIGGER and MAINTAIN, which are also privilege-only.
--   2. Four `ALTER DEFAULT PRIVILEGES` entries on schema public re-grant the whole
--      set to anon/authenticated/service_role on every newly created table, so a
--      revoke on the 42 existing tables would have had a shelf life of exactly one
--      CREATE TABLE.
--
--   Measured, not assumed. A throwaway table was created immediately before this
--   migration was written (public.zz_privilege_probe, created and dropped in the
--   same session) purely to establish (2). It was born with:
--
--     postgres=arwdDxtm/postgres
--     anon=arwdDxtm/postgres
--     authenticated=arwdDxtm/postgres
--     service_role=arwdDxtm/postgres
--
--   That is every privilege including TRUNCATE, on a table that had existed for
--   under a second, with nobody having granted anything.
--
-- WHICH PRIVILEGES, AND WHY EACH ONE
--   Revoked from anon and authenticated: INSERT, UPDATE, DELETE, TRUNCATE,
--   REFERENCES, TRIGGER, MAINTAIN. That is `arwdDxtm` minus `r`.
--
--     INSERT/UPDATE/DELETE  the stated target. RLS already denies them; this is the
--                           second, independent layer, and the one that still holds
--                           if RLS ever drifts off a table again — which is exactly
--                           what happened to five tables between 0032 and 0038.
--     TRUNCATE              the actual gap. Not covered by RLS at any time.
--     REFERENCES            lets the role create a foreign key against the table,
--                           which leaks values through constraint violations and
--                           constrains what the owner can then change.
--     TRIGGER               lets the role attach a trigger to a table it does not
--                           own. That trigger body then runs during the owner's
--                           writes. It is the worst of the six and nothing needs it.
--     MAINTAIN              the `m`, on PG17+. Not a data write, but it carries
--                           VACUUM / ANALYZE / CLUSTER / REINDEX / REFRESH
--                           MATERIALIZED VIEW, and VACUUM FULL and CLUSTER take
--                           ACCESS EXCLUSIVE locks. An availability lever with no
--                           legitimate caller: the application connects as the
--                           table owner and does not need to be granted anything.
--
--   NOT revoked, deliberately:
--
--     SELECT on tables      kept. RLS with no policies already returns zero rows to
--                           anon (measured: GET /rest/v1/orders -> HTTP 200 []), so
--                           the grant conveys no read capability today. Revoking it
--                           was measured on the throwaway table and is NOT
--                           disruptive — the PostgREST OpenAPI document was
--                           byte-identical (301856 bytes, 44 paths, 43 definitions)
--                           and anon reads changed from `200 []` to a clean
--                           `401 42501 permission denied` — so this is a matter of
--                           choice, not of capability. It is left in place tonight
--                           because it is the one privilege whose removal changes
--                           what an outside caller observes on all 42 tables at
--                           once, and the Supabase dashboard UI could not be
--                           exercised in this session to confirm it does not read
--                           through the anon key. Revoking SELECT is the right next
--                           step in daylight, with the dashboard open; see
--                           docs/security/OPEN_SECURITY_ITEMS.md item 7.
--     service_role          untouched. Its key is server-side only
--                           (SUPABASE_SERVICE_ROLE_KEY, no NEXT_PUBLIC_ prefix,
--                           read only in src/lib/security/supabase-admin.ts) and it
--                           is the credential the admin client uses. Revoking it
--                           has no upside — service_role also has
--                           rolbypassrls = true, so RLS is not what protects
--                           against that key either; guarding the key is.
--
-- WHY IT IS A NO-OP FOR THE APPLICATION
--   The app connects as `postgres` (src/lib/db/client.ts, DATABASE_URL), which owns
--   all 42 tables. An owner's access does not come from a GRANT, so revoking
--   anon/authenticated grants cannot touch it. Independently: no application code
--   reaches any table through PostgREST — every Supabase client call in src/ is
--   `supabase.auth.*` (signInWithPassword, signOut, getUser, auth.admin.createUser,
--   auth.admin.generateLink). Re-verified by catalog sweep for this migration:
--   zero `.from(`, `.rpc(`, `.storage`, `.channel` calls on any Supabase client.
--
--   Login is unaffected because it is a different schema and a different role: all
--   23 auth tables are owned by supabase_auth_admin, GoTrue connects as that role,
--   and anon/authenticated hold SELECT on ZERO tables in `auth` (measured). The
--   dashboard is unaffected for the same kind of reason: the Management API path
--   that the SQL and table editors use connects as `postgres` with
--   rolbypassrls = true (measured by running `select current_user` through it).
--
-- WHY IT IS A CATALOG SWEEP AND NOT A LIST OF 42 NAMES
--   0032's hand-written enumeration is what let five tables drift RLS-off, and
--   0038 was the cleanup. Repeating the pattern here would reproduce the defect,
--   and it would reproduce it in a worse place: a table missing from this list
--   keeps TRUNCATE, silently. Both blocks below derive their target set from the
--   catalog at apply time and name every object they touch.
--
-- THE ONE THING THIS MIGRATION CANNOT DO
--   There are six `ALTER DEFAULT PRIVILEGES` entries on schema public, not four:
--   creators `postgres` and `supabase_admin`, each for tables (r), sequences (S)
--   and functions (f). This migration handles TABLES. For the creator role
--   `supabase_admin` it will fail and say so, because `ALTER DEFAULT PRIVILEGES FOR
--   ROLE x` requires membership in x and `postgres` is not a member of
--   `supabase_admin` — attempted in a rolled-back transaction before writing this:
--   `permission denied to change default privileges`. That entry only applies to
--   objects created BY supabase_admin in public (Supabase platform tooling, not
--   this application and not the dashboard, which runs as postgres), so the
--   residual is narrow — but it is real and it needs someone with that role.
--   Recorded as docs/security/OPEN_SECURITY_ITEMS.md item 7 rather than papered
--   over here. The block below WARNS rather than raising, so one unreachable entry
--   cannot roll back the part that does work.
--
-- IDEMPOTENT. REVOKE of a privilege not held is a no-op, and the sweeps are
--   derived from the catalog each time.
--
-- REVERSIBLE. Full rollback, executable as `postgres` and rehearsed against the
--   throwaway table before any real table was touched:
--
--     GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--       GRANT ALL ON TABLES TO anon, authenticated;
--
--   (`ALL` is used on purpose in the rollback: it restores whatever the server
--   version defines, including MAINTAIN, without this file having to enumerate it.)
--
-- APPLY: hand-applied to production on 2026-08-27, before this branch was pushed.
--   Migrations here are not run automatically. THIS IS ALREADY APPLIED — applying
--   it again is harmless but will do nothing.

-- ---------------------------------------------------------------------------
-- Layer 1: the 42 tables that exist now.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  privs  text := 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
  t      record;
  n      int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '0039: roles anon and/or authenticated do not exist — this is '
      'not a Supabase database and this migration does not apply to it';
  END IF;

  -- MAINTAIN did not exist before PG17. Asking for it on an older server is a
  -- syntax error, which would abort the whole migration over a privilege that
  -- cannot be held there anyway.
  IF current_setting('server_version_num')::int >= 170000 THEN
    privs := privs || ', MAINTAIN';
  END IF;

  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      -- Never REVOKE on a table this role does not own: it would warn, do
      -- nothing, and still count as a success.
      AND pg_get_userbyid(c.relowner) = current_user
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE %s ON TABLE public.%I FROM anon, authenticated', privs, t.relname);
    n := n + 1;
  END LOOP;

  RAISE NOTICE '0039: revoked [%] from anon, authenticated on % table(s) in public', privs, n;
END $$;

-- ---------------------------------------------------------------------------
-- Layer 2: the default privileges, or layer 1 lasts until the next CREATE TABLE.
-- Issued once per creator role that actually has an entry. A revoke issued as the
-- wrong creator does nothing and looks identical to success, which is why this is
-- driven off pg_default_acl instead of being written out by hand.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  privs    text := 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
  d        record;
  done     text[] := '{}';
  blocked  text[] := '{}';
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    privs := privs || ', MAINTAIN';
  END IF;

  FOR d IN
    SELECT pg_get_userbyid(da.defaclrole) AS creator
    FROM pg_default_acl da
    JOIN pg_namespace ns ON ns.oid = da.defaclnamespace
    WHERE ns.nspname = 'public'
      AND da.defaclobjtype = 'r'
      AND array_to_string(da.defaclacl, ',') ~ '(^|,)(anon|authenticated)='
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE %s ON TABLES FROM anon, authenticated', d.creator, privs);
      done := done || d.creator;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Requires membership in the creator role. Warn and carry on: aborting here
      -- would also throw away the entries that CAN be fixed.
      blocked := blocked || d.creator;
    END;
  END LOOP;

  IF array_length(done, 1) IS NOT NULL THEN
    RAISE NOTICE '0039: default privileges on TABLES revoked for creator role(s): %',
      array_to_string(done, ', ');
  END IF;
  IF array_length(blocked, 1) IS NOT NULL THEN
    RAISE WARNING '0039: could NOT alter default privileges for creator role(s): % '
      '— current_user (%) is not a member of them. A table created BY that role in '
      'public will still be born with write grants for anon/authenticated. Tracked '
      'as OPEN_SECURITY_ITEMS.md item 7; needs a role with that membership.',
      array_to_string(blocked, ', '), current_user;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verify, and fail if layer 1 did not actually take. Reporting success over a
-- table that kept TRUNCATE is the one outcome worse than not running this.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  offenders text;
  remaining text;
BEGIN
  SELECT string_agg(DISTINCT c.relname || ' (' || g.grantee || ': ' || p.priv || ')', ', ')
    INTO offenders
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  CROSS JOIN (SELECT unnest(ARRAY['anon', 'authenticated']) AS grantee) g
  CROSS JOIN (SELECT unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv) p
  WHERE ns.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND pg_get_userbyid(c.relowner) = current_user
    AND has_table_privilege(g.grantee, c.oid, p.priv);

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION '0039: write privileges still held after the revoke: %', offenders;
  END IF;

  SELECT string_agg(pg_get_userbyid(da.defaclrole) || ' -> ' || da.defaclacl::text, ' | ')
    INTO remaining
  FROM pg_default_acl da
  JOIN pg_namespace ns ON ns.oid = da.defaclnamespace
  WHERE ns.nspname = 'public' AND da.defaclobjtype = 'r';

  -- Informational. The entries do not disappear, because SELECT is deliberately
  -- kept: an entry vanishes from pg_default_acl only when its ACL returns to the
  -- built-in default, which `anon=r` is not. What must be gone is every write
  -- letter, and the exception above is what enforces that.
  RAISE NOTICE '0039: pg_default_acl for public TABLES now: %', coalesce(remaining, '(none)');
END $$;
