/**
 * Apply 0065 to production, for keeps, and prove it landed.
 *
 * ─── WHY THIS GOES BEFORE THE CODE ──────────────────────────────────────────
 *
 * Fourth time, same reason as 0062, 0063 and 0064. Drizzle's `select()` with
 * no projection names every column in the schema, and nhd-bridge.ts reads a
 * profile that way. The moment the branch deploys, that query asks for
 * hazard_pdf_storage_key and fails.
 *
 * ─── WHY IT IS SAFE AHEAD OF THE CODE ───────────────────────────────────────
 *
 * Two nullable columns, no default, no index, no constraint. Nothing renamed,
 * dropped or widened, and no existing value read or written.
 *
 * VERIFIES rather than reports success, and checks one thing beyond the
 * columns: that no existing row claims to have a rasterised source. These
 * record what we fetched and what we made from it, and backfilling either
 * would be a claim about work nobody did.
 *
 *   npx tsx --env-file=.env.local scripts/audit/apply-migration-0065.ts
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const FILE = 'src/lib/db/migrations/0065_concierge_hazard_pdf_source.sql';
const NEW_COLUMNS = ['hazard_pdf_storage_key', 'hazard_dpi'];

(async () => {
  const before = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'concierge_profiles'
       AND column_name = ANY(${NEW_COLUMNS})`;

  if (before.length > 0 && before.length < NEW_COLUMNS.length) {
    console.log(`PARTIALLY APPLIED — ${before.length} of ${NEW_COLUMNS.length}: ${before.map((r) => r.column_name).join(', ')}`);
    console.log('Stopping rather than guessing.');
    await sql.end();
    process.exit(1);
  }
  if (before.length === NEW_COLUMNS.length) {
    console.log('Both columns already exist — 0065 looks applied. Verifying only.\n');
  } else {
    console.log('Applying 0065…');
    await sql.unsafe(readFileSync(FILE, 'utf8'));
    console.log('Applied.\n');
  }

  const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_name = 'concierge_profiles'
       AND column_name = ANY(${NEW_COLUMNS})
     ORDER BY column_name`;
  console.log(`=== columns (${cols.length}/${NEW_COLUMNS.length}) ===`);
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(20)} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'null'}`);
  }

  const [counts] = await sql<{ total: string; pdfs: string; dpis: string; pngs: string }[]>`
    SELECT count(*)                                                  AS total,
           count(*) FILTER (WHERE hazard_pdf_storage_key IS NOT NULL) AS pdfs,
           count(*) FILTER (WHERE hazard_dpi IS NOT NULL)             AS dpis,
           count(*) FILTER (WHERE hazard_storage_key IS NOT NULL)     AS pngs
      FROM concierge_profiles`;

  console.log('\n=== existing rows ===');
  console.log(`  profiles                     : ${counts!.total}`);
  console.log(`  hazard_pdf_storage_key set   : ${counts!.pdfs}   (must be 0)`);
  console.log(`  hazard_dpi set               : ${counts!.dpis}   (must be 0)`);
  console.log(`  hazard_storage_key set       : ${counts!.pngs}   (the /image-era previews, if any)`);

  const ok = cols.length === NEW_COLUMNS.length
    && Number(counts!.pdfs) === 0 && Number(counts!.dpis) === 0;
  console.log(`\n${ok ? 'VERIFIED — 0065 is in production.' : 'NOT VERIFIED — read the output above.'}`);

  await sql.end();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
