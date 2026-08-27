/**
 * The test that had to pass before 0038 was applied. Runs entirely inside ONE
 * transaction that is ALWAYS rolled back.
 *
 * WHY A PLAIN "DOES THE APP STILL SEE ROWS" CHECK IS NOT A TEST
 *   The app connects as `postgres`, which has rolbypassrls = true AND owns all
 *   42 public tables. Both of those bypass row security. So "query as the app
 *   role, rows come back" returns the SAME answer whether RLS is on or off — it
 *   is unfalsifiable by construction and proves nothing.
 *
 * WHAT MAKES THIS ONE DISCRIMINATE
 *   Three arms, all against the same tables in the same transaction with RLS
 *   enabled, so the only variable is the role:
 *     ARM 1  postgres      (bypassrls + owner)  -> expect UNCHANGED row counts
 *     ARM 2  anon          (neither)            -> expect ZERO rows
 *     ARM 3  authenticated (neither)            -> expect ZERO rows
 *   ARM 2/3 are the positive control: if they still returned rows, the ALTER
 *   did not take effect and ARM 1's "rows came back" would be meaningless.
 *   ARM 3 is also the demonstrated FAILURE SHAPE: it is literally the app's own
 *   statements returning zero rows. That is what ARM 1 would have looked like
 *   had the app's connection not been a bypassing owner — which is the only way
 *   this change could break the app.
 *
 * WRITES
 *   None. The five ALTER TABLEs are rolled back. DELETE reachability is probed
 *   with EXPLAIN (no ANALYZE), which performs permission checks and applies RLS
 *   at plan time but executes nothing. No row is inserted, updated or deleted.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const FIVE = [
  'party_wizard_links',
  'party_submissions',
  'concierge_profiles',
  'concierge_profile_comps',
  'concierge_profile_transfers',
] as const;

const head = (s: string) => console.log(`\n${'-'.repeat(78)}\n${s}\n${'-'.repeat(78)}`);

type Counts = Record<string, number | string>;

const ROLLBACK_SENTINEL = 'ROLLBACK: discriminating test complete, nothing committed';

async function main() {
  const pre = await sql`SELECT current_user AS u, current_setting('row_security') AS rs`;
  console.log(`connection identity: current_user=${pre[0].u}  row_security=${pre[0].rs}`);
  if (pre[0].u !== 'postgres') {
    throw new Error(`expected the app connection to be postgres, got ${pre[0].u} — stop and re-verify`);
  }

  try {
    await sql.begin(async (tx) => {
      // Tiny tables, but never wait on a lock held by the live cron.
      await tx.unsafe(`SET LOCAL lock_timeout = '5s'`);

      async function countsAs(role: string | null): Promise<Counts> {
        if (role) await tx.unsafe(`SET LOCAL ROLE ${role}`);
        else await tx.unsafe('RESET ROLE');
        const out: Counts = {};
        for (const t of FIVE) {
          try {
            const r = await tx.unsafe(`SELECT count(*)::int AS n FROM public.${t}`);
            out[t] = r[0].n as number;
          } catch (e) {
            out[t] = `ERROR ${e instanceof Error ? e.message.slice(0, 60) : e}`;
          }
        }
        await tx.unsafe('RESET ROLE');
        return out;
      }

      /** EXPLAIN only — plans the DELETE, executes nothing. */
      async function explainDeleteAs(role: string, table: string): Promise<string> {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        let plan: string;
        try {
          const rows = await tx.unsafe(`EXPLAIN DELETE FROM public.${table} WHERE id = -2147483647`);
          plan = rows.map((r) => String(Object.values(r)[0])).join(' | ');
        } catch (e) {
          plan = `ERROR ${e instanceof Error ? e.message : e}`;
        }
        await tx.unsafe('RESET ROLE');
        return plan;
      }

      head('BEFORE — RLS is off on all five');
      const beforePg = await countsAs(null);
      const beforeAnon = await countsAs('anon');
      console.log('as postgres:', beforePg);
      console.log('as anon    :', beforeAnon);
      console.log('\nanon DELETE reachability at the privilege+RLS layer (EXPLAIN, not executed):');
      console.log('  party_wizard_links ->', await explainDeleteAs('anon', 'party_wizard_links'));
      console.log('  party_submissions  ->', await explainDeleteAs('anon', 'party_submissions'));

      head('APPLYING — ENABLE ROW LEVEL SECURITY on the five (will be rolled back)');
      for (const t of FIVE) {
        await tx.unsafe(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
        console.log(`  enabled: ${t}`);
      }
      const state = await tx.unsafe(`
        SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND c.relname = ANY(ARRAY['party_wizard_links','party_submissions',
              'concierge_profiles','concierge_profile_comps','concierge_profile_transfers'])
        ORDER BY 1`);
      console.table(state);

      head('ARM 1 — the application role (postgres: bypassrls + owner). Expect UNCHANGED.');
      const afterPg = await countsAs(null);
      console.log('as postgres:', afterPg);
      const arm1Ok = FIVE.every((t) => afterPg[t] === beforePg[t]);
      console.log(arm1Ok
        ? 'ARM 1 PASS — every count identical to the pre-change baseline'
        : 'ARM 1 FAIL — a count changed for the application role');

      head("ARM 1b — the app's own statements, verbatim shapes from party-wizard-service.ts");
      const svc1 = await tx.unsafe(`
        SELECT id, order_id, role, token_hash, expires_at, revoked_at, used_at
        FROM public.party_wizard_links
        WHERE token_id = (SELECT token_id FROM public.party_wizard_links ORDER BY id LIMIT 1)
        LIMIT 1`);
      console.log(`resolvePartyWizardLink select  -> ${svc1.length} row(s)`,
        svc1.length ? `(link id ${svc1[0].id}, order ${svc1[0].order_id}, role ${svc1[0].role})` : '');
      const svc2 = await tx.unsafe(`
        SELECT o.file_number, o.transaction_type, o.opened_at, p.full_address
        FROM public.orders o
        LEFT JOIN public.order_properties p ON p.order_id = o.id
        WHERE o.id = (SELECT order_id FROM public.party_wizard_links ORDER BY id LIMIT 1)
        LIMIT 1`);
      console.log(`loadOrderContext select        -> ${svc2.length} row(s)`,
        svc2.length ? `(file ${svc2[0].file_number})` : '');
      const svc3 = await tx.unsafe(`
        SELECT submitted_values FROM public.party_submissions
        ORDER BY submitted_at DESC LIMIT 1`);
      console.log(`loadPreviousValues select      -> ${svc3.length} row(s) (table is empty; 0 is correct)`);
      const svcOk = svc1.length === 1 && svc2.length === 1;
      console.log(svcOk
        ? 'ARM 1b PASS — the wizard read path still resolves a real link and its order under RLS'
        : 'ARM 1b FAIL — the wizard read path lost rows under RLS');

      head('ARM 2 — anon (no bypassrls, not owner). Expect ZERO. This is the positive control.');
      const afterAnon = await countsAs('anon');
      console.log('as anon:', afterAnon);
      const arm2Ok = FIVE.every((t) => afterAnon[t] === 0);
      console.log(arm2Ok
        ? 'ARM 2 PASS — anon now sees zero rows on all five, so the ALTER really is enforcing'
        : 'ARM 2 FAIL — anon still sees rows; the change is not doing what it claims');
      console.log(`  (anon saw ${beforeAnon.party_wizard_links} row(s) in party_wizard_links before, ${afterAnon.party_wizard_links} after)`);

      head('ARM 2b — anon DELETE under RLS (EXPLAIN, not executed)');
      console.log('  party_wizard_links ->', await explainDeleteAs('anon', 'party_wizard_links'));
      console.log('  party_submissions  ->', await explainDeleteAs('anon', 'party_submissions'));

      head('ARM 3 — authenticated. Same statements. This is the FAILURE SHAPE, demonstrated.');
      const afterAuth = await countsAs('authenticated');
      console.log('as authenticated:', afterAuth);
      const svcAsAuth = await (async () => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        const r = await tx.unsafe(`
          SELECT id FROM public.party_wizard_links
          WHERE token_id IS NOT NULL LIMIT 1`);
        await tx.unsafe('RESET ROLE');
        return r;
      })();
      console.log(`resolvePartyWizardLink select as authenticated -> ${svcAsAuth.length} row(s)`);
      console.log(
        'This is exactly what ARM 1 would have printed if the app connected as a role\n'
        + 'without BYPASSRLS and without ownership: 0 rows, and the wizard page would 404\n'
        + 'every live token. ARM 1 and ARM 3 run the same SQL against the same tables in the\n'
        + 'same transaction and disagree, which is what makes ARM 1 a result rather than a\n'
        + 'tautology.');

      head('ARM 4 — does FORCE ROW LEVEL SECURITY override BYPASSRLS? (measured, not assumed)');
      await tx.unsafe(`ALTER TABLE public.party_wizard_links FORCE ROW LEVEL SECURITY`);
      const forced = await tx.unsafe(`SELECT count(*)::int AS n FROM public.party_wizard_links`);
      console.log(`as postgres with RLS + FORCE on party_wizard_links -> ${forced[0].n} row(s)`);
      console.log(forced[0].n === beforePg.party_wizard_links
        ? 'BYPASSRLS wins over FORCE, as documented. 0038 does not set FORCE, so this is moot —\n'
          + 'but it means FORCE could not have served as the falsification arm, which is why\n'
          + 'ARM 3 exists.'
        : 'FORCE DID suppress the owner. Worth knowing: never set FORCE on these tables.');
      await tx.unsafe(`ALTER TABLE public.party_wizard_links NO FORCE ROW LEVEL SECURITY`);

      head('VERDICT');
      const pass = arm1Ok && svcOk && arm2Ok
        && FIVE.every((t) => afterAuth[t] === 0) && svcAsAuth.length === 0;
      console.log(pass
        ? 'DISCRIMINATING TEST PASSED — safe to apply 0038 for real.'
        : 'DISCRIMINATING TEST FAILED — do not apply.');

      // Nothing here is meant to survive.
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (e) {
    if (e instanceof Error && e.message === ROLLBACK_SENTINEL) {
      console.log(`\n${e.message}`);
    } else {
      throw e;
    }
  }

  head('POST-ROLLBACK CONFIRMATION — production must be untouched');
  const after = await sql`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY(${[...FIVE]})
    ORDER BY 1
  `;
  console.table(after);
  const counts: Counts = {};
  for (const t of FIVE) {
    const r = await sql.unsafe(`SELECT count(*)::int AS n FROM public.${t}`);
    counts[t] = r[0].n as number;
  }
  console.log('row counts after rollback:', counts);

  await sql.end();
}

main().catch(async (e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
