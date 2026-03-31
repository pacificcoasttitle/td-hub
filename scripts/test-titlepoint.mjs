/**
 * TitlePoint Integration Test Script
 *
 * Tests the TitlePoint API pipeline for a known property:
 *   1358 5th St, La Verne, CA 91750 (Los Angeles County, APN: 8381-021-001)
 *
 * Usage:
 *   node scripts/test-titlepoint.mjs
 *
 * Required env vars:
 *   TP_BASE_URL, TP_USERNAME, TP_PASSWORD
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import https from 'https';

const BASE_URL = process.env.TP_BASE_URL || '';
const USERNAME = process.env.TP_USERNAME || '';
const PASSWORD = process.env.TP_PASSWORD || '';

const TEST_PROPERTY = {
  address: '1358 5TH ST',
  city: 'LA VERNE',
  state: 'CA',
  county: 'LOS ANGELES',
  apn: '8381-021-001',
  fips: '06037',
};

function rawPost(url, rawBody, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(rawBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    const timer = setTimeout(() => { req.destroy(); reject(new Error('Timeout')); }, timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.write(rawBody);
    req.end();
  });
}

function buildRawBody(params) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&') + '&';
}

function log(label, data) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
  if (typeof data === 'string') {
    console.log(data.length > 1000 ? data.slice(0, 1000) + '\n... [truncated]' : data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function testCreateService4_LegalVesting() {
  log('TEST: CreateService4 (Legal Vesting)', { property: TEST_PROPERTY });

  const params = {
    userID: USERNAME,
    password: PASSWORD,
    serviceType: 'TitlePoint.LegalAndVesting2',
    parameters: `FIPS=${TEST_PROPERTY.fips};APN=${TEST_PROPERTY.apn};Address1=${TEST_PROPERTY.address};City=${TEST_PROPERTY.city}`,
    fipsCode: TEST_PROPERTY.fips,
    department: '',
    orderNo: '',
    customerRef: 'test-50',
    company: '',
    titleOfficer: '',
    orderComment: '',
    starterRemarks: '',
  };

  console.log('\nRequest body (first 200 chars):');
  const body = buildRawBody(params);
  console.log(body.slice(0, 200) + '...');

  const baseUrl = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const url = `${baseUrl}TpsService.asmx/CreateService4?`;
  console.log(`\nURL: ${url}`);

  try {
    const start = Date.now();
    const result = await rawPost(url, body);
    const elapsed = Date.now() - start;

    console.log(`\nHTTP Status: ${result.status}`);
    console.log(`Duration: ${elapsed}ms`);
    console.log(`Response length: ${result.body.length}`);
    console.log(`\nFirst 500 chars of response:`);
    console.log(result.body.slice(0, 500));

    const isXml = result.body.trim().startsWith('<?xml') || result.body.trim().startsWith('<');
    const isHtml = /<html/i.test(result.body.slice(0, 500));
    console.log(`\nIs XML: ${isXml}`);
    console.log(`Is HTML: ${isHtml}`);

    if (isXml && !isHtml) {
      const hasSuccess = /Success/i.test(result.body);
      const requestIdMatch = result.body.match(/<RequestID>([^<]+)<\/RequestID>/);
      console.log(`Contains 'Success': ${hasSuccess}`);
      if (requestIdMatch) console.log(`RequestID: ${requestIdMatch[1]}`);
      return { success: hasSuccess, requestId: requestIdMatch?.[1], raw: result.body };
    }

    return { success: false, error: 'Not valid XML', raw: result.body };
  } catch (err) {
    console.log(`\nERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function testCreateService3_Tax() {
  log('TEST: CreateService3 (Tax)', { property: TEST_PROPERTY });

  const params = {
    userID: USERNAME,
    password: PASSWORD,
    serviceType: 'TitlePoint.TaxSearch',
    parameters: `APN=${TEST_PROPERTY.apn};Property.AutoSearchTaxes=True;Property.AutoSearchProperty=True`,
    state: TEST_PROPERTY.state,
    county: TEST_PROPERTY.county,
    department: '',
    orderNo: '',
    customerRef: 'test-50',
    company: '',
    titleOfficer: '',
    orderComment: '',
    starterRemarks: '',
  };

  const body = buildRawBody(params);
  const baseUrl = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const url = `${baseUrl}TpsService.asmx/CreateService3?`;
  console.log(`URL: ${url}`);

  try {
    const start = Date.now();
    const result = await rawPost(url, body);
    const elapsed = Date.now() - start;

    console.log(`\nHTTP Status: ${result.status}`);
    console.log(`Duration: ${elapsed}ms`);
    console.log(`Response length: ${result.body.length}`);
    console.log(`\nFirst 500 chars of response:`);
    console.log(result.body.slice(0, 500));

    const isXml = result.body.trim().startsWith('<?xml') || result.body.trim().startsWith('<');
    const isHtml = /<html/i.test(result.body.slice(0, 500));
    console.log(`\nIs XML: ${isXml}`);
    console.log(`Is HTML: ${isHtml}`);

    if (isXml && !isHtml) {
      const hasSuccess = /Success/i.test(result.body);
      const requestIdMatch = result.body.match(/<RequestID>([^<]+)<\/RequestID>/);
      console.log(`Contains 'Success': ${hasSuccess}`);
      if (requestIdMatch) console.log(`RequestID: ${requestIdMatch[1]}`);
      return { success: hasSuccess, requestId: requestIdMatch?.[1], raw: result.body };
    }

    return { success: false, error: 'Not valid XML', raw: result.body };
  } catch (err) {
    console.log(`\nERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function testCreateService3_Geo() {
  log('TEST: CreateService3 (Geo Address)', { property: TEST_PROPERTY });

  const params = {
    userID: USERNAME,
    password: PASSWORD,
    serviceType: 'TitlePoint.Geo.Address',
    parameters: `Address.FullAddress=${TEST_PROPERTY.address}, ${TEST_PROPERTY.city}, ${TEST_PROPERTY.state} ${TEST_PROPERTY.fips};General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False;General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False;General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;`,
    state: TEST_PROPERTY.state,
    county: TEST_PROPERTY.county,
    department: '',
    orderNo: '',
    customerRef: 'test-50',
    company: '',
    titleOfficer: '',
    orderComment: '',
    starterRemarks: '',
  };

  const body = buildRawBody(params);
  const baseUrl = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const url = `${baseUrl}TpsService.asmx/CreateService3?`;
  console.log(`URL: ${url}`);

  try {
    const start = Date.now();
    const result = await rawPost(url, body);
    const elapsed = Date.now() - start;

    console.log(`\nHTTP Status: ${result.status}`);
    console.log(`Duration: ${elapsed}ms`);
    console.log(`Response length: ${result.body.length}`);
    console.log(`\nFirst 500 chars of response:`);
    console.log(result.body.slice(0, 500));

    const isXml = result.body.trim().startsWith('<?xml') || result.body.trim().startsWith('<');
    const isHtml = /<html/i.test(result.body.slice(0, 500));
    console.log(`\nIs XML: ${isXml}`);
    console.log(`Is HTML: ${isHtml}`);

    if (isHtml) {
      console.log('\n--- HTML ERROR PAGE DETECTED ---');
      const titleMatch = result.body.match(/<title[^>]*>([^<]+)<\/title>/i);
      const bodyTextMatch = result.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log('Page title:', titleMatch?.[1] ?? '(none)');
      console.log('Text content (first 500 chars):');
      console.log(bodyTextMatch.slice(0, 500));
    }

    if (isXml && !isHtml) {
      const hasSuccess = /Success/i.test(result.body);
      const requestIdMatch = result.body.match(/<RequestID>([^<]+)<\/RequestID>/);
      console.log(`Contains 'Success': ${hasSuccess}`);
      if (requestIdMatch) console.log(`RequestID: ${requestIdMatch[1]}`);
      return { success: hasSuccess, requestId: requestIdMatch?.[1], raw: result.body };
    }

    return { success: false, error: isHtml ? 'HTML error page returned' : 'Not valid XML', raw: result.body };
  } catch (err) {
    console.log(`\nERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('TitlePoint Integration Test');
  console.log(`Base URL: ${BASE_URL || '(not set)'}`);
  console.log(`Username: ${USERNAME ? USERNAME.slice(0, 3) + '***' : '(not set)'}`);
  console.log(`Password: ${PASSWORD ? '***set***' : '(not set)'}`);

  if (!BASE_URL || !USERNAME || !PASSWORD) {
    console.error('\n❌ Missing required env vars: TP_BASE_URL, TP_USERNAME, TP_PASSWORD');
    console.error('Set them and try again.');
    process.exit(1);
  }

  console.log('\n─── Testing FIPS Resolution ───');
  console.log(`County "${TEST_PROPERTY.county}" → FIPS "${TEST_PROPERTY.fips}"`);

  const lvResult = await testCreateService4_LegalVesting();
  const taxResult = await testCreateService3_Tax();
  const geoResult = await testCreateService3_Geo();

  log('SUMMARY', {
    legalVesting: { success: lvResult.success, requestId: lvResult.requestId, error: lvResult.error },
    tax: { success: taxResult.success, requestId: taxResult.requestId, error: taxResult.error },
    geoAddress: { success: geoResult.success, requestId: geoResult.requestId, error: geoResult.error },
  });
}

main().catch(console.error);
