/**
 * Apply 0064 to production, for keeps, and prove it landed.
 *
 * ─── WHY THIS GOES BEFORE THE CODE, NOT AFTER ───────────────────────────────
 *
 * Third time, same reason as 0062 and 0063. Drizzle's `select()` with no
 * projection names every column in the schema, and nhd-bridge.ts uses exactly
 * that to read a profile. The moment the branch deploys, that query asks for
 * hazard_status and fails — so applying this late does not degrade the hazard
 * sheet, it breaks the read.
 *
 * ─── WHY IT IS SAFE TO APPLY AHEAD OF THE CODE ──────────────────────────────
 *
 * Purely additive: thirteen columns, no index, no constraint, nothing renamed,
 * dropped or widened, and no existing value read or written. The one NOT NULL
 * column carries a default of false, so every existing row reads exactly as it
 * does today. The code currently in production references none of them.
 *
 * ─── WHAT WOULD MAKE THIS THE WRONG THING TO RUN ────────────────────────────
 *
 * It stops rather than guessing if the columns half-exist. A partial
 * application is a thing to look at, not to re-run over.
 *
 * VERIFIES rather than reports success. The columns come back from
 * information_schema, and every existing row is confirmed to have asked for
 * nothing: hazard_requested false everywhere, no storage key, no order link.
 * These columns are a record of a vendor call and of a link printed on a
 * client document — backfilling any of them would be a claim about something
 * that never happened.
 *
 *   npx tsx --env-file=.env.local scripts/audit/apply-migration-0064.ts
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const FILE = 'src/lib/db/migrations/0064_concierge_hazard_preview.sql';

const NEW_COLUMNS = [
  'hazard_requested', 'hazard_status', 'hazard_error',
  'hazard_storage_key', 'hazard_sha256', 'hazard_bytes',
  'hazard_width', 'hazard_height', 'hazard_order_link',
  'hazard_success', 'hazard_code', 'hazard_http_status',
  'hazard_requested_at', 'hazard_duration_ms',
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
    process.exit(1);
  }
  if (before.length === NEW_COLUMNS.length) {
    console.log(`All ${NEW_COLUMNS.length} columns already exist — 0064 looks applied. Verifying only.\n`);
  } else {
    console.log('Applying 0064…');
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
    console.log(`  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(28)} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'null'} ${c.column_default ?? ''}`);
  }
  const missing = NEW_COLUMNS.filter((n) => !cols.some((c) => c.column_name === n));
  if (missing.length > 0) console.log(`  MISSING: ${missing.join(', ')}`);

  // THE ONE THAT MATTERS. Nothing historic may read as having asked MyNHD for
  // anything, or as carrying an order link on a client-facing document.
  const [counts] = await sql<{ total: string; req: string; key: string; link: string; tp: string }[]>`
    SELECT count(*)                                           AS total,
           count(*) FILTER (WHERE hazard_requested)           AS req,
           count(*) FILTER (WHERE hazard_storage_key IS NOT NULL) AS key,
           count(*) FILTER (WHERE hazard_order_link IS NOT NULL)  AS link,
           coalesce(sum(titlepoint_charges), 0)                   AS tp
      FROM concierge_profiles`;

  console.log('\n=== existing rows ===');
  console.log(`  profiles:                  ${counts!.total}`);
  console.log(`  hazard_requested true:     ${counts!.req}    (must be 0)`);
  console.log(`  hazard_storage_key set:    ${counts!.key}    (must be 0)`);
  console.log(`  hazard_order_link set:     ${counts!.link}    (must be 0)`);
  console.log(`  titlepoint_charges sum:    ${counts!.tp}    (unchanged by this migration)`);

  const ok = cols.length === NEW_COLUMNS.length
    && Number(counts!.req) === 0 && Number(counts!.key) === 0 && Number(counts!.link) === 0;
  console.log(`\n${ok ? 'VERIFIED — 0064 is in production.' : 'NOT VERIFIED — read the output above.'}`);

  await sql.end();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
