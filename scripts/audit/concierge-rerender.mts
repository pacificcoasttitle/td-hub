/**
 * Re-render a Concierge profile's PDF from stored data. FREE.
 *
 * Exactly what the "Refresh document (free)" row action does, for cases where
 * reaching the UI is the hard part. renderProfile() calls no vendor: it reads
 * the stored SiteX payload and the stored tax_report and lays out the document.
 * routes.test.ts asserts it imports nothing from integrations/sitex.
 *
 * WHY IT IS NEEDED RIGHT NOW. Profile 9's tax search ran, stored its report and
 * never replaced the PDF — the document on file was written five seconds before
 * the search started, because the finishing promise was fired after the route
 * had answered and the function froze. The code fix stops the NEXT one; it does
 * not re-render the one already on file. The sweeper will not pick it up either,
 * because the row says 'ready'.
 *
 * IT WRITES TO PRODUCTION — a new PDF object and the pdf_* columns on the row —
 * so it lives here, committed, rather than being pasted into a shell.
 *
 *   npx tsx --env-file=.env.local scripts/audit/concierge-rerender.mts 9
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/lib/db/client';
// The concrete module, not the barrel: under ESM the barrel's re-exports do not
// resolve here, which is the same reason concierge-render-preview.mts does it.
import { conciergeProfiles } from '../../src/lib/db/schema/concierge';
import { renderProfile } from '../../src/lib/domain/concierge/render';

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('usage: concierge-rerender.ts <profileId>');
    process.exit(1);
  }

  const before = await read(id);
  if (!before) { console.error(`profile ${id} not found`); process.exit(1); }

  console.log(`=== profile ${id} BEFORE ===`);
  show(before);

  console.log('\nre-rendering (free, no vendor call)…');
  const r = await renderProfile(id);
  console.log(`  ok=${r.ok}  ${r.message ?? ''}`);

  const after = await read(id);
  console.log(`\n=== profile ${id} AFTER ===`);
  if (after) show(after);

  // THE POINT OF THE RUN, stated as a comparison rather than a claim: a new
  // storage key means a new document was actually written.
  const moved = before.pdfStorageKey !== after?.pdfStorageKey;
  console.log(`\npdf replaced: ${moved ? 'YES' : 'NO'}`);
  if (after?.taxDetailSource) console.log(`page 4 layer : ${after.taxDetailSource}`);
  process.exit(r.ok && moved ? 0 : 1);
}

async function read(id: number) {
  const [p] = await db.select({
    pdfStorageKey: conciergeProfiles.pdfStorageKey,
    pdfPageCount: conciergeProfiles.pdfPageCount,
    pdfBytes: conciergeProfiles.pdfBytes,
    taxDetailStatus: conciergeProfiles.taxDetailStatus,
    taxDetailSource: conciergeProfiles.taxDetailSource,
    templateVersion: conciergeProfiles.templateVersion,
  }).from(conciergeProfiles).where(eq(conciergeProfiles.id, id)).limit(1);
  return p ?? null;
}

function show(p: NonNullable<Awaited<ReturnType<typeof read>>>) {
  console.log(`  pdf    : ${p.pdfStorageKey}`);
  console.log(`  pages  : ${p.pdfPageCount}  bytes ${p.pdfBytes}  template ${p.templateVersion}`);
  console.log(`  tax    : status=${p.taxDetailStatus} source=${p.taxDetailSource}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
