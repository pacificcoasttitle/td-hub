/**
 * Apply 0062 to production, for keeps, and prove it landed.
 *
 * ─── WHY THIS GOES BEFORE THE CODE, NOT AFTER ───────────────────────────────
 *
 * Drizzle's `select()` with no projection names every column in the schema. The
 * moment the branch deploys, renderProfile would ask for tax_report and the
 * query would fail — so applying this late does not degrade page 4, it breaks
 * EVERY render, including profiles that have nothing to do with tax.
 *
 * ─── WHY IT IS SAFE TO APPLY AHEAD OF THE CODE ──────────────────────────────
 *
 * Purely additive: eleven new columns and two partial indexes. Nothing is
 * renamed, dropped, widened or constrained, and no existing value is touched.
 * The two NOT NULL columns carry defaults (false, 0), so every existing row
 * reads exactly as it does today. The code currently in production does not
 * reference any of them.
 *
 * ─── WHAT WOULD MAKE THIS THE WRONG THING TO RUN ────────────────────────────
 *
 * It stops rather than guessing if the columns already exist, on the same
 * reasoning as apply-migration-0061.ts: a partial application is a thing to
 * look at, not to re-run over.
 *
 * VERIFIES, rather than reports success: the column types are read back from
 * information_schema, the two indexes from pg_indexes, and — the one that
 * matters — every existing profile is confirmed to be unrequested and uncharged,
 * because a migration that quietly marked historic profiles as having bought
 * something would be a billing claim about work nobody did.
 *
 *   npx tsx --env-file=.env.local scripts/audit/apply-migration-0062.ts
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const FILE = 'src/lib/db/migrations/0062_concierge_tax_detail.sql';

const NEW_COLUMNS = [
  'tax_detail_requested', 'tax_detail_status', 'tax_detail_source', 'tax_detail_error',
  'tax_report', 'tax_assessed_basis', 'titlepoint_request_id', 'titlepoint_data_id',
  'titlepoint_charges', 'titlepoint_requested_at', 'titlepoint_duration_ms',
];

(async () => {
  const before = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'concierge_profiles'
       AND column_name = ANY(${NEW_COLUMNS})`;

  if (before.length > 0 && before.length < NEW_COLUMNS.length) {
    console.log(`PARTIALLY APPLIED — ${before.length} of ${NEW_COLUMNS.length} columns exist:`);
    console.log(`  ${before.map((r) => r.column_name).join(', ')}`);
    console.log('Stopping rather than guessing. Look at it before re-running.');
    await sql.end();
    return;
  }
  if (before.length === NEW_COLUMNS.length) {
    console.log('All 11 columns already exist — 0062 looks applied. Verifying only.\n');
  } else {
    console.log('Applying 0062…');
    await sql.unsafe(readFileSync(FILE, 'utf8'));
    console.log('Applied.\n');
  }

  const cols = await sql<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_name = 'concierge_profiles'
       AND column_name = ANY(${NEW_COLUMNS})
     ORDER BY column_name`;

  console.log(`=== columns (${cols.length}/${NEW_COLUMNS.length}) ===`);
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(28)} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'null'} ${c.column_default ?? ''}`);
  }
  const missing = NEW_COLUMNS.filter((n) => !cols.some((c) => c.column_name === n));
  if (missing.length > 0) console.log(`  MISSING: ${missing.join(', ')}`);

  const idx = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
     WHERE tablename = 'concierge_profiles'
       AND indexname IN ('concierge_profiles_tax_pending_idx', 'concierge_profiles_tp_request_idx')
     ORDER BY indexname`;
  console.log(`\n=== indexes (${idx.length}/2) ===`);
  for (const i of idx) console.log(`  ${i.indexname}`);

  // THE ONE THAT MATTERS. Historic profiles must read as having asked for
  // nothing and been charged nothing: this migration is not allowed to make a
  // billing claim about work nobody did.
  const [counts] = await sql<{ total: string; requested: string; charged: string; sitex: string }[]>`
    SELECT count(*)                                              AS total,
           count(*) FILTER (WHERE tax_detail_requested)           AS requested,
           count(*) FILTER (WHERE titlepoint_charges > 0)         AS charged,
           coalesce(sum(sitex_credits_charged), 0)                AS sitex
      FROM concierge_profiles`;

  console.log('\n=== existing rows ===');
  console.log(`  profiles:                  ${counts!.total}`);
  console.log(`  tax_detail_requested true: ${counts!.requested}   (must be 0)`);
  console.log(`  titlepoint_charges > 0:    ${counts!.charged}   (must be 0)`);
  console.log(`  sitex_credits_charged sum: ${counts!.sitex}   (unchanged by this migration)`);

  const ok = cols.length === NEW_COLUMNS.length && idx.length === 2
    && Number(counts!.requested) === 0 && Number(counts!.charged) === 0;
  console.log(`\n${ok ? 'VERIFIED — 0062 is in production.' : 'NOT VERIFIED — read the output above.'}`);

  await sql.end();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
