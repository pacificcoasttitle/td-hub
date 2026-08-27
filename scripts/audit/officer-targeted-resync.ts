/**
 * TARGETED RESYNC of four escrow officers. WRITES to contacts, nothing else.
 *
 * Authorised writes: the `contacts` rows for PCT\aballesteros, PCT\jgomez,
 * PCT\kcasco and PCT\lvidaca — and Gomez is expected to be refused by the shape
 * guard, so in practice three. No other table, no migration, no vendor write.
 *
 * ─── The blocker, and the scoped path around it ─────────────────────────────
 *
 * handleSyncContactType fetches with `modifiedSince = contact_sync_state
 * .last_synced_at`, now 2026-08-27, while all six officer rows carry
 * LastModifiedAt 2026-05-12. The feed therefore returns zero rows and the
 * scheduled sync cannot repair these officers, however often it runs.
 *
 * Rather than reset `contact_sync_state.last_synced_at` — which would resend
 * every entity the cursor covers and is a far larger action than authorised —
 * this calls the same two production functions the job calls, directly:
 *
 *     fetchSyncContactRows('Escrow Officer', { modifiedSince: null })
 *     syncContactRows('Escrow Officer', <just these four rows>)
 *
 * `modifiedSince: null` is an existing, supported option on the fetch (it is
 * the first-run full-resync path), so the read needs no new parameter and no
 * vendor-side change. The rows are then filtered to the four officers before
 * anything is written, so the blast radius is four rows by construction. This
 * script does not read, write or advance `contact_sync_state` at all.
 *
 * Writing through syncContactRows rather than with hand-written UPDATEs is
 * deliberate: it is the code path production uses, so the shape guard, the
 * dedupe guard and the deterministic match are all exercised exactly as they
 * will be on the next scheduled run.
 *
 * Pass --apply to write. Without it the script measures and stops.
 */
import postgres from 'postgres';
import { fetchSyncContactRows, syncContactRows } from '@/lib/jobs/handlers/sync-contacts';
import { buildSoftProPayload, type ResolvedContact } from '@/lib/domain/orders/softpro-payload';
import type { CreateOrderInput } from '@/lib/domain/orders/create-order';

const APPLY = process.argv.includes('--apply');
const CODE = 'Escrow officer/Closer';

/** The four broken officers. Ayala and Quintanar are the working control and are not here. */
const TARGETS = ['PCT\\aballesteros', 'PCT\\jgomez', 'PCT\\kcasco', 'PCT\\lvidaca'];
const CONTROL = ['PCT\\aayala', 'PCT\\cquintanar'];

type Row = Record<string, unknown>;

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

async function snapshot(codes: string[]): Promise<Row[]> {
  return await sql`
    select id, officer_name, office_lookup_code, lookup_code, email,
           softpro_lookup_code, closer_examiner, is_escrow_officer, is_active, updated_at
      from contacts
     where closer_examiner in ${sql(codes)}
     order by id
  ` as unknown as Row[];
}

function show(label: string, rows: Row[]): void {
  console.log(`  ${label}`);
  for (const r of rows) {
    console.log(`    id=${String(r.id).padEnd(6)} ${String(r.closer_examiner).padEnd(18)} `
      + `office=${String(r.office_lookup_code ?? '(null)').padEnd(7)} `
      + `lookup=${String(r.lookup_code ?? '(null)').padEnd(7)} `
      + `is_eo=${String(r.is_escrow_officer).padEnd(6)} `
      + `email=${String(r.email ?? '(null)').padEnd(24)} `
      + `updated=${new Date(String(r.updated_at)).toISOString()}`);
  }
}

(async () => {
  const base = process.env.SOFTPRO_API_URL!;
  const port = new URL(base).port;
  console.log(`SoftPro base URL: ${base}`);
  console.log(`  port ${port} => ${port === '3000' ? 'PRODUCTION' : 'NOT production'}; read is GET GetLookuptable only\n`);
  console.log(`Mode: ${APPLY ? 'APPLY (will write contacts rows)' : 'MEASURE ONLY (no writes)'}\n`);

  // ── 1. Re-read the vendor's current truth. Nothing reused from earlier. ────
  const fetched = await fetchSyncContactRows('Escrow Officer', { modifiedSince: null });
  if (fetched.error) throw new Error(`vendor read failed: ${fetched.error}`);
  console.log(`=== 1. Vendor read: ${fetched.items.length} rows, fresh, modifiedSince omitted ===\n`);

  const targetRows = fetched.items.filter((it) => TARGETS.includes((it[CODE] ?? '').trim()));
  console.log(`  matched ${targetRows.length} of ${TARGETS.length} targets on the feed`);
  for (const it of targetRows) {
    console.log(`    ${(it[CODE] ?? '').padEnd(18)} keys=${JSON.stringify(Object.keys(it))}`);
  }

  // ── 2. The diff about to be applied. ──────────────────────────────────────
  console.log('\n\n=== 2. Diff about to be applied: DB now -> vendor now ===\n');
  const before = await snapshot(TARGETS);
  show('BEFORE (officer rows, closer_examiner set):', before);

  console.log('\n  field-by-field:');
  for (const it of targetRows) {
    const code = (it[CODE] ?? '').trim();
    const row = before.find((r) => r.closer_examiner === code);
    const vOffice = (it['Office LookupCode'] ?? '').trim();
    const vName = (it['Officer Name'] ?? '').trim();
    const vEmail = (it['Email'] ?? '').trim();
    console.log(`\n    ${code}  (contacts id ${row ? row.id : '(no officer row)'})`);
    console.log(`      office_lookup_code : ${JSON.stringify(row?.office_lookup_code ?? null)} -> ${JSON.stringify(vOffice || null)}`);
    console.log(`      lookup_code        : ${JSON.stringify(row?.lookup_code ?? null)} -> ${JSON.stringify(vOffice || null)}`);
    console.log(`      officer_name       : ${JSON.stringify(row?.officer_name ?? null)} -> ${JSON.stringify(vName || null)}`);
    console.log(`      email              : ${JSON.stringify(row?.email ?? null)} -> ${JSON.stringify(vEmail || null)}`);
    console.log(`      is_escrow_officer  : ${String(row?.is_escrow_officer)} -> true`);
  }

  // Pre-flight: would the dedupe guard skip any of these? It skips a PCT\ row
  // when a contact with the same email carries a NON-PCT\ source_id.
  console.log('\n\n  pre-flight, dedupe guard (skips if a non-PCT source_id shares the email):');
  for (const it of targetRows) {
    const email = (it['Email'] ?? '').trim();
    if (!email) { console.log(`    ${(it[CODE] ?? '').padEnd(18)} feed email empty -> guard cannot fire`); continue; }
    const [hit] = await sql`
      select count(*)::int as n from contacts
       where email = ${email} and source_id is not null and left(source_id, 4) <> ${'PCT\\'}
    ` as unknown as Row[];
    console.log(`    ${(it[CODE] ?? '').padEnd(18)} canonical hits=${String(hit!.n)} -> ${Number(hit!.n) > 0 ? 'WOULD BE SKIPPED' : 'not skipped'}`);
  }

  if (!APPLY) {
    console.log('\n\nMEASURE ONLY — nothing written. Re-run with --apply.\n');
    await sql.end();
    process.exit(0);
  }

  // ── 3. Apply, through the real production write path. ─────────────────────
  console.log('\n\n=== 3. Applying via syncContactRows (production path, guard active) ===\n');
  const result = await syncContactRows('Escrow Officer', targetRows);
  console.log(JSON.stringify(result, null, 2));

  // ── 4. Verify. ────────────────────────────────────────────────────────────
  console.log('\n\n=== 4. Verify: the four officer rows after the write ===\n');
  const after = await snapshot(TARGETS);
  show('AFTER:', after);

  console.log('\n  vendor match check, per officer:');
  let allMatch = true;
  for (const it of targetRows) {
    const code = (it[CODE] ?? '').trim();
    const row = after.find((r) => r.closer_examiner === code);
    const rejected = (result.rejected ?? []).some((r) => r.lookupCode === code);
    if (rejected) {
      console.log(`    ${code.padEnd(18)} REJECTED FOR SHAPE — deliberately unsynced, escalate to SoftPro`);
      continue;
    }
    const vOffice = (it['Office LookupCode'] ?? '').trim();
    const vName = (it['Officer Name'] ?? '').trim();
    const vEmail = (it['Email'] ?? '').trim();
    const problems: string[] = [];
    if (String(row?.office_lookup_code ?? '') !== vOffice) problems.push('office_lookup_code');
    if (String(row?.lookup_code ?? '') !== vOffice) problems.push('lookup_code');
    if (String(row?.officer_name ?? '') !== vName) problems.push('officer_name');
    if (String(row?.email ?? '') !== vEmail) problems.push('email');
    if (row?.is_escrow_officer !== true) problems.push('is_escrow_officer');
    if (problems.length > 0) allMatch = false;
    console.log(`    ${code.padEnd(18)} ${problems.length === 0 ? 'MATCHES VENDOR' : 'MISMATCH: ' + problems.join(', ')}`);
  }
  console.log(`\n  all non-rejected officers match vendor: ${allMatch}`);

  const vidaca = after.find((r) => r.closer_examiner === 'PCT\\lvidaca');
  console.log(`\n  VIDACA office_lookup_code = ${JSON.stringify(vidaca?.office_lookup_code)}  `
    + `(expected "GLT"): ${vidaca?.office_lookup_code === 'GLT' ? 'CONFIRMED' : 'NOT GLT'}`);

  console.log('\n  control — Ayala and Quintanar, not touched, still working:');
  show('', await snapshot(CONTROL));

  console.log('\n  address-book twins, which must NOT have been written:');
  const twins = await sql`
    select id, officer_name, office_lookup_code, lookup_code, email, closer_examiner, updated_at
      from contacts where id in (17165, 10999, 10642, 8996) order by id
  ` as unknown as Row[];
  for (const r of twins) {
    console.log(`    id=${String(r.id).padEnd(6)} closer_examiner=${JSON.stringify(r.closer_examiner)} `
      + `lookup=${String(r.lookup_code)} updated=${new Date(String(r.updated_at)).toISOString()}`);
  }

  // ── 5. Payload consequence for a Vidaca order. BUILD AND PRINT ONLY. ──────
  console.log('\n\n=== 5. Payload consequence for a new Vidaca order (BUILT, NEVER SENT) ===\n');

  const vidacaContact = (over: Partial<ResolvedContact> = {}): ResolvedContact => ({
    id: Number(vidaca!.id),
    fullName: String(vidaca!.officer_name),
    firstName: 'Lupe', lastName: 'Vidaca',
    email: String(vidaca!.email ?? ''), phone: null,
    companyName: 'Pacific Coast Title',
    lookupCode: String(vidaca!.lookup_code ?? ''),
    flookupCode: null,
    officeLookupCode: String(vidaca!.office_lookup_code ?? ''),
    softproLookupCode: String(vidaca!.softpro_lookup_code ?? ''),
    closerExaminer: String(vidaca!.closer_examiner ?? ''),
    officerName: String(vidaca!.officer_name ?? ''),
    softproUserType: null, userType: null,
    address1: null, city: null, state: null, zip: null,
    ...over,
  });

  const input: CreateOrderInput = {
    orderType: 'Title & Escrow',
    isRushOrder: false,
    property: { address: '123 Main St', city: 'Glendale', state: 'CA', zip: '91203' },
    seller: { firstName: 'TBD', lastName: 'TBD', isOrganization: false },
    buyer: { firstName: 'Buyer', lastName: 'One', isOrganization: false },
    transaction: {
      type: 'Purchase', product: 'Residential',
      salesAmount: 500000, loanAmount: 400000, coverageAmount: 500000,
      escrowNumber: 'PAYLOAD-PREVIEW-NOT-SENT', underwriterCode: 'WC',
    },
  };
  const enriched = { apn: '5641-001-002', legal: 'Lot 1', county: 'Los Angeles' };

  // (a) Her real role. LookUpCodeTitleOffice comes from the TITLE officer, so
  //     her office code does not reach the wire in this shape at all.
  const asEscrow = buildSoftProPayload(input, enriched, { escrowOfficer: vidacaContact() })
    .transactionDetails as Record<string, unknown>;
  console.log('  (a) Vidaca as ESCROW officer, no title officer assigned:');
  console.log(`      LookUpCodeEscrowOfficer = ${JSON.stringify(asEscrow.LookUpCodeEscrowOfficer)}`);
  console.log(`      LookUpCodeTitleOffice   = ${JSON.stringify(asEscrow.LookUpCodeTitleOffice)}   <- head-office default, not her office code`);
  console.log(`      TitleOffice             = ${JSON.stringify(asEscrow.TitleOffice ?? null)}`);

  // (b) The shape where office_lookup_code IS the branch code on the wire.
  const asTitle = buildSoftProPayload(input, enriched, { titleOfficer: vidacaContact() })
    .transactionDetails as Record<string, unknown>;
  console.log('\n  (b) Vidaca in the TITLE officer slot — the case where her');
  console.log('      office_lookup_code becomes the branch code on the wire:');
  console.log(`      LookUpCodeTitleOffice   = ${JSON.stringify(asTitle.LookUpCodeTitleOffice)}`);
  console.log(`      TitleOffice             = ${JSON.stringify(asTitle.TitleOffice)}`);
  console.log(`      (before this resync her office_lookup_code was "OCT", so this field would have read "OCT")`);

  console.log('\n  full transactionDetails for (b), built and printed, NOT sent:\n');
  console.log(JSON.stringify(asTitle, null, 2));

  await sql.end();
  process.exit(0);
})();
