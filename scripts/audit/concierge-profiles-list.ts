/**
 * READ-ONLY. Which Concierge profiles exist, what template each was rendered
 * on, and whether each can be re-rendered for free.
 *
 * `canRenderFree` is raw_storage_key being present — the same condition
 * profiles.ts uses. A profile without one cannot get the v3 layout without a
 * paid re-pull, which is a spend decision rather than a rendering one.
 *
 * NO WRITES, NO VENDOR CALLS.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

(async () => {
  const rows = await sql`
    SELECT id, requested_address, requested_city, template_version, status,
           raw_storage_key IS NOT NULL AS has_raw,
           pdf_storage_key IS NOT NULL AS has_pdf,
           pdf_page_count AS page_count, created_at
    FROM concierge_profiles ORDER BY id`;

  console.log(`\n${rows.length} profile(s)\n`);
  console.log(`  ${'id'.padEnd(4)} ${'address'.padEnd(30)} ${'tmpl'.padEnd(6)} ${'status'.padEnd(11)} ${'pages'.padEnd(6)} raw  pdf`);
  for (const r of rows) {
    console.log(`  ${String(r.id).padEnd(4)} ${`${r.requested_address ?? ''}, ${r.requested_city ?? ''}`.slice(0, 29).padEnd(30)} ${String(r.template_version ?? '—').padEnd(6)} ${String(r.status ?? '—').padEnd(11)} ${String(r.page_count ?? '—').padEnd(6)} ${r.has_raw ? 'yes' : 'NO '}  ${r.has_pdf ? 'yes' : 'NO'}`);
  }
  const stale = rows.filter((r) => r.template_version !== 'v3');
  const free = stale.filter((r) => r.has_raw);
  console.log(`\n  Not on v3: ${stale.length}. Of those, re-renderable for free: ${free.length}`);
  if (free.length !== stale.length) {
    console.log('  The remainder have no stored payload and would need a paid re-pull.');
  }
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 400)); process.exit(1); });
