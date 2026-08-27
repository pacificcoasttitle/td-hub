/**
 * READ-ONLY. Establishes the facts the RLS lockdown decision rests on, over the
 * application's own connection path (DATABASE_URL, postgres-js, prepare:false)
 * so that "the app's role" means the role the app actually gets, not the role a
 * dashboard session gets.
 *
 * Answers, by query rather than by inference:
 *   1. who the app connects as, and whether that role bypasses RLS
 *   2. which public tables have RLS off, and whether FORCE is set anywhere
 *   3. the grant chain on the RLS-off tables: direct to role, or via PUBLIC,
 *      or via ALTER DEFAULT PRIVILEGES (that difference decides whether a
 *      REVOKE sticks or is re-granted on the next CREATE TABLE)
 *   4. the PostgREST-reachable RPC surface, and whether any of it truncates or
 *      deletes on the caller's behalf
 *
 * Writes nothing. No function is called; definitions are read, never executed.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

const FIVE = [
  'party_wizard_links',
  'party_submissions',
  'concierge_profiles',
  'concierge_profile_comps',
  'concierge_profile_transfers',
];

function head(s: string) {
  console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);
}

async function main() {
  head('1. IDENTITY OF THE APPLICATION CONNECTION');
  const who = await sql`
    SELECT current_user            AS current_user,
           session_user            AS session_user,
           current_database()      AS db,
           current_setting('server_version') AS server_version,
           current_setting('row_security') AS row_security_setting
  `;
  console.log(who[0]);

  const roles = await sql`
    SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
    FROM pg_roles
    WHERE rolname IN ('postgres','anon','authenticated','service_role','authenticator','supabase_admin')
    ORDER BY rolname
  `;
  console.table(roles);

  head('2. ROLE MEMBERSHIP (can the app role SET ROLE to anon/authenticated?)');
  const members = await sql`
    SELECT r.rolname AS role, m.rolname AS member, a.admin_option
    FROM pg_auth_members a
    JOIN pg_roles r ON r.oid = a.roleid
    JOIN pg_roles m ON m.oid = a.member
    WHERE r.rolname IN ('anon','authenticated','service_role')
    ORDER BY r.rolname, m.rolname
  `;
  console.table(members);

  head('3. RLS STATE ACROSS public');
  const rls = await sql`
    SELECT c.relname                AS table_name,
           c.relrowsecurity         AS rls_enabled,
           c.relforcerowsecurity    AS rls_forced,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relrowsecurity, c.relname
  `;
  const off = rls.filter((r) => !r.rls_enabled);
  console.log(`total public tables: ${rls.length}  RLS ON: ${rls.length - off.length}  RLS OFF: ${off.length}`);
  console.log(`FORCE set on: ${rls.filter((r) => r.rls_forced).map((r) => r.table_name).join(', ') || '(none)'}`);
  console.log('RLS OFF tables:');
  console.table(off);
  const owners = [...new Set(rls.map((r) => r.owner))];
  console.log(`distinct owners across public: ${owners.join(', ')}`);

  head('4. POLICIES IN public');
  const pol = await sql`
    SELECT schemaname, tablename, policyname, cmd, roles::text
    FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname
  `;
  console.log(pol.length === 0 ? '(none)' : pol);

  head('5. GRANTS ON THE FIVE — from information_schema.role_table_grants');
  const grants = await sql`
    SELECT table_name, grantee, grantor, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = ANY(${FIVE})
    GROUP BY table_name, grantee, grantor
    ORDER BY table_name, grantee
  `;
  console.table(grants);

  head('5b. DOES anon HOLD TRUNCATE? direct privilege probe (has_table_privilege)');
  const truncProbe = await sql`
    SELECT t.table_name,
           has_table_privilege('anon',          'public.'||t.table_name, 'TRUNCATE') AS anon_truncate,
           has_table_privilege('anon',          'public.'||t.table_name, 'DELETE')   AS anon_delete,
           has_table_privilege('anon',          'public.'||t.table_name, 'SELECT')   AS anon_select,
           has_table_privilege('authenticated', 'public.'||t.table_name, 'TRUNCATE') AS auth_truncate,
           has_table_privilege('authenticated', 'public.'||t.table_name, 'DELETE')   AS auth_delete
    FROM (SELECT unnest(${FIVE}::text[]) AS table_name) t
    ORDER BY t.table_name
  `;
  console.table(truncProbe);

  head('5c. GRANT CHAIN — raw relacl, so PUBLIC vs named-role is visible');
  const acl = await sql`
    SELECT c.relname AS table_name, coalesce(c.relacl::text, '(default: owner only)') AS relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(${FIVE})
    ORDER BY c.relname
  `;
  for (const r of acl) console.log(`${r.table_name}\n    ${r.relacl}`);

  head('5d. ANY GRANT TO PUBLIC anywhere in public schema?');
  const toPublic = await sql`
    SELECT c.relname, a.grantee, a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.grantee = 0
  `;
  console.log(toPublic.length === 0 ? 'no grants to PUBLIC (grantee oid 0) on any public table' : toPublic);

  head('5e. DEFAULT PRIVILEGES — do new tables get these grants automatically?');
  const defacl = await sql`
    SELECT coalesce(pg_get_userbyid(d.defaclrole), '?') AS for_role_creating,
           coalesce(n.nspname, '(all schemas)')          AS in_schema,
           d.defaclobjtype                               AS objtype,
           d.defaclacl::text                             AS acl
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    ORDER BY 1, 2, 3
  `;
  console.log(defacl.length === 0 ? '(no default ACLs configured)' : '');
  console.table(defacl);

  head('5f. SCHEMA-LEVEL grants on public');
  const nspacl = await sql`
    SELECT n.nspname, coalesce(n.nspacl::text, '(default)') AS nspacl
    FROM pg_namespace n WHERE n.nspname IN ('public','graphql_public','storage','auth')
  `;
  for (const r of nspacl) console.log(`${r.nspname}\n    ${r.nspacl}`);

  head('6. WHICH SCHEMAS DOES PostgREST EXPOSE?');
  const pgrst = await sql`
    SELECT rolname, rolconfig::text
    FROM pg_roles
    WHERE rolconfig IS NOT NULL AND rolname IN ('authenticator','postgres','anon','authenticated','service_role')
  `;
  console.table(pgrst);
  const dbSettings = await sql`
    SELECT unnest(setconfig) AS setting
    FROM pg_db_role_setting s
    WHERE EXISTS (SELECT 1 FROM pg_database d WHERE d.oid = s.setdatabase)
       OR s.setdatabase = 0
  `;
  console.log('db/role settings mentioning pgrst or search_path:');
  console.log(dbSettings.map((r) => r.setting).filter((s: string) => /pgrst|search_path/i.test(s)));

  head('7. RPC SURFACE — functions callable in PostgREST-exposed schemas');
  const fns = await sql`
    SELECT n.nspname AS schema,
           p.proname  AS name,
           p.prosecdef AS security_definer,
           p.prokind   AS kind,
           pg_get_function_identity_arguments(p.oid) AS args,
           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','graphql_public')
    ORDER BY n.nspname, p.proname
  `;
  console.log(`functions in public/graphql_public: ${fns.length}`);
  console.table(fns);

  head('7b. DO ANY OF THOSE FUNCTION BODIES TRUNCATE OR DELETE? (definitions read, never called)');
  const dangerous = await sql`
    SELECT n.nspname AS schema, p.proname AS name, p.prosecdef AS security_definer,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','graphql_public')
      AND p.prosrc ~* '(truncate|delete\\s+from|drop\\s+table)'
    ORDER BY 1,2
  `;
  console.log(dangerous.length === 0
    ? 'no function in an exposed schema contains TRUNCATE / DELETE FROM / DROP TABLE'
    : dangerous);

  head('7c. WIDER SWEEP — any SECURITY DEFINER function anywhere that truncates');
  const wide = await sql`
    SELECT n.nspname AS schema, p.proname AS name,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND p.prosrc ~* 'truncate'
      AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY 1,2
  `;
  console.log(wide.length === 0 ? 'none' : wide);

  head('8. BLAST RADIUS — row counts on the five');
  for (const t of FIVE) {
    const r = await sql.unsafe(`SELECT count(*)::int AS n FROM public.${t}`);
    console.log(`${t.padEnd(30)} ${r[0].n} rows`);
  }

  head('9. TRIGGERS on the five (an anon INSERT could fire something)');
  const trig = await sql`
    SELECT c.relname AS table_name, t.tgname, p.proname AS fn, t.tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND c.relname = ANY(${FIVE}) AND NOT t.tgisinternal
    ORDER BY 1,2
  `;
  console.log(trig.length === 0 ? '(no user triggers)' : trig);

  head('10. EVENT TRIGGERS (is anything already auto-applying RLS on CREATE TABLE?)');
  const evt = await sql`SELECT evtname, evtevent, evtenabled, pg_get_userbyid(evtowner) AS owner FROM pg_event_trigger`;
  console.log(evt.length === 0 ? '(none)' : evt);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
