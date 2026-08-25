/**
 * STAGING WRITE TEST — measures the SHAPE OF THE DELAY, not the casing.
 *
 * The finding changed. SoftPro does not permanently corrupt "31195 EMERY CT";
 * it expands street abbreviations on a delay and gets there in the end
 * ("Emery Court"). What it held in between was "Emery City" — a street that
 * does not exist — for at least three hours. Anything generated in that window
 * carries a wrong address.
 *
 * So the question is no longer "does casing trigger corruption" but "does a
 * mixed-case send land correct immediately, or does it also pass through a
 * wrong intermediate value, and how long does that window last".
 *
 * WILL NOT RUN WITHOUT:
 *   SOFTPRO_USER_ID            (vercel env pull, or the dashboard)
 *   SOFTPRO_API_URL=http://100.29.181.61:8081/api/   (staging)
 *
 * SAFETY, enforced below and non-negotiable:
 *   - refuses to run unless SOFTPRO_API_URL contains :8081
 *   - re-proves separation first by asking staging for a known PRODUCTION order
 *     and aborting if it comes back with data
 */
import { getOrderDetails, createOrder } from '../../src/lib/integrations/softpro/client';

const PROD_CONTROL = '20021378-GLT';
const SAMPLES_MS = [0, 60_000, 300_000, 1_800_000];

const VARIANTS = [
  { label: 'all-caps ', street: '31195 EMERY CT' },
  { label: 'mixedcase', street: '31195 Emery Ct' },
];

function payload(street: string): Record<string, unknown> {
  return {
    baseDetails: { OrderType: 'Title only', ProjectName: 'PCT', IsRushOrder: false },
    sellerDetails: {
      PrimaryOwnerFirstName: '', PrimaryOwnerMiddleName: '', PrimaryOwnerLastName: '',
      SecondaryOwnerFirstName: '', SecondaryOwnerMiddleName: '', SecondaryOwnerLastName: '',
      OrganizationType: '', IsOrganization: 'false',
    },
    personalDetails: {
      CompanyLookupCode: '', ClientLookupCode: '', UserType: 'EscrowCompany',
      CompanyName: 'TEST-ADDRESS-WINDOW', Email: 'test@example.com',
      FirstName: 'TEST', LastName: 'WINDOW', Telephone: '', Address: '', City: '',
      ZipCode: '', State: 'CA', EmailNotifications: false, SalesRep: '',
    },
    propertyDetails: [{
      Address1: street, Address2: '', APNNumberParcelID: '0300-481-01-0000',
      Country: 'San Bernardino', Description: 'TRACT 9962 LOT 1',
      IsPrimaryResidence: true, City: 'Redlands', Zip: '92373', State: 'CA',
      EscrowBriefLegalLookupCode: null, EscrowBriefLegal: 'TRACT 9962 LOT 1',
    }],
    // Branch and examiner deliberately AGREE — see the branch/examiner finding.
    transactionDetails: {
      LookUpCodeTitleOffice: 'GLT', TitleOffice: 'PCT\\rdickerson',
      Product: 'Short Form', EscrowNumber: '', SalesAmount: 0,
      TransactionType: 'Refinance', LoanNumber: '', LoanAmount: 1,
      UnderwriterLookUpCode: 'WC', CoverageAmount: 1,
      PrimaryBorrowerFirstName: 'TEST', PrimaryBorrowerMiddleName: '', PrimaryBorrowerLastName: 'WINDOW',
      SecondaryBorrowerFirstName: '', SecondaryBorrowerMiddleName: '', SecondaryBorrowerLastName: '',
      IsOrganization: false, OrganizationType: '',
      LookUpCodeEscrowOfficer: null, EscrowOfficerName: null,
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const url = process.env.SOFTPRO_API_URL ?? '';
  if (!url.includes(':8081')) {
    console.error(`REFUSING TO RUN. SOFTPRO_API_URL is "${url}" — this test writes, and it writes to :8081 only.`);
    process.exit(1);
  }
  if (!process.env.SOFTPRO_USER_ID) {
    console.error('REFUSING TO RUN. SOFTPRO_USER_ID is not set; createOrder cannot be signed.');
    process.exit(1);
  }

  const sep = await getOrderDetails({ dateFrom: '2026-08-24', dateTo: '2026-08-25', orderNumber: PROD_CONTROL });
  const n = sep.success && Array.isArray(sep.data) ? sep.data.length : -1;
  console.log(`separation check: staging returned ${n} record(s) for production order ${PROD_CONTROL}`);
  if (n !== 0) { console.error('ABORT — staging returned production data.'); process.exit(1); }
  console.log('separation confirmed.\n');

  const day = new Date().toISOString().slice(0, 10);
  const orders: Array<{ label: string; sent: string; on: string; t0: number }> = [];

  for (const v of VARIANTS) {
    const res = await createOrder(payload(v.street));
    const on = res.success ? res.data!.orderNumber : '';
    console.log(`${v.label}  sent "${v.street}"  -> ${on || 'CREATE FAILED: ' + JSON.stringify(res.error)}`);
    if (on) orders.push({ label: v.label, sent: v.street, on, t0: Date.now() });
  }
  if (orders.length === 0) { console.error('no orders created; nothing to sample'); process.exit(1); }

  console.log('\nsampling the stored value over time');
  console.log(`  ${'at'.padEnd(8)} ${'variant'.padEnd(10)} ${'order'.padEnd(16)} stored Address`);
  let prev = 0;
  for (const ms of SAMPLES_MS) {
    await sleep(Math.max(0, ms - prev));
    prev = ms;
    for (const o of orders) {
      const d = await getOrderDetails({ dateFrom: day, dateTo: day, orderNumber: o.on });
      const rec = (d.success && Array.isArray(d.data) ? d.data[0] : null) as Record<string, unknown> | null;
      const stored = rec ? String(rec.Address ?? '') : '(no record)';
      const same = stored.toLowerCase().replace(/[^a-z0-9]/g, '') === o.sent.toLowerCase().replace(/[^a-z0-9]/g, '');
      console.log(`  ${(ms / 1000 + 's').padEnd(8)} ${o.label.padEnd(10)} ${o.on.padEnd(16)} "${stored}"${same ? '' : '   <-- rewritten'}`);
    }
  }
  console.log('\nTEST- orders left on staging:', orders.map((o) => o.on).join(', '));
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
