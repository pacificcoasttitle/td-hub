/**
 * Post-apply verification for 0039, in the only form that can fail.
 *
 * Two arms over the same real tables, in one transaction that is always rolled
 * back:
 *
 *   as postgres      must still read and still hold INSERT/UPDATE/DELETE — this is
 *                    the application's own connection, and it is what breaking
 *                    would look like.
 *   as anon /        must be refused. Same statements, same tables, same
 *   authenticated    transaction, opposite answer. Without this arm the first arm
 *                    returns the same result whether or not the revoke worked, so
 *                    it would not be a test.
 *
 * NOTHING IS WRITTEN. Every write is qualified `WHERE false` or `SELECT ... WHERE
 * false`, which still forces the privilege check but matches no row and consumes
 * no sequence value, and the whole thing is rolled back regardless. TRUNCATE
 * cannot be qualified that way, so TRUNCATE is only ever attempted against the
 * empty throwaway probe table, never a real one.
 */
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local' });

const REAL_TABLE = 'orders';
const PROBE = 'zz_privilege_probe';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1 });

type Tx = postgres.TransactionSql<Record<string, never>>;

async function attempt(tx: Tx, label: string, statement: string) {
  // Each attempt gets its own savepoint: a permission error aborts the
  // transaction otherwise, and the next arm could not run.
  try {
    await tx.savepoint(async (sp: Tx) => {
      await sp.unsafe(statement);
    });
    console.log(`    ${label}: ALLOWED`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.log(`    ${label}: REFUSED  ${e.code ?? ''} ${e.message ?? String(err)}`);
  }
}

let probePresent = false;

async function arm(tx: Tx, role: string | null) {
  const who = role ?? 'postgres (application connection)';
  console.log(`\n  === as ${who} ===`);
  await tx.savepoint(async (sp: Tx) => {
    if (role) await sp.unsafe(`SET LOCAL ROLE ${role}`);
    const cu = await sp.unsafe('SELECT current_user AS u');
    console.log(`    current_user = ${(cu as unknown as { u: string }[])[0].u}`);

    await attempt(sp, `SELECT from ${REAL_TABLE}`, `SELECT count(*) FROM public.${REAL_TABLE}`);
    await attempt(
      sp,
      `INSERT into ${REAL_TABLE} (no rows)`,
      `INSERT INTO public.${REAL_TABLE} SELECT * FROM public.${REAL_TABLE} WHERE false`
    );
    await attempt(
      sp,
      `UPDATE ${REAL_TABLE} (no rows)`,
      `UPDATE public.${REAL_TABLE} SET id = id WHERE false`
    );
    await attempt(sp, `DELETE from ${REAL_TABLE} (no rows)`, `DELETE FROM public.${REAL_TABLE} WHERE false`);
    // TRUNCATE only ever against the empty probe: it cannot be made a no-op, and
    // this is the privilege RLS never covered, so it is the one that matters most.
    // Once the probe has been dropped there is no table it is safe to try this on,
    // so it is skipped rather than pointed at a real one.
    if (probePresent) {
      await attempt(sp, `TRUNCATE ${PROBE} (empty throwaway)`, `TRUNCATE TABLE public.${PROBE}`);
    } else {
      console.log(`    TRUNCATE: SKIPPED — ${PROBE} is gone, and no real table is safe to try it on`);
    }
  });
}

(async () => {
  const probe = await sql`SELECT to_regclass(${'public.' + PROBE}) IS NOT NULL AS present`;
  probePresent = (probe[0] as { present: boolean }).present;
  console.log(`probe table present: ${probePresent}`);

  try {
    await sql.begin(async (tx) => {
      await arm(tx, null);
      await arm(tx, 'anon');
      await arm(tx, 'authenticated');
      throw new Error('__rollback__');
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== '__rollback__') throw err;
    console.log('\n  transaction rolled back — nothing committed by any arm');
  }

  await sql.end({ timeout: 5 });
})().catch(async (err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
