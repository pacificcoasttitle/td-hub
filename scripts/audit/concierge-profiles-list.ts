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
           pdf_page_count AS page_count, created_at,
           sitex_credits_charged, sitex_search_id
    FROM concierge_profiles ORDER BY id`;

  console.log(`\n${rows.length} profile(s)\n`);
  console.log(`  ${'id'.padEnd(4)} ${'address'.padEnd(28)} ${'tmpl'.padEnd(5)} ${'status'.padEnd(10)} ${'pg'.padEnd(3)} ${'cr'.padEnd(3)} ${'searchId'.padEnd(11)} ${'opened'.padEnd(11)} raw pdf`);
  let credits = 0;
  for (const r of rows) {
    credits += Number(r.sitex_credits_charged ?? 0);
    const opened = new Date(r.created_at as Date).toISOString().slice(0, 10);
    console.log(`  ${String(r.id).padEnd(4)} ${`${r.requested_address ?? ''}, ${r.requested_city ?? ''}`.slice(0, 27).padEnd(28)} ${String(r.template_version ?? '—').padEnd(5)} ${String(r.status ?? '—').padEnd(10)} ${String(r.page_count ?? '—').padEnd(3)} ${String(r.sitex_credits_charged ?? 0).padEnd(3)} ${String(r.sitex_search_id ?? '—').padEnd(11)} ${opened.padEnd(11)} ${r.has_raw ? 'yes' : 'NO '} ${r.has_pdf ? 'yes' : 'NO'}`);
  }
  console.log(`\n  SiteX credits charged across all profiles: ${credits}`);

  // Grouped on the same normalisation claim.ts uses for its key —
  // lowercase, then [^a-z0-9]+ to a single space — so "1358 5th St" and
  // "1358 5th st." land together exactly as the guard would land them.
  //
  // Two different guards, and this only speaks to one. The CLAIM is a
  // short-lived lock against a double-click, minutes wide; it does not stop a
  // second profile next week. The lasting check is GET /for-property, which
  // says "we already hold this" and offers AlreadyHavePanel. So repeats here
  // mean an operator was told and chose to generate anyway — a spend decision,
  // not a defect.
  const byProperty = new Map<string, { n: number; paid: number; ids: number[] }>();
  for (const r of rows) {
    const key = `${String(r.requested_address ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const e = byProperty.get(key) ?? { n: 0, paid: 0, ids: [] };
    e.n += 1;
    e.paid += Number(r.sitex_credits_charged ?? 0);
    e.ids.push(Number(r.id));
    byProperty.set(key, e);
  }
  const repeats = [...byProperty.values()].filter((e) => e.n > 1);
  for (const e of repeats) {
    console.log(`  ${e.n} profiles on one property (ids ${e.ids.join(', ')}), ${e.paid} credit(s) spent.`);
    if (e.paid > 1) {
      console.log('    Each was told "we already hold this" and generated anyway.');
      console.log('    Each has its own sitex_search_id, so each is a separate invoice line.');
    }
  }
  const stale = rows.filter((r) => r.template_version !== 'v3');
  const free = stale.filter((r) => r.has_raw);
  console.log(`\n  Not on v3: ${stale.length}. Of those, re-renderable for free: ${free.length}`);
  if (free.length !== stale.length) {
    console.log('  The remainder have no stored payload and would need a paid re-pull.');
  }
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e).slice(0, 400)); process.exit(1); });
