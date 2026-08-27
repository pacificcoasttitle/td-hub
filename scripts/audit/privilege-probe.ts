/**
 * Privilege probe for the anon/authenticated write-grant revoke.
 *
 * Phases are explicit and separately invocable so that nothing destructive can
 * happen as a side effect of asking a question:
 *
 *   baseline      read-only. Roles, owners, pg_default_acl, per-table grant matrix.
 *   create-probe  CREATE TABLE public.zz_privilege_probe + ENABLE RLS. Then reports
 *                 the grants it was BORN with — the evidence that a revoke on the
 *                 42 existing tables has a shelf life of one CREATE TABLE.
 *   revoke-probe  REVOKE the write privileges on the probe table only.
 *   restore-probe Put them back. This is the rollback rehearsal (Job 3).
 *   drop-probe    DROP TABLE public.zz_privilege_probe.
 *
 * Reads DATABASE_URL from the main working tree's .env.local by absolute path so
 * that no secret is copied into this worktree.
 *
 * Prints no secret values. Connection string is never echoed.
 */
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local' });

const PROBE = 'zz_privilege_probe';
// MAINTAIN is the `m` in arwdDxtm. It is not a data write, but it carries
// VACUUM / ANALYZE / CLUSTER / REINDEX / REFRESH MATERIALIZED VIEW, two of which
// take ACCESS EXCLUSIVE locks. Nothing legitimate needs it: the application
// connects as the table owner.
const WRITE_PRIVS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
] as const;
const ALL_PRIVS = ['SELECT', ...WRITE_PRIVS] as const;
const GRANTEES = ['anon', 'authenticated', 'service_role'] as const;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set (expected in the main tree .env.local)');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

type Row = Record<string, unknown>;

function table(rows: Row[]) {
  if (rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  for (const r of rows) {
    console.log(
      '  ' +
        Object.entries(r)
          .map(([k, v]) => `${k}=${v === null ? 'NULL' : String(v)}`)
          .join('  ')
    );
  }
}

async function privMatrix(relname: string) {
  const rows = await sql<Row[]>`
    SELECT g.grantee,
           string_agg(p.priv, ',' ORDER BY p.ord) FILTER (
             WHERE has_table_privilege(g.grantee, ${'public.' + relname}, p.priv)
           ) AS held
    FROM (SELECT unnest(${sql.array(GRANTEES as unknown as string[])}::text[]) AS grantee) g
    CROSS JOIN (
      SELECT * FROM unnest(${sql.array(ALL_PRIVS as unknown as string[])}::text[])
        WITH ORDINALITY AS t(priv, ord)
    ) p
    GROUP BY g.grantee
    ORDER BY g.grantee
  `;
  return rows;
}

async function baseline() {
  console.log('=== connection ===');
  table(
    await sql<Row[]>`SELECT current_user, session_user, current_database(),
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`
  );

  console.log('\n=== grantee roles ===');
  table(
    await sql<Row[]>`SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin',
                        'supabase_auth_admin','authenticator')
      ORDER BY rolname`
  );

  console.log('\n=== public schema relations by kind and owner ===');
  table(
    await sql<Row[]>`SELECT c.relkind, pg_get_userbyid(c.relowner) AS owner, count(*)::int AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
      GROUP BY 1,2 ORDER BY 1,2`
  );

  console.log('\n=== RLS status across public tables ===');
  table(
    await sql<Row[]>`SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS forced,
      count(*)::int AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
      GROUP BY 1,2 ORDER BY 1,2`
  );

  console.log('\n=== policies on public tables ===');
  table(await sql<Row[]>`SELECT count(*)::int AS policy_count FROM pg_policies WHERE schemaname = 'public'`);

  console.log('\n=== pg_default_acl entries (the second layer) ===');
  table(
    await sql<Row[]>`SELECT pg_get_userbyid(d.defaclrole) AS creator, ns.nspname AS schema,
      d.defaclobjtype AS objtype, d.defaclacl::text AS acl
      FROM pg_default_acl d LEFT JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
      ORDER BY 1,2,3`
  );

  console.log('\n=== per-privilege counts: how many public tables grant each priv ===');
  table(
    await sql<Row[]>`
      SELECT g.grantee, p.priv, count(*)::int AS tables_granting
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated','service_role']) AS grantee) g
      CROSS JOIN (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv) p
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
        AND has_table_privilege(g.grantee, c.oid, p.priv)
      GROUP BY 1,2 ORDER BY 1,2`
  );

  console.log('\n=== total public tables ===');
  table(
    await sql<Row[]>`SELECT count(*)::int AS n FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r'`
  );

  console.log('\n=== grants routed via PUBLIC pseudo-role on public tables ===');
  table(
    await sql<Row[]>`SELECT count(*)::int AS tables_with_public_acl FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
        AND array_to_string(c.relacl, ',') LIKE '%=%' AND array_to_string(c.relacl, ',') ~ '(^|,)=' `
  );

  console.log('\n=== triggers on auth.users (side-effect awareness, not a change) ===');
  table(
    await sql<Row[]>`SELECT t.tgname, p.proname, n.nspname AS proc_schema
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ns.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal`
  );

  console.log('\n=== auth schema ownership (why public grants should be irrelevant to login) ===');
  table(
    await sql<Row[]>`SELECT pg_get_userbyid(c.relowner) AS owner, count(*)::int AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'auth' AND c.relkind = 'r' GROUP BY 1 ORDER BY 1`
  );
  table(
    await sql<Row[]>`SELECT g.grantee, count(*)::int AS auth_tables_selectable
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      CROSS JOIN (SELECT unnest(ARRAY['anon','authenticated','service_role']) AS grantee) g
      WHERE ns.nspname = 'auth' AND c.relkind = 'r'
        AND has_table_privilege(g.grantee, c.oid, 'SELECT')
      GROUP BY 1 ORDER BY 1`
  );

  console.log('\n=== exposed schemas usable by anon (PostgREST surface) ===');
  table(
    await sql<Row[]>`SELECT nspname, has_schema_privilege('anon', oid, 'USAGE') AS anon_usage
      FROM pg_namespace
      WHERE nspname IN ('public','graphql','graphql_public','storage','auth','extensions','realtime')
      ORDER BY nspname`
  );
}

async function createProbe() {
  const exists = await sql<Row[]>`SELECT to_regclass(${'public.' + PROBE}) AS oid`;
  if (exists[0]?.oid !== null) {
    console.error(`public.${PROBE} already exists — refusing to recreate. Inspect or drop it first.`);
    process.exit(1);
  }

  await sql.begin(async (tx) => {
    await tx.unsafe(`CREATE TABLE public.${PROBE} (id integer PRIMARY KEY, note text)`);
    // Mirror every real table: RLS on, no policies. A new table is born RLS-off,
    // so leaving it that way would put an open table in public, however briefly.
    await tx.unsafe(`ALTER TABLE public.${PROBE} ENABLE ROW LEVEL SECURITY`);
    await tx.unsafe(`COMMENT ON TABLE public.${PROBE} IS 'throwaway privilege probe; drop me'`);
  });
  console.log(`created public.${PROBE} with RLS enabled, no policies`);

  console.log('\n=== grants the NEW table was BORN with (raw relacl) ===');
  table(
    await sql<Row[]>`SELECT unnest(c.relacl)::text AS acl_entry
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = ${PROBE}`
  );

  console.log('\n=== effective privileges on the new table ===');
  table(await privMatrix(PROBE));

  console.log('\n=== does an INSERT row exist? (probe stays empty; no data written) ===');
  table(await sql.unsafe(`SELECT count(*)::int AS rows FROM public.${PROBE}`));
}

async function revokeProbe() {
  await sql.unsafe(
    `REVOKE ${WRITE_PRIVS.join(', ')} ON TABLE public.${PROBE} FROM anon, authenticated`
  );
  console.log(`revoked ${WRITE_PRIVS.join(', ')} on public.${PROBE} from anon, authenticated`);
  console.log('\n=== effective privileges after revoke ===');
  table(await privMatrix(PROBE));
  console.log('\n=== raw relacl after revoke ===');
  table(
    await sql<Row[]>`SELECT unnest(c.relacl)::text AS acl_entry
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = ${PROBE}`
  );
}

async function restoreProbe() {
  await sql.unsafe(
    `GRANT SELECT, ${WRITE_PRIVS.join(', ')} ON TABLE public.${PROBE} TO anon, authenticated`
  );
  console.log(`re-granted SELECT + ${WRITE_PRIVS.join(', ')} on public.${PROBE}`);
  console.log('\n=== effective privileges after restore (rollback rehearsal) ===');
  table(await privMatrix(PROBE));
}

/**
 * Measures the cost of the SELECT decision on the disposable table rather than
 * arguing it: what does PostgREST do for a table anon cannot read at all?
 */
async function selectRevokeProbe() {
  await sql.unsafe(`REVOKE SELECT ON TABLE public.${PROBE} FROM anon, authenticated`);
  console.log(`revoked SELECT on public.${PROBE} from anon, authenticated`);
  table(await privMatrix(PROBE));
}

async function selectRestoreProbe() {
  await sql.unsafe(`GRANT SELECT ON TABLE public.${PROBE} TO anon, authenticated`);
  console.log(`re-granted SELECT on public.${PROBE}`);
  table(await privMatrix(PROBE));
}

/**
 * Can this role remove the pg_default_acl entries at all? There are entries for
 * two different creator roles, and ALTER DEFAULT PRIVILEGES FOR ROLE <x> requires
 * membership in <x>. A revoke issued as the wrong creator does nothing and looks
 * like success, so this asks the question before the migration depends on it.
 *
 * The ALTER is executed and then rolled back, so the answer is measured rather
 * than inferred, without committing anything.
 */
async function membership() {
  console.log('=== role memberships of current_user ===');
  table(
    await sql<Row[]>`SELECT r.rolname AS member_of, m.admin_option
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
      WHERE u.rolname = current_user ORDER BY 1`
  );

  for (const creator of ['postgres', 'supabase_admin']) {
    console.log(`\n=== rolled-back trial: ALTER DEFAULT PRIVILEGES FOR ROLE ${creator} ===`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${creator} IN SCHEMA public ` +
            `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated`
        );
        const after = await tx<Row[]>`SELECT d.defaclacl::text AS acl
          FROM pg_default_acl d JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
          WHERE ns.nspname = 'public' AND d.defaclobjtype = 'r'
            AND pg_get_userbyid(d.defaclrole) = ${creator}`;
        console.log(`  ACCEPTED. in-transaction acl now:`);
        table(after);
        throw new Error('__rollback__');
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === '__rollback__') {
        console.log('  rolled back (no change committed)');
      } else {
        console.log(`  REFUSED: ${msg}`);
      }
    }
  }

  console.log('\n=== pg_default_acl for public, unchanged afterwards ===');
  table(
    await sql<Row[]>`SELECT pg_get_userbyid(d.defaclrole) AS creator, d.defaclobjtype AS objtype,
      d.defaclacl::text AS acl
      FROM pg_default_acl d JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
      WHERE ns.nspname = 'public' ORDER BY 1,2`
  );
}

async function dropProbe() {
  await sql.unsafe(`DROP TABLE IF EXISTS public.${PROBE}`);
  console.log(`dropped public.${PROBE}`);
  table(await sql<Row[]>`SELECT to_regclass(${'public.' + PROBE}) AS still_there`);
}

const phase = process.argv[2];
const phases: Record<string, () => Promise<void>> = {
  baseline,
  'create-probe': createProbe,
  'revoke-probe': revokeProbe,
  'restore-probe': restoreProbe,
  'select-revoke-probe': selectRevokeProbe,
  'select-restore-probe': selectRestoreProbe,
  membership,
  'drop-probe': dropProbe,
};

(async () => {
  const fn = phase ? phases[phase] : undefined;
  if (!fn) {
    console.error(`usage: tsx scripts/audit/privilege-probe.ts <${Object.keys(phases).join('|')}>`);
    process.exit(2);
  }
  try {
    await fn();
  } finally {
    await sql.end({ timeout: 5 });
  }
})().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
