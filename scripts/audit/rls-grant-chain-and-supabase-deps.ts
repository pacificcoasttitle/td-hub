/**
 * READ-ONLY, part two of scripts/audit/rls-facts.ts.
 *
 * The parts that decide the *grants* question rather than the RLS question:
 *   - the ALTER DEFAULT PRIVILEGES entries for `public`, in full, because they
 *     are what re-grants anon/authenticated on every future CREATE TABLE and
 *     therefore what decides whether a REVOKE sticks
 *   - whether this role could install an event trigger (the other candidate
 *     drift fix), which needs superuser
 *   - which Supabase-managed features actually reference the five tables:
 *     logical replication publications (Realtime), pg_cron, pg_graphql
 *
 * Writes nothing.
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

const head = (s: string) => console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

async function main() {
  head('A. DEFAULT PRIVILEGES for schema public, in full');
  const defacl = await sql`
    SELECT pg_get_userbyid(d.defaclrole) AS when_this_role_creates,
           n.nspname                     AS in_schema,
           d.defaclobjtype               AS objtype,
           d.defaclacl::text             AS acl
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public'
    ORDER BY 1, 3
  `;
  for (const r of defacl) {
    console.log(`\n  when ${r.when_this_role_creates} creates a ${r.objtype} in ${r.in_schema}:`);
    console.log(`    ${r.acl}`);
  }

  head('A2. Decoded: does a NEW table created by postgres in public auto-grant anon?');
  const decoded = await sql`
    SELECT pg_get_userbyid(d.defaclrole) AS creator,
           a.grantee::regrole::text      AS grantee,
           string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  console.table(decoded);

  head('B. Could this role install an event trigger to auto-enable RLS?');
  const su = await sql`
    SELECT rolname, rolsuper, rolcreaterole, rolcreatedb
    FROM pg_roles WHERE rolname = current_user
  `;
  console.log(su[0]);
  console.log('CREATE EVENT TRIGGER requires superuser. rolsuper above is the answer.');

  head('C. LOGICAL REPLICATION PUBLICATIONS (this is what Realtime rides on)');
  const pubs = await sql`SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate FROM pg_publication`;
  console.table(pubs);
  const pubtabs = await sql`
    SELECT p.pubname, n.nspname AS schema, c.relname AS table_name
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    ORDER BY 1, 2, 3
  `;
  console.log(pubtabs.length === 0 ? 'no tables explicitly in any publication' : '');
  console.table(pubtabs);
  console.log('any of the five in a publication?',
    pubtabs.filter((r) => FIVE.includes(String(r.table_name))).map((r) => r.table_name).join(', ') || 'NO');

  head('D. REALTIME subscriptions currently registered');
  const rt = await sql`
    SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'subscription'
  `;
  if (rt[0].n > 0) {
    const subs = await sql`SELECT count(*)::int AS active_subscriptions FROM realtime.subscription`;
    console.log(subs[0]);
  } else {
    console.log('realtime.subscription table not present');
  }

  head('E. pg_cron jobs (a cron is actively writing order_parties; do not disturb)');
  const cronExists = await sql`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_cron'`;
  if (cronExists[0].n > 0) {
    const jobs = await sql`SELECT jobid, schedule, jobname, database, username, active FROM cron.job ORDER BY jobid`;
    console.table(jobs);
  } else {
    console.log('pg_cron not installed in this database');
  }

  head('F. Does anything OTHER than the app hold a session as anon/authenticated right now?');
  const act = await sql`
    SELECT usename, application_name, count(*)::int AS n, state
    FROM pg_stat_activity
    GROUP BY 1, 2, 4 ORDER BY n DESC
  `;
  console.table(act);

  head('G. The one exposed RPC: graphql_public.graphql — read its definition');
  const g = await sql`
    SELECT p.prosecdef AS security_definer, p.provolatile, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'graphql_public' AND p.proname = 'graphql'
  `;
  console.log('security definer:', g[0]?.security_definer, ' volatility:', g[0]?.provolatile);
  console.log(g[0]?.def);

  head('H. Sanity: are the five reachable through pg_graphql? (comment-based opt-in)');
  const gqlComment = await sql`
    SELECT obj_description(c.oid, 'pg_class') AS comment, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(${FIVE})
  `;
  console.table(gqlComment);

  head('I. Views / matviews in public that could leak the five past RLS');
  const views = await sql`
    SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
           c.reloptions::text AS options
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY 1
  `;
  console.log(views.length === 0 ? 'no views or materialized views in public' : '');
  console.table(views);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
