/**
 * DRIFT GUARD, layer 2 of 2.  `npm run db:verify-rls`
 *
 * Layer 1 (src/lib/db/rls-lockdown.test.ts) runs in CI with no credentials and
 * can only see source files. It cannot see whether a migration was applied, and
 * it cannot see a table that exists only in the database. This closes both, by
 * asking the database directly.
 *
 * IT CANNOT RUN IN CI. GitHub Actions has no production database credentials and
 * should not be given any. So this is a command a human runs — after applying a
 * lockdown migration, and periodically.
 *
 * IT DOES NOT SKIP. Without DATABASE_URL it exits 2 with a banner. A check that
 * quietly passes when it could not run is worse than no check: it manufactures
 * the impression of coverage. Every failure path here is a non-zero exit.
 *
 * READ-ONLY. Catalog queries only. It reports what is wrong; it changes nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const SCHEMA_DIR = join(process.cwd(), 'src', 'lib', 'db', 'schema');

function loudExit(reason: string, code: number): never {
  const bar = '#'.repeat(78);
  console.error(`\n${bar}\n#  RLS VERIFICATION DID NOT RUN\n#\n#  ${reason}\n#\n`
    + `#  This is a failure, not a skip. Nothing about production RLS was checked.\n${bar}\n`);
  process.exit(code);
}

if (!process.env.DATABASE_URL) {
  loudExit('DATABASE_URL is not set. Run with: npx tsx --env-file=.env.local '
    + 'scripts/audit/verify-rls-production.ts', 2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });

function drizzleTableNames(): Set<string> {
  const names = new Set<string>();
  let loose = 0;
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const body = readFileSync(join(SCHEMA_DIR, f), 'utf8');
    loose += (body.match(/\bpgTable\s*\(/g) ?? []).length;
    for (const m of body.matchAll(/\bpgTable\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) names.add(m[1]);
  }
  if (loose === 0 || names.size !== loose) {
    loudExit(`could not parse the Drizzle schema (${loose} pgTable calls, ${names.size} names). `
      + 'Refusing to report on a schema set it does not understand.', 2);
  }
  return names;
}

const head = (s: string) => console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

async function main() {
  const failures: string[] = [];

  const ident = await sql`SELECT current_user AS u, current_database() AS db`;
  console.log(`connected to ${ident[0].db} as ${ident[0].u}`);

  head('1. RLS ON EVERY TABLE IN public');
  const tables = await sql`
    SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `;
  const off = tables.filter((t) => !t.rls).map((t) => String(t.name));
  console.log(`${tables.length} tables, RLS on ${tables.length - off.length}, RLS off ${off.length}`);
  if (off.length) {
    failures.push(`RLS is OFF on: ${off.join(', ')}`);
  } else {
    console.log('  all enabled');
  }

  head('2. FORCE ROW LEVEL SECURITY IS NOT SET');
  const forced = tables.filter((t) => t.forced).map((t) => String(t.name));
  console.log(forced.length ? `  set on: ${forced.join(', ')}` : '  not set on any table (correct)');
  if (forced.length) {
    failures.push(`FORCE ROW LEVEL SECURITY is set on ${forced.join(', ')} — the app owns these `
      + 'tables and there are no policies, so this is one role-attribute change away from '
      + 'denying the application itself');
  }

  head('3. THE APP ROLE STILL BYPASSES — otherwise RLS-on means an outage');
  const role = await sql`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  const ownedByMe = tables.filter((t) => t.owner === ident[0].u).length;
  console.log(`  ${role[0].rolname}: rolsuper=${role[0].rolsuper} rolbypassrls=${role[0].rolbypassrls}`);
  console.log(`  owns ${ownedByMe}/${tables.length} public tables`);
  if (!role[0].rolbypassrls && !role[0].rolsuper && ownedByMe < tables.length) {
    failures.push('the application role neither bypasses RLS nor owns every table, and there '
      + 'are policies to satisfy — reads will be silently empty');
  }

  head('4. DATABASE VS DRIZZLE SCHEMA — the gap layer 1 cannot see');
  const schemaNames = drizzleTableNames();
  const dbNames = new Set(tables.map((t) => String(t.name)));
  const dbOnly = [...dbNames].filter((t) => !schemaNames.has(t)).sort();
  const schemaOnly = [...schemaNames].filter((t) => !dbNames.has(t)).sort();
  console.log(`  drizzle schema declares ${schemaNames.size}, database has ${dbNames.size}`);
  console.log(`  in the database but NOT in the schema: ${dbOnly.length ? dbOnly.join(', ') : '(none)'}`);
  console.log(`  in the schema but NOT in the database: ${schemaOnly.length ? schemaOnly.join(', ') : '(none)'}`);
  if (dbOnly.length) {
    failures.push(`${dbOnly.length} table(s) exist in the database but not in the Drizzle schema `
      + `(${dbOnly.join(', ')}) — the CI guard is blind to these, so they can only be caught here`);
  }
  if (schemaOnly.length) {
    console.log('  (schema-only tables are usually just not pushed yet; not treated as a failure)');
  }

  head('5. POLICIES — this is a blanket deny, so zero is expected');
  const pol = await sql`
    SELECT tablename, policyname, cmd, roles::text FROM pg_policies
    WHERE schemaname = 'public' ORDER BY tablename, policyname
  `;
  console.log(`  ${pol.length} policy/policies in public`);
  if (pol.length) {
    console.table(pol);
    console.log('  Policies are not a failure — but each one is a grant of access that someone');
    console.log('  must be able to name a caller for. Review them.');
  }

  head('6. GRANTS TO anon / authenticated — reported, not enforced (open item)');
  const grants = await sql`
    SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs,
           count(DISTINCT table_name)::int AS tables
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
    GROUP BY grantee ORDER BY grantee
  `;
  console.table(grants);
  const defacl = await sql`
    SELECT pg_get_userbyid(d.defaclrole) AS creator,
           a.grantee::regrole::text AS grantee,
           string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
      AND a.grantee::regrole::text IN ('anon', 'authenticated')
    GROUP BY 1, 2 ORDER BY 1, 2
  `;
  console.log('\n  ALTER DEFAULT PRIVILEGES — what a NEW table gets automatically:');
  console.table(defacl);
  console.log('  These are why revoking on existing tables alone would not hold: the next');
  console.log('  CREATE TABLE re-grants. Revoking is not authorised yet — see');
  console.log('  docs/security/OPEN_SECURITY_ITEMS.md item 6.');

  head('VERDICT');
  if (failures.length) {
    console.error(`FAIL — ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  * ${f}`);
    await sql.end();
    process.exit(1);
  }
  console.log('PASS — every public table has RLS enabled, FORCE is set nowhere, the app role');
  console.log('still bypasses, and the database and the Drizzle schema agree on the table set.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
