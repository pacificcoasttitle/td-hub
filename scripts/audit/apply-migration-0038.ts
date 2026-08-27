/**
 * Applies src/lib/db/migrations/0038_enable_rls_remaining_public.sql to whatever
 * DATABASE_URL points at. Migrations in this repo are hand-applied — there is no
 * runner — and this exists so that what ran is byte-for-byte the file that was
 * committed, rather than something retyped at a psql prompt.
 *
 * Idempotent: 0038 only enables RLS, and its derived sweep selects on
 * relrowsecurity = false. Re-running it changes nothing.
 *
 * Prints the state of every public table before and after, and surfaces the
 * migration's RAISE NOTICE output so the sweep's decisions are on the record.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATION = '0038_enable_rls_remaining_public.sql';

const notices: string[] = [];
const sql = postgres(process.env.DATABASE_URL!, {
  max: 1,
  prepare: false,
  onnotice: (n) => notices.push(`${n.severity}: ${n.message}`),
});

const head = (s: string) => console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`);

async function rlsState() {
  return sql`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relrowsecurity, c.relname
  `;
}

async function main() {
  const path = join(process.cwd(), 'src', 'lib', 'db', 'migrations', MIGRATION);
  const body = readFileSync(path, 'utf8');
  console.log(`applying ${MIGRATION} (${body.length} bytes) as ${(await sql`SELECT current_user AS u`)[0].u}`);

  head('BEFORE');
  const before = await rlsState();
  const offBefore = before.filter((r) => !r.rls).map((r) => r.table_name);
  console.log(`public tables: ${before.length}  RLS off: ${offBefore.length}`);
  console.log(offBefore.length ? `  ${offBefore.join(', ')}` : '  (none)');

  head('EXECUTING');
  await sql.unsafe(body);
  console.log('migration executed without error');
  console.log(notices.length ? `\nnotices:\n  ${notices.join('\n  ')}` : '\n(no notices)');

  head('AFTER');
  const after = await rlsState();
  const offAfter = after.filter((r) => !r.rls).map((r) => r.table_name);
  const forced = after.filter((r) => r.forced).map((r) => r.table_name);
  console.log(`public tables: ${after.length}  RLS on: ${after.length - offAfter.length}  RLS off: ${offAfter.length}`);
  console.log(`still RLS off: ${offAfter.length ? offAfter.join(', ') : '(none)'}`);
  console.log(`FORCE ROW LEVEL SECURITY set on: ${forced.length ? forced.join(', ') : '(none — correct)'}`);

  const pol = await sql`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`;
  console.log(`policies in public: ${pol[0].n} (0 is correct — this is a blanket deny)`);

  head('APP-ROLE READBACK — the wizard path, live, with RLS now really on');
  const link = await sql`
    SELECT id, order_id, role FROM public.party_wizard_links ORDER BY id LIMIT 1
  `;
  console.log(`party_wizard_links visible to the app role: ${link.length} row(s)`,
    link.length ? `(id ${link[0].id}, order ${link[0].order_id}, role ${link[0].role})` : '');

  if (offAfter.length > 0) {
    throw new Error(`FAILED: ${offAfter.length} public table(s) still RLS-off`);
  }
  console.log('\nOK: every table in public has RLS enabled, no policies, no FORCE.');

  await sql.end();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  if (notices.length) console.error('notices:', notices.join(' | '));
  await sql.end();
  process.exit(1);
});
