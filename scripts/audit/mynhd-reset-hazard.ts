/**
 * Clear a profile's hazard columns so it re-fetches through the /pdf path.
 *
 * IT WRITES TO PRODUCTION, which is why it is committed rather than pasted
 * into a shell. Approved by Gerard, 15 Oct 2026, for profile 42 — his own test
 * click on Contreras Street.
 *
 * ─── WHY IT IS NEEDED ───────────────────────────────────────────────────────
 *
 * Profile 42 holds the preview from the OLD path: MyNHD's 1024px `/image` PNG,
 * with hazard_status='ready' — and ready was reachable at the time without the
 * document having a hazard sheet at all. So the row claims to be done, the row
 * action offers nothing, and nothing will ever re-fetch it through /pdf.
 *
 * ─── WHAT IT TOUCHES ────────────────────────────────────────────────────────
 *
 * The sixteen hazard_* columns on ONE row, back to the state of a profile that
 * was never asked. Nothing else: not the SiteX payload, not the PDF, not the
 * tax columns, not the credit counters.
 *
 * The S3 objects are deliberately LEFT. They are what MyNHD actually sent and
 * cost nothing to keep; a re-fetch overwrites them at the same keys. Deleting
 * evidence to tidy up is how a question becomes unanswerable later.
 *
 * ─── IT WILL ONLY TOUCH A TEST PROPERTY ─────────────────────────────────────
 *
 * The dev key must not put anything on a client's profile. The allow-list is
 * the two addresses Gerard named, checked against the row before the write —
 * an id typed wrong is otherwise a client's document.
 *
 *   npx tsx --env-file=.env.local scripts/audit/mynhd-reset-hazard.ts 42
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema/concierge';

/** Gerard, 15 Oct 2026: test on 1358 5th and Contreras only. */
const ALLOWED = [/1358\s*5th/i, /contreras/i];

async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('usage: mynhd-reset-hazard.ts <profileId>');
    process.exit(1);
  }

  const [before] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, id)).limit(1);
  if (!before) { console.error(`profile ${id} not found`); process.exit(1); }

  const address = `${before.requestedAddress} ${before.requestedCity ?? ''}`;
  if (!ALLOWED.some((re) => re.test(address))) {
    console.error(`REFUSED. Profile ${id} is "${address.trim()}", which is not one of the`);
    console.error('test properties. The dev key must not put anything on a client profile.');
    process.exit(1);
  }

  console.log(`\n=== profile ${id} — ${address.trim()} ===`);
  console.log('  BEFORE');
  show(before);

  if (before.hazardStatus === null && !before.hazardRequested) {
    console.log('\n  Already clear. Nothing to do.');
    process.exit(0);
  }

  await db.update(conciergeProfiles).set({
    hazardRequested: false,
    hazardStatus: null,
    hazardError: null,
    hazardStorageKey: null,
    hazardPdfStorageKey: null,
    hazardSha256: null,
    hazardBytes: null,
    hazardWidth: null,
    hazardHeight: null,
    hazardDpi: null,
    hazardOrderLink: null,
    hazardSuccess: null,
    hazardCode: null,
    hazardHttpStatus: null,
    hazardRequestedAt: null,
    hazardDurationMs: null,
  }).where(eq(conciergeProfiles.id, id));

  const [after] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, id)).limit(1);
  console.log('\n  AFTER');
  show(after!);

  // Read back rather than report success. Every hazard field must be clear,
  // and the things this must NOT have touched must be unchanged.
  const cleared = after!.hazardStatus === null && after!.hazardRequested === false
    && after!.hazardStorageKey === null && after!.hazardOrderLink === null
    && after!.hazardWidth === null && after!.hazardSuccess === null;
  const untouched = after!.rawStorageKey === before.rawStorageKey
    && after!.pdfStorageKey === before.pdfStorageKey
    && after!.sitexCreditsCharged === before.sitexCreditsCharged
    && after!.taxDetailStatus === before.taxDetailStatus;

  console.log(`\n  hazard columns cleared : ${cleared}`);
  console.log(`  everything else intact : ${untouched}`);
  console.log(`    raw payload  ${after!.rawStorageKey === before.rawStorageKey}`);
  console.log(`    pdf on file  ${after!.pdfStorageKey === before.pdfStorageKey}`);
  console.log(`    sitex credit ${after!.sitexCreditsCharged} (was ${before.sitexCreditsCharged})`);
  console.log(`    tax status   ${after!.taxDetailStatus} (was ${before.taxDetailStatus})`);
  console.log(`\n${cleared && untouched ? 'DONE — the row action will offer it again.' : 'NOT VERIFIED — read the output above.'}`);
  process.exit(cleared && untouched ? 0 : 1);
}

function show(p: typeof conciergeProfiles.$inferSelect) {
  console.log(`    requested=${p.hazardRequested} status=${p.hazardStatus} dpi=${p.hazardDpi}`);
  console.log(`    png=${p.hazardStorageKey} ${p.hazardWidth}x${p.hazardHeight} ${p.hazardBytes}b`);
  console.log(`    pdf=${p.hazardPdfStorageKey}`);
  console.log(`    vendor: http=${p.hazardHttpStatus} success=${p.hazardSuccess} code=${p.hazardCode}`);
  console.log(`    orderLink=${p.hazardOrderLink ? 'set' : 'null'}  error=${p.hazardError ?? 'null'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
