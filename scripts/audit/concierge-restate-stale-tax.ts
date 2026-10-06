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

/**
 * `concierge/9/profile-2026-10-05T17-11-20-638Z.pdf` -> "2026-10-05T17:11:20".
 *
 * ─── AS TEXT, NEVER AS A DATE ───────────────────────────────────────────────
 *
 * The first version parsed this into a Date — correctly, as UTC, because
 * pdfKey() uses toISOString(). Then it compared that against
 * titlepoint_requested_at, which is `timestamp` WITHOUT time zone, so the
 * driver read the naive value as LOCAL and handed back an instant seven hours
 * out on a PDT machine. Every profile looked stale. All three would have been
 * restated, and all three were fine.
 *
 * Production runs UTC, so the naive column holds UTC numerals and the key holds
 * UTC numerals. Comparing the two as STRINGS — with the database formatting its
 * side via to_char so the driver never gets to interpret it — keeps both in one
 * frame and cannot be shifted by whose machine runs the script.
 */
function writtenAt(key: string | null): string | null {
  if (!key) return null;
  const m = /profile-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(key);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}` : null;
}

(async () => {
  const rows = await sql<Array<{
    id: number; pdf_storage_key: string | null; search_naive: string | null;
    tax_detail_status: string | null;
  }>>`
    SELECT id, pdf_storage_key, tax_detail_status,
           -- Formatted BY POSTGRES, so the driver never interprets it. See
           -- writtenAt() for why that matters.
           to_char(titlepoint_requested_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS search_naive
      FROM concierge_profiles
     WHERE tax_detail_status = 'ready'
       AND tax_report IS NOT NULL
       AND titlepoint_requested_at IS NOT NULL
     ORDER BY id`;

  console.log(`profiles marked 'ready' with a stored report: ${rows.length}`);

  const isStale = (r: typeof rows[number]) => {
    const w = writtenAt(r.pdf_storage_key);
    return w !== null && r.search_naive !== null && w < r.search_naive;
  };
  const stale = rows.filter(isStale);

  for (const r of rows) {
    const w = writtenAt(r.pdf_storage_key);
    console.log(`  #${r.id}  pdf ${w ?? '(unparseable key)'}  search ${r.search_naive}  ${isStale(r) ? 'STALE' : 'ok'}`);
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
