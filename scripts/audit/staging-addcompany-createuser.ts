/**
 * Staging write: AddCompany then CreateUser, then read both back.
 * Duplicate-code probe: resubmit the same LookupCode / ClientLookupCode.
 *
 * Refuses unless SOFTPRO_API_URL is :8081. Separation check: a known
 * production order must come back empty from staging.
 *
 *   npx tsx --env-file=C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local scripts/audit/staging-addcompany-createuser.ts
 */
import { config } from 'dotenv';
import { addCompany, createUser, getLookupTable, getOrderDetails } from '../../src/lib/integrations/softpro/client';

config({ path: 'C:/Users/gerar/Desktop/TransactionDeskV2/td-hub/.env.local', override: true });
process.env.SOFTPRO_API_URL = 'http://100.29.181.61:8081/api/';
if (!process.env.SOFTPRO_USER_ID?.trim()) {
  // Local .env.local has the token but not the user id. The adapter's
  // CreateUserToken example uses TD_Hub; auth.ts rotation notes TD_Hub_New.
  process.env.SOFTPRO_USER_ID = 'TD_Hub';
}

const PROD_CONTROL = '20021378-GLT';
const STAMP = Date.now().toString(36).slice(-6);
const COMPANY_NAME = `PCT Hub Staging Probe ${STAMP}`;
const ADDRESS1 = `1 Probe ${STAMP} Ave`;
const COMPANY_CODE = `PctH1Pro`; // will uniquify by stamp in name/addr below
const PERSON_FIRST = 'Staging';
const PERSON_LAST = `Probe${STAMP}`;

function codeOf(item: Record<string, string>): string {
  return (item['Lookup Code'] ?? item.LookupCode ?? item.lookup_code ?? '').trim();
}

function nameOf(item: Record<string, string>): string {
  return (item.Name ?? item.name ?? item['Company Name'] ?? item.company_name ?? '').trim();
}

function personName(item: Record<string, string>): string {
  const first = (item.FirstName ?? item['First Name'] ?? '').trim();
  const last = (item.LastName ?? item['Last Name'] ?? '').trim();
  return `${first} ${last}`.trim();
}

(async () => {
  const url = process.env.SOFTPRO_API_URL ?? '';
  if (!url.includes(':8081')) {
    console.error(`REFUSING. SOFTPRO_API_URL is "${url}". Writes only to :8081.`);
    process.exit(1);
  }
  if (!process.env.SOFTPRO_TOKEN || !process.env.SOFTPRO_USER_ID) {
    console.error('REFUSING. SOFTPRO_TOKEN and SOFTPRO_USER_ID must be set.');
    process.exit(1);
  }

  console.log('URL forced to', url);

  const sep = await getOrderDetails({ dateFrom: '2026-08-24', dateTo: '2026-08-26', orderNumber: PROD_CONTROL });
  const n = sep.success && Array.isArray(sep.data) ? sep.data.length : -1;
  console.log(`separation: staging returned ${n} record(s) for production order ${PROD_CONTROL}`);
  if (n !== 0) {
    console.error('ABORT — staging returned production data.');
    process.exit(1);
  }

  const companyLookup = `PctH${STAMP.slice(0, 4)}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || COMPANY_CODE;
  const personLookup = `StaPro${STAMP.slice(0, 4)}`;

  console.log('\n── 1. AddCompany availability ──');
  const companyPayload = {
    Name: COMPANY_NAME,
    Phone: '9495550100',
    Email: `staging-probe-${STAMP}@pct-hub.test`,
    LookupCode: companyLookup,
    Address1: ADDRESS1,
    City: 'Irvine',
    State: 'CA',
    Zip: '92618',
    UserType: 'Lender',
  };
  const add = await addCompany(companyPayload);
  console.log(JSON.stringify({
    success: add.success,
    error: add.error ?? null,
    lookup: companyLookup,
    name: COMPANY_NAME,
  }, null, 2));

  if (!add.success) {
    console.error('AddCompany is not usable on staging. Stop.');
    process.exit(2);
  }

  console.log('\n── 2. AddCompany duplicate LookupCode ──');
  const addDup = await addCompany({ ...companyPayload, Name: `${COMPANY_NAME} DUP` });
  console.log(JSON.stringify({
    success: addDup.success,
    error: addDup.error ?? null,
    message: addDup.error?.message ?? null,
  }, null, 2));

  console.log('\n── 3. CreateUser ──');
  const userPayload = {
    FirstName: PERSON_FIRST,
    LastName: PERSON_LAST,
    Phone: '9495550101',
    Email: `staging-person-${STAMP}@pct-hub.test`,
    ClientLookupCode: personLookup,
    CompanyLookupCode: companyLookup,
    Address1: ADDRESS1,
    City: 'Irvine',
    State: 'CA',
    Zip: '92618',
  };
  const created = await createUser(userPayload);
  console.log(JSON.stringify({
    success: created.success,
    error: created.error ?? null,
    clientLookup: personLookup,
    companyLookup,
  }, null, 2));

  if (!created.success) {
    console.error('CreateUser failed after AddCompany succeeded. Company was left in SoftPro.');
    process.exit(3);
  }

  console.log('\n── 4. CreateUser duplicate ClientLookupCode ──');
  const userDup = await createUser({ ...userPayload, FirstName: 'Other', Email: `staging-other-${STAMP}@pct-hub.test` });
  console.log(JSON.stringify({
    success: userDup.success,
    error: userDup.error ?? null,
    message: userDup.error?.message ?? null,
  }, null, 2));

  console.log('\n── 5. Read back via GetLookupTable (Lender) ──');
  const table = await getLookupTable('Lender');
  const items = table.success && Array.isArray(table.data) ? table.data : [];
  const firm = items.find((row) => codeOf(row) === companyLookup || nameOf(row) === COMPANY_NAME);
  const person = items.find((row) => codeOf(row) === personLookup || personName(row) === `${PERSON_FIRST} ${PERSON_LAST}`);
  console.log(JSON.stringify({
    lookupSuccess: table.success,
    rowCount: items.length,
    error: table.error ?? null,
    companyHit: firm ?? null,
    personHit: person ?? null,
  }, null, 2));

  console.log('\nDONE');
  console.log(JSON.stringify({
    companyLookup,
    personLookup,
    addOk: add.success,
    createOk: created.success,
    addDupMessage: addDup.error?.message ?? (addDup.success ? 'UNEXPECTED_SUCCESS' : null),
    userDupMessage: userDup.error?.message ?? (userDup.success ? 'UNEXPECTED_SUCCESS' : null),
    companyReadBack: !!firm,
    personReadBack: !!person,
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
