/**
 * Mark profiles whose tax detail is stored but NOT on the document.
 *
 * FREE. One UPDATE of a status column; no vendor, no render, no charge.
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 *
 * Until 2026-10-05, tax_detail_status went to 'ready' the moment the report was
 * stored — before the re-render. On profile 9 the re-render then died (a promise
 * fired after the route had answered, in a function free to freeze once it had),
 * so the row says 'ready' while the PDF on file was written five seconds BEFORE
 * its own search started.
 *
 * 'ready' now means "on the document". These rows are 'fetched': bought, stored,
 * not yet shown. Restating them is not a fix — it is the row telling the truth,
 * and the truth is what concierge.tax_finish looks for. The sweeper then does
 * the re-render in production, where the renderer runs.
 *
 * ─── HOW IT DECIDES ─────────────────────────────────────────────────────────
 *
 * The PDF's own storage key carries the moment it was written — pdfKey() builds
 * `concierge/{id}/profile-{ISO}.pdf`. A key older than titlepoint_requested_at
 * is a document that cannot contain the tax data, whatever the status says.
 * That is the whole test, and it is a comparison rather than a guess.
 *
 * DRY BY DEFAULT. Pass --apply to write.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-restate-stale-tax.ts
 *   npx tsx --env-file=.env.local scripts/audit/concierge-restate-stale-tax.ts --apply
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const APPLY = process.argv.includes('--apply');

/** `concierge/9/profile-2026-10-05T17-11-20-638Z.pdf` -> Date, or null. */
function writtenAt(key: string | null): Date | null {
  if (!key) return null;
  const m = /profile-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.pdf$/.exec(key);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

(async () => {
  const rows = await sql<Array<{
    id: number; pdf_storage_key: string | null; titlepoint_requested_at: Date | null;
    tax_detail_status: string | null; has_report: boolean;
  }>>`
    SELECT id, pdf_storage_key, titlepoint_requested_at, tax_detail_status,
           (tax_report IS NOT NULL) AS has_report
      FROM concierge_profiles
     WHERE tax_detail_status = 'ready'
       AND tax_report IS NOT NULL
       AND titlepoint_requested_at IS NOT NULL
     ORDER BY id`;

  console.log(`profiles marked 'ready' with a stored report: ${rows.length}`);

  const stale = rows.filter((r) => {
    const w = writtenAt(r.pdf_storage_key);
    return w !== null && r.titlepoint_requested_at !== null && w < r.titlepoint_requested_at;
  });

  for (const r of rows) {
    const w = writtenAt(r.pdf_storage_key);
    const isStale = w && r.titlepoint_requested_at && w < r.titlepoint_requested_at;
    console.log(`  #${r.id}  pdf ${w ? w.toISOString() : '(unparseable key)'}  search ${r.titlepoint_requested_at?.toISOString()}  ${isStale ? 'STALE' : 'ok'}`);
  }

  console.log(`\nstale: ${stale.length}`);
  if (stale.length === 0) { console.log('nothing to restate.'); await sql.end(); return; }

  if (!APPLY) {
    console.log('DRY RUN — pass --apply to set these to \'fetched\'.');
    await sql.end();
    return;
  }

  const ids = stale.map((r) => r.id);
  const updated = await sql`
    UPDATE concierge_profiles
       SET tax_detail_status = 'fetched'
     WHERE id = ANY(${ids}) AND tax_detail_status = 'ready'
    RETURNING id, tax_detail_status`;
  console.log(`restated ${updated.length}: ${updated.map((u) => `#${u.id}->${u.tax_detail_status}`).join(', ')}`);
  console.log('concierge.tax_finish will re-render these; it cannot buy a second search.');
  await sql.end();
})().catch((e) => { console.error('FAILED:', String(e)); process.exit(1); });
