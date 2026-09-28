/**
 * READ-ONLY. The counties where PCTXML01 is denied, which is the list page 4
 * must be ABSENT on — not blank, absent.
 *
 * The v6 handoff calls this "the 14-county exclusion rule" and
 * docs/titlepoint/TITLEPOINT_TAX_REPORT_ELEMENTS.md names thirteen and then
 * says "and one more", which is the tell that the fourteenth was never
 * identified — somebody had a count from a query and a list that was one
 * short.
 *
 * It folds case. `county` is stored inconsistently ("Mono" and "MONO" both
 * occur), and a COUNT(DISTINCT county) over the raw column returns one more
 * county than exists. That is where the fourteenth came from.
 *
 * NO WRITES AND NO VENDOR CALLS.
 *
 * Committed per EVIDENCE_RULES.md rule 6 — the exclusion test will be written
 * against this list, so the list needs a method, not a memory.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
const DENIAL = '%access is currently denied%';

(async () => {
  const raw = await sql`
    SELECT count(DISTINCT p.county) AS unfolded,
           count(DISTINCT upper(trim(p.county))) AS folded
    FROM title_point_data t
    JOIN order_properties p ON p.order_id = t.order_id
    WHERE t.message ILIKE ${DENIAL} AND p.county IS NOT NULL`;

  console.log(`\nDistinct counties, case NOT folded: ${raw[0].unfolded}`);
  console.log(`Distinct counties, case folded:     ${raw[0].folded}`);
  if (Number(raw[0].unfolded) !== Number(raw[0].folded)) {
    console.log('\n  ^ The difference is the "and one more". Case, not a county.');
  }

  const counties = await sql`
    SELECT upper(trim(p.county)) AS county,
           count(DISTINCT t.order_id) AS orders,
           min(t.created_at)::date AS first_denial,
           array_agg(DISTINCT p.county) AS spellings
    FROM title_point_data t
    JOIN order_properties p ON p.order_id = t.order_id
    WHERE t.message ILIKE ${DENIAL} AND p.county IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC, 1`;

  console.log(`\nTHE LIST — ${counties.length} counties\n`);
  for (const c of counties) {
    const spellings = (c.spellings as string[]).filter((s) => s !== c.county);
    const since = new Date(c.first_denial as unknown as string).toISOString().slice(0, 10);
    console.log(`  ${String(c.county).padEnd(16)} ${String(c.orders).padStart(3)} orders   since ${since}${spellings.length ? `   also stored as: ${spellings.join(', ')}` : ''}`);
  }

  console.log('\nAs a constant, ready to paste:\n');
  console.log(`const TAX_EXCLUDED_COUNTIES = [\n${counties.map((c) => `  '${c.county}',`).join('\n')}\n] as const;`);

  // The list is only safe to hard-code if it is not still growing. If a county
  // joined it this week, a constant will be wrong by next week and the page
  // will render tax on a parcel that has none.
  const recent = counties.filter((c) => {
    const d = new Date(c.first_denial as unknown as string);
    return Date.now() - d.getTime() < 7 * 24 * 3600 * 1000;
  });
  console.log(`\n  Counties that joined the list in the last 7 days: ${recent.length}`);
  if (recent.length > 0) {
    console.log(`    ${recent.map((c) => c.county).join(', ')}`);
    console.log('    THE LIST IS STILL GROWING. A hard-coded constant will go stale —');
    console.log('    page 4 should key off the absence of a tax record, not off a county.');
  }

  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 400)); process.exit(1); });
