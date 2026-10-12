/**
 * Apply 0063 to production, for keeps, and prove it landed.
 *
 * ─── WHY THIS GOES BEFORE THE CODE, NOT AFTER ───────────────────────────────
 *
 * Same reason as 0062. Drizzle's `select()` with no projection names every
 * column in the schema, so the moment the branch deploys, any such query on
 * concierge_profiles asks for match_candidates and fails. Applying this late
 * does not degrade the multi-match flow — it breaks reads that have nothing to
 * do with it.
 *
 * ─── WHY IT IS SAFE TO APPLY AHEAD OF THE CODE ──────────────────────────────
 *
 * Purely additive: three nullable columns, no default, no index, no
 * constraint. Nothing is renamed, dropped, widened or constrained, and no
 * existing value is read or written. Every existing row reads exactly as it
 * does today, with three nulls on the end. The code currently in production
 * does not reference any of them.
 *
 * ─── WHAT WOULD MAKE THIS THE WRONG THING TO RUN ────────────────────────────
 *
 * It stops rather than guessing if the columns already half-exist, on the same
 * reasoning as 0061 and 0062: a partial application is a thing to look at.
 *
 * VERIFIES rather than reports success. The columns are read back from
 * information_schema, and — the one that matters — every existing row is
 * confirmed to have no candidates and no requested parcel on it. These columns
 * are a record of what an operator was asked and what we sent; backfilling
 * them with anything would be a claim about a conversation that never happened.
 *
 *   npx tsx --env-file=.env.local scripts/audit/apply-migration-0063.ts
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const FILE = 'src/lib/db/migrations/0063_concierge_match_candidates.sql';

const NEW_COLUMNS = ['match_candidates', 'requested_apn', 'requested_fips'];

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
    console.log('All three columns already exist — 0063 looks applied. Verifying only.\n');
  } else {
    console.log('Applying 0063…');
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
    console.log(`  ${c.column_name.padEnd(18)} ${c.data_type.padEnd(20)} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'null'} ${c.column_default ?? ''}`);
  }
  const missing = NEW_COLUMNS.filter((n) => !cols.some((c) => c.column_name === n));
  if (missing.length > 0) console.log(`  MISSING: ${missing.join(', ')}`);

  // THE ONE THAT MATTERS. These columns record what an operator was offered and
  // what we sent. Nothing historic may read as having been offered a choice.
  const [counts] = await sql<{ total: string; cand: string; apn: string; sitex: string }[]>`
    SELECT count(*)                                        AS total,
           count(*) FILTER (WHERE match_candidates IS NOT NULL) AS cand,
           count(*) FILTER (WHERE requested_apn IS NOT NULL)    AS apn,
           coalesce(sum(sitex_credits_charged), 0)              AS sitex
      FROM concierge_profiles`;

  console.log('\n=== existing rows ===');
  console.log(`  profiles:                   ${counts!.total}`);
  console.log(`  match_candidates not null:  ${counts!.cand}   (must be 0)`);
  console.log(`  requested_apn not null:     ${counts!.apn}   (must be 0)`);
  console.log(`  sitex_credits_charged sum:  ${counts!.sitex}   (unchanged by this migration)`);

  const ok = cols.length === NEW_COLUMNS.length
    && Number(counts!.cand) === 0 && Number(counts!.apn) === 0;
  console.log(`\n${ok ? 'VERIFIED — 0063 is in production.' : 'NOT VERIFIED — read the output above.'}`);

  await sql.end();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
