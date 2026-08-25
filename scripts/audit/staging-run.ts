/**
 * STAGING WRITE RUN — both open questions, one session, one adapter state.
 *
 * PHASE 1  Why do creates 400?  A 2x2 that separates two explanations which
 *          the production log cannot distinguish (0 of 15 attempts separate
 *          them; the branch-not-in-switch reading is right on 15/15 and the
 *          examiner-mismatch reading on 8/15, silent on the rest).
 *
 *          The adapter's CreateOrders suffix switch is:
 *              case "glt": Suffix = "GLT"; break;
 *              case "oct": Suffix = "OCT"; break;
 *          with NO default. Every failure in production carried a branch
 *          outside that set (PCT, PRV, absent); every success carried GLT or
 *          OCT. So does the branch matter, or the examiner?
 *
 *                                  examiner MATCHES branch   examiner MISMATCHED
 *            branch in switch      P1  GLT + rdickerson      P3  OCT + aballesteros
 *            branch NOT in switch  P2  PRV + aballesteros    P4  PRV + rdickerson
 *
 *          P2 and P3 are the discriminating cells and predict OPPOSITE results:
 *            switch hypothesis   -> P1 ok, P3 ok, P2 FAIL, P4 FAIL
 *            mismatch hypothesis -> P1 ok, P2 ok, P3 FAIL, P4 FAIL
 *
 *          If P2 fails with a perfectly matched Porterville examiner, the
 *          two-case switch is convicted and the fix is Aashima's, in config —
 *          NOT a remap in resolveBranchCode, which would "fix" the 400 by
 *          filing Visalia orders under the wrong branch.
 *
 * PHASE 2  How long is the wrong-address window?  Two creates differing only in
 *          the casing of the street, sampled at 0s / 60s / 5min / 30min.
 *
 *          Address1 is a plain text field with no lookup; the adapter writes it
 *          verbatim and never revisits it. SO IF Address1 CHANGES AFTER 0s, THE
 *          ADAPTER IS EXONERATED and the writer is SoftPro-side normalisation
 *          or another system — the legacy PHP platform still writes to these
 *          orders. ModifiedDate is captured at every sample so a third-party
 *          touch is visible rather than inferred.
 *
 *          City and Zip ARE lookup-mediated and are therefore in scope for the
 *          audit's leaking-handler bug, which acts at write time and is
 *          HISTORY-DEPENDENT: every order created since the last adapter
 *          restart leaves a handler that can interfere. They are sampled too,
 *          but they only mean anything on a freshly restarted adapter.
 *
 * PRECONDITIONS, all enforced below:
 *   SOFTPRO_API_URL contains :8081
 *   SOFTPRO_USER_ID set
 *   ADAPTER_RESTARTED=yes   — set only after restarting the staging adapter, so
 *                             the handler stack is empty. Without it the same
 *                             script gives different answers on different days.
 */
import { getOrderDetails, createOrder } from '../../src/lib/integrations/softpro/client';

const PROD_CONTROL = '20021378-GLT';
const SAMPLES_MS = [0, 60_000, 300_000, 1_800_000];

// Verified against contacts: rdickerson is Glendale, aballesteros is Porterville.
const GLENDALE_EXAMINER = 'PCT\\rdickerson';
const PORTERVILLE_EXAMINER = 'PCT\\aballesteros';

interface Probe { id: string; branch: string; examiner: string; note: string; street?: string }

const MATRIX: Probe[] = [
  { id: 'P1', branch: 'GLT', examiner: GLENDALE_EXAMINER, note: 'in switch,  examiner matches   (control — must succeed)' },
  { id: 'P2', branch: 'PRV', examiner: PORTERVILLE_EXAMINER, note: 'NOT in switch, examiner MATCHES  <-- DISCRIMINATING' },
  { id: 'P3', branch: 'OCT', examiner: PORTERVILLE_EXAMINER, note: 'in switch,  examiner mismatched  <-- DISCRIMINATING' },
  { id: 'P4', branch: 'PRV', examiner: GLENDALE_EXAMINER, note: 'NOT in switch, examiner mismatched' },
];

const WINDOW: Probe[] = [
  { id: 'W-caps ', branch: 'GLT', examiner: GLENDALE_EXAMINER, note: 'all caps', street: '31195 EMERY CT' },
  { id: 'W-mixed', branch: 'GLT', examiner: GLENDALE_EXAMINER, note: 'mixed case', street: '31195 Emery Ct' },
];

function payload(p: Probe): Record<string, unknown> {
  return {
    baseDetails: { OrderType: 'Title only', ProjectName: 'PCT', IsRushOrder: false },
    sellerDetails: {
      PrimaryOwnerFirstName: '', PrimaryOwnerMiddleName: '', PrimaryOwnerLastName: '',
      SecondaryOwnerFirstName: '', SecondaryOwnerMiddleName: '', SecondaryOwnerLastName: '',
      OrganizationType: '', IsOrganization: 'false',
    },
    personalDetails: {
      CompanyLookupCode: '', ClientLookupCode: '', UserType: 'EscrowCompany',
      CompanyName: 'TEST-PARITY-PROBE', Email: 'test@example.com',
      FirstName: 'TEST', LastName: 'PROBE', Telephone: '', Address: '', City: '',
      ZipCode: '', State: 'CA', EmailNotifications: false, SalesRep: '',
    },
    propertyDetails: [{
      Address1: p.street ?? '31195 EMERY CT', Address2: '',
      APNNumberParcelID: '0300-481-01-0000', Country: 'San Bernardino',
      Description: 'TRACT 9962 LOT 1', IsPrimaryResidence: true,
      City: 'REDLANDS', Zip: '92373', State: 'CA',
      EscrowBriefLegalLookupCode: null, EscrowBriefLegal: 'TRACT 9962 LOT 1',
    }],
    transactionDetails: {
      LookUpCodeTitleOffice: p.branch, TitleOffice: p.examiner,
      Product: 'Short Form', EscrowNumber: '', SalesAmount: 0,
      TransactionType: 'Refinance', LoanNumber: '', LoanAmount: 1,
      UnderwriterLookUpCode: 'WC', CoverageAmount: 1,
      PrimaryBorrowerFirstName: 'TEST', PrimaryBorrowerMiddleName: '', PrimaryBorrowerLastName: 'PROBE',
      SecondaryBorrowerFirstName: '', SecondaryBorrowerMiddleName: '', SecondaryBorrowerLastName: '',
      IsOrganization: false, OrganizationType: '',
      LookUpCodeEscrowOfficer: null, EscrowOfficerName: null,
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (o: unknown, k: string): string => {
  if (!o || typeof o !== 'object') return '';
  const rec = o as Record<string, unknown>;
  const key = Object.keys(rec).find((x) => x.toLowerCase() === k.toLowerCase());
  return key === undefined ? '' : String(rec[key] ?? '').trim();
};

(async () => {
  const url = process.env.SOFTPRO_API_URL ?? '';
  if (!url.includes(':8081')) {
    console.error(`REFUSING. SOFTPRO_API_URL is "${url}". This script writes, and only to :8081.`);
    process.exit(1);
  }
  if (!process.env.SOFTPRO_USER_ID) {
    console.error('REFUSING. SOFTPRO_USER_ID is not set; createOrder cannot be signed.');
    process.exit(1);
  }
  if (process.env.ADAPTER_RESTARTED !== 'yes') {
    console.error(
      'REFUSING. Set ADAPTER_RESTARTED=yes, and only after actually restarting the\n' +
      'staging adapter. The leaking-handler bug is history-dependent: every order\n' +
      'created since the last restart leaves a handler that can interfere with the\n' +
      'City/Zip results, so on a warm adapter this script gives a different answer\n' +
      'every day and the difference means nothing.',
    );
    process.exit(1);
  }

  const sep = await getOrderDetails({ dateFrom: '2026-08-24', dateTo: '2026-08-26', orderNumber: PROD_CONTROL });
  const n = sep.success && Array.isArray(sep.data) ? sep.data.length : -1;
  console.log(`separation: staging returned ${n} record(s) for production order ${PROD_CONTROL}`);
  if (n !== 0) { console.error('ABORT — staging returned production data.'); process.exit(1); }
  console.log('separation confirmed. adapter restart attested.\n');

  const day = new Date().toISOString().slice(0, 10);

  // ── PHASE 1 ───────────────────────────────────────────────────────────────
  console.log('═'.repeat(96));
  console.log('PHASE 1 — branch-in-switch vs examiner-mismatch');
  console.log('═'.repeat(96));
  const results: Record<string, string> = {};
  for (const p of MATRIX) {
    const res = await createOrder(payload(p));
    const outcome = res.success ? `CREATED ${res.data!.orderNumber}` : `FAILED  ${JSON.stringify(res.error?.message ?? res.error)}`;
    results[p.id] = res.success ? 'ok' : 'fail';
    console.log(`  ${p.id}  branch=${p.branch.padEnd(4)} examiner=${p.examiner.padEnd(18)} ${p.note}`);
    console.log(`      -> ${outcome}\n`);
  }

  console.log('  VERDICT');
  const { P1, P2, P3, P4 } = results;
  if (P1 !== 'ok') {
    console.log('    P1 (the control) failed. Something else is wrong; the matrix is not interpretable.');
  } else if (P2 === 'fail' && P3 === 'ok') {
    console.log('    THE SWITCH IS CONVICTED. A perfectly matched Porterville examiner still fails');
    console.log('    on a branch the adapter has no case for, and a mismatched examiner succeeds on');
    console.log('    one it does. Fix belongs in the adapter config, NOT in resolveBranchCode —');
    console.log('    remapping PRV to GLT/OCT there would file Visalia orders under the wrong branch.');
  } else if (P2 === 'ok' && P3 === 'fail') {
    console.log('    EXAMINER MISMATCH is the cause; the two-case switch is not implicated.');
  } else if (P2 === 'fail' && P3 === 'fail') {
    console.log('    BOTH conditions are independently fatal.');
  } else {
    console.log('    Neither hypothesis survives — both discriminating cells succeeded.');
  }

  // ── PHASE 2 ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(96));
  console.log('PHASE 2 — the wrong-address window');
  console.log('═'.repeat(96));
  const created: Array<Probe & { on: string }> = [];
  for (const p of WINDOW) {
    const res = await createOrder(payload(p));
    console.log(`  ${p.id}  sent "${p.street}"  -> ${res.success ? res.data!.orderNumber : 'FAILED ' + JSON.stringify(res.error?.message)}`);
    if (res.success) created.push({ ...p, on: res.data!.orderNumber });
  }
  if (created.length === 0) { console.error('  no orders created; nothing to sample'); process.exit(1); }

  console.log(`\n  ${'at'.padEnd(7)} ${'variant'.padEnd(9)} ${'order'.padEnd(15)} ${'Address'.padEnd(24)} ${'City'.padEnd(13)} ${'Zip'.padEnd(7)} ModifiedDate`);
  let prev = 0;
  const first: Record<string, string> = {};
  for (const ms of SAMPLES_MS) {
    await sleep(Math.max(0, ms - prev));
    prev = ms;
    for (const o of created) {
      const d = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: o.on });
      const rec = (d.success && Array.isArray(d.data) ? d.data[0] : null) as Record<string, unknown> | null;
      const addr = rec ? at(rec, 'Address') : '(no record)';
      const key = `${o.id}`;
      if (ms === 0) first[key] = addr;
      const drifted = ms > 0 && first[key] !== undefined && first[key] !== addr;
      console.log(
        `  ${(ms / 1000 + 's').padEnd(7)} ${o.id.padEnd(9)} ${o.on.padEnd(15)} ` +
        `${`"${addr}"`.padEnd(24)} ${(rec ? at(rec, 'City') : '').padEnd(13)} ${(rec ? at(rec, 'Zip') : '').padEnd(7)} ` +
        `${rec ? at(rec, 'ModifiedDate') : ''}` +
        (drifted ? '   <-- ADDRESS CHANGED AFTER WRITE: adapter exonerated, find the other writer' : ''),
      );
    }
  }

  console.log('\nTEST orders left on staging:');
  for (const o of created) console.log(`  ${o.on}  ${o.id}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
