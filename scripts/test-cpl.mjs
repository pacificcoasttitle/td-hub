/**
 * CPL Integration Test Script
 *
 * Tests all 4 underwriter CPL flows: Westcor, FNF, NATIC, Doma.
 * Each step is tested independently so you can see exactly where things break.
 *
 * Usage:
 *   node scripts/test-cpl.mjs                         # test all underwriters
 *   node scripts/test-cpl.mjs --westcor                # test Westcor only
 *   node scripts/test-cpl.mjs --fnf                    # test FNF only
 *   node scripts/test-cpl.mjs --natic                  # test NATIC only
 *   node scripts/test-cpl.mjs --doma                   # test Doma only
 *
 * Required env vars (set the ones for the underwriters you want to test):
 *
 *   Westcor:
 *     WESTCOR_URL, WESTCOR_USERNAME, WESTCOR_PASSWORD, WESTCOR_INTEGRATION_PARTNER
 *
 *   FNF/Commonwealth:
 *     FNF_VENDOR_URL, FNF_USER_URL, FNF_CPL_URL, FNF_CLIENT_ID, FNF_SECRET_KEY, FNF_ON_BEHALF_OF_USER
 *
 *   NATIC:
 *     NATIC_URL, NATIC_USERNAME, NATIC_PASSWORD, NATIC_COMPANY, NATIC_DOCUMENT_ID
 *
 *   Doma:
 *     DOMA_URL, DOMA_USERNAME, DOMA_PASSWORD, DOMA_COMPANY, DOMA_DOCUMENT_ID
 */

const TIMEOUT_MS = 20_000;

const TEST_ORDER = {
  fileNumber: '20015731-OCT',
  property: {
    address: '1358 5TH ST',
    city: 'La Verne',
    state: 'CA',
    zip: '91750',
    county: 'Los Angeles',
  },
  buyers: ['Gerardo Hernandez'],
  sellers: [],
  lender: {
    name: 'Test Lender Corp',
    address: '100 Main St',
    city: 'Los Angeles',
    state: 'CA',
    zip: '90001',
  },
  salesPrice: '0',
  loanAmount: '324234',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function env(key) {
  return process.env[key] ?? '';
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }

async function safeFetch(url, options, label) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(options?.timeoutMs ?? TIMEOUT_MS),
    });
    const elapsed = Date.now() - start;
    return { res, elapsed, error: null };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { res: null, elapsed, error: err.message ?? String(err) };
  }
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── Westcor Tests ────────────────────────────────────────────────────────────

async function testWestcor() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  WESTCOR CPL TEST');
  console.log('═══════════════════════════════════════════\n');

  const cfg = {
    baseUrl: env('WESTCOR_URL'),
    username: env('WESTCOR_USERNAME'),
    password: env('WESTCOR_PASSWORD'),
    integrationPartner: env('WESTCOR_INTEGRATION_PARTNER'),
  };

  // Check config
  if (!cfg.baseUrl) { fail('WESTCOR_URL not set — skipping'); return; }
  if (!cfg.username) { warn('WESTCOR_USERNAME not set'); }
  if (!cfg.password) { warn('WESTCOR_PASSWORD not set'); }
  if (!cfg.integrationPartner) { warn('WESTCOR_INTEGRATION_PARTNER not set'); }

  const base = cfg.baseUrl.endsWith('/') ? cfg.baseUrl : cfg.baseUrl + '/';
  info(`Base URL: ${base}`);
  info(`Integration Partner: ${cfg.integrationPartner || '(empty)'}`);

  // Step 1: Get Token
  console.log('\n  Step 1: OAuth2 Token Request');
  const tokenUrl = `${base}Token`;
  info(`POST ${tokenUrl}`);

  const { res: tokenRes, elapsed: tokenMs, error: tokenErr } = await safeFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: cfg.username,
      password: cfg.password,
      integrationpartner: cfg.integrationPartner,
    }).toString(),
  });

  if (tokenErr) { fail(`Token request failed: ${tokenErr} (${tokenMs}ms)`); return; }

  const tokenStatus = tokenRes.status;
  const tokenBody = await tokenRes.text();
  info(`HTTP ${tokenStatus} (${tokenMs}ms)`);

  if (tokenStatus !== 200) {
    fail(`Token request returned ${tokenStatus}`);
    console.log(`  Response: ${tokenBody.slice(0, 500)}`);
    return;
  }

  let tokenData;
  try { tokenData = JSON.parse(tokenBody); } catch { fail('Token response not JSON'); return; }

  const accessToken = tokenData.access_token;
  if (!accessToken) { fail('No access_token in response'); console.log(`  Response keys: ${Object.keys(tokenData).join(', ')}`); return; }

  pass(`Got access token: ${accessToken.slice(0, 20)}...`);

  const groups = typeof tokenData.groups === 'string' ? JSON.parse(tokenData.groups) : (tokenData.groups ?? []);
  if (Array.isArray(groups) && groups.length > 0) {
    pass(`Got ${groups.length} branch group(s):`);
    for (const g of groups.slice(0, 5)) {
      info(`  ${g.agencyName ?? g.name ?? '?'} — Agent#: ${g.agentNumber ?? g.agencyNumber ?? '?'}, ${g.city ?? ''}, ${g.state ?? ''}`);
    }
    if (groups.length > 5) info(`  ... and ${groups.length - 5} more`);
  } else {
    warn('No branch groups returned in token response');
  }

  // Step 2: Create/Update Order
  console.log('\n  Step 2: Create/Update Order in Westcor');
  const orderBody = {
    agent: cfg.integrationPartner,
    fileNumber: TEST_ORDER.fileNumber,
    requestorEmail: '',
    purchasePrice: parseFloat(TEST_ORDER.salesPrice) || 0,
    property: {
      address1: TEST_ORDER.property.address,
      city: TEST_ORDER.property.city,
      state: TEST_ORDER.property.state,
      zip: TEST_ORDER.property.zip,
      county: TEST_ORDER.property.county,
    },
    buyers: TEST_ORDER.buyers.map(n => {
      const parts = n.split(' ');
      return { firstName: parts.slice(0, -1).join(' ') || parts[0], lastName: parts.at(-1) || '' };
    }),
    sellers: [],
    lenders: TEST_ORDER.lender ? [{
      name: TEST_ORDER.lender.name,
      address1: TEST_ORDER.lender.address,
      city: TEST_ORDER.lender.city,
      state: TEST_ORDER.lender.state,
      zip: TEST_ORDER.lender.zip,
      loanAmount: parseFloat(TEST_ORDER.loanAmount) || 0,
    }] : [],
  };

  const orderUrl = `${base}VendorApi/Order/Update/${cfg.integrationPartner}`;
  info(`POST ${orderUrl}`);

  const { res: orderRes, elapsed: orderMs, error: orderErr } = await safeFetch(orderUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(orderBody),
  });

  if (orderErr) { fail(`Order create failed: ${orderErr} (${orderMs}ms)`); return; }

  const orderStatus = orderRes.status;
  const orderText = await orderRes.text();
  info(`HTTP ${orderStatus} (${orderMs}ms)`);

  if (orderStatus !== 200) {
    fail(`Order create returned ${orderStatus}`);
    console.log(`  Response: ${orderText.slice(0, 500)}`);
    return;
  }

  let orderData;
  try { orderData = JSON.parse(orderText); } catch { fail('Order response not JSON'); return; }

  const westcorOrderId = String(orderData.id ?? orderData.westcor_order_id ?? '');
  if (!westcorOrderId) { fail('No order ID in Westcor response'); console.log(`  Response keys: ${Object.keys(orderData).join(', ')}`); return; }

  pass(`Westcor Order ID: ${westcorOrderId}`);
  if (orderData.orderBuyers) info(`Buyers: ${JSON.stringify(orderData.orderBuyers)}`);
  if (orderData.orderLenders) info(`Lenders: ${JSON.stringify(orderData.orderLenders)}`);

  // Step 3: PrepareAddCPL (get available forms)
  console.log('\n  Step 3: Get CPL Forms (PrepareAddCPL)');
  const prepUrl = `${base}VendorApi/ClosingLetters/PrepareAddCPL/${westcorOrderId}/${cfg.integrationPartner}`;
  info(`GET ${prepUrl}`);

  const { res: prepRes, elapsed: prepMs, error: prepErr } = await safeFetch(prepUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (prepErr) { fail(`PrepareAddCPL failed: ${prepErr} (${prepMs}ms)`); return; }

  const prepStatus = prepRes.status;
  const prepText = await prepRes.text();
  info(`HTTP ${prepStatus} (${prepMs}ms)`);

  if (prepStatus !== 200) {
    fail(`PrepareAddCPL returned ${prepStatus}`);
    console.log(`  Response: ${prepText.slice(0, 500)}`);
    return;
  }

  let prepData;
  try { prepData = JSON.parse(prepText); } catch { fail('PrepareAddCPL response not JSON'); return; }

  const rawForms = prepData.cplForms ?? prepData.Forms ?? [];
  if (rawForms.length === 0) {
    warn('No CPL forms returned — cannot proceed to generate');
    console.log(`  Full response: ${JSON.stringify(prepData, null, 2).slice(0, 1000)}`);
    return;
  }

  const forms = rawForms.map(f => ({
    id: String(f.id ?? f.FormId ?? ''),
    name: String(f.name ?? f.FormName ?? ''),
  }));

  pass(`Got ${forms.length} CPL form(s):`);
  for (const f of forms) { info(`  [${f.id}] ${f.name}`); }

  // Pick single transaction form
  const singleForm = forms.find(f => /single/i.test(f.name) && !/multiple|blanket/i.test(f.name)) ?? forms[0];
  info(`Selected form: [${singleForm.id}] ${singleForm.name}`);

  // Step 4: Generate CPL PDF
  console.log('\n  Step 4: Generate CPL PDF');
  const cplBody = {
    ...orderBody,
    id: parseInt(westcorOrderId, 10) || 0,
    cpl: [{
      cplFormId: parseInt(singleForm.id, 10) || 0,
      protectLender: true,
      isDualCPL: false,
    }],
  };

  info(`POST ${orderUrl} (with cpl array)`);

  const { res: cplRes, elapsed: cplMs, error: cplErr } = await safeFetch(orderUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cplBody),
    timeoutMs: 30_000,
  });

  if (cplErr) { fail(`CPL generation failed: ${cplErr} (${cplMs}ms)`); return; }

  const cplStatus = cplRes.status;
  const cplText = await cplRes.text();
  info(`HTTP ${cplStatus} (${cplMs}ms)`);

  if (cplStatus !== 200) {
    fail(`CPL generation returned ${cplStatus}`);
    console.log(`  Response: ${cplText.slice(0, 500)}`);
    return;
  }

  let cplData;
  try { cplData = JSON.parse(cplText); } catch { fail('CPL response not JSON'); return; }

  const cplEntry = cplData.cpl?.[0];
  if (!cplEntry) {
    warn('No cpl[] array in response');
    console.log(`  Response keys: ${Object.keys(cplData).join(', ')}`);
    console.log(`  Full response: ${JSON.stringify(cplData, null, 2).slice(0, 2000)}`);
    return;
  }

  const pdfB64 = cplEntry.fileInformation?.fileAsBase64 ?? cplEntry.FileInformation?.FileAsBase64 ?? '';
  const cplId = cplEntry.id ?? cplEntry.cplNumber ?? '';

  if (pdfB64) {
    pass(`CPL PDF received! ID: ${cplId}, Base64 length: ${pdfB64.length} chars (~${Math.round(pdfB64.length * 0.75 / 1024)} KB)`);
  } else {
    warn(`CPL entry returned but no PDF. Keys: ${Object.keys(cplEntry).join(', ')}`);
  }

  console.log('\n  ✅ WESTCOR CPL FLOW COMPLETE\n');
}

// ─── FNF Tests ────────────────────────────────────────────────────────────────

async function testFnf() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  FNF / COMMONWEALTH CPL TEST');
  console.log('═══════════════════════════════════════════\n');

  const cfg = {
    vendorUrl: env('FNF_VENDOR_URL'),
    userUrl: env('FNF_USER_URL'),
    cplUrl: env('FNF_CPL_URL'),
    clientId: env('FNF_CLIENT_ID'),
    secretKey: env('FNF_SECRET_KEY'),
    onBehalfOfUser: env('FNF_ON_BEHALF_OF_USER'),
  };

  if (!cfg.vendorUrl) { fail('FNF_VENDOR_URL not set — skipping'); return; }
  if (!cfg.cplUrl) { warn('FNF_CPL_URL not set'); }

  const vendorBase = cfg.vendorUrl.endsWith('/') ? cfg.vendorUrl : cfg.vendorUrl + '/';
  const userBase = (cfg.userUrl || '').replace(/\/$/, '') + '/';
  const cplBase = (cfg.cplUrl || '').replace(/\/$/, '') + '/';

  info(`Vendor URL: ${vendorBase}`);
  info(`User URL:   ${userBase}`);
  info(`CPL URL:    ${cplBase}`);
  info(`Client ID:  ${cfg.clientId || '(empty)'}`);

  // Step 1: Get Vendor Token
  console.log('\n  Step 1: Get Vendor JWT Token');
  const vendorTokenUrl = `${vendorBase}api/FnfAuthIdentityProvider/GetToken`;
  info(`POST ${vendorTokenUrl}`);

  const { res: vtRes, elapsed: vtMs, error: vtErr } = await safeFetch(vendorTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: cfg.clientId, secretKey: cfg.secretKey }),
  });

  if (vtErr) { fail(`Vendor token failed: ${vtErr} (${vtMs}ms)`); return; }

  const vtStatus = vtRes.status;
  const vtText = await vtRes.text();
  info(`HTTP ${vtStatus} (${vtMs}ms)`);

  if (vtStatus !== 200) {
    fail(`Vendor token returned ${vtStatus}`);
    console.log(`  Response: ${vtText.slice(0, 500)}`);
    return;
  }

  let vtData;
  try { vtData = JSON.parse(vtText); } catch { fail('Vendor token response not JSON'); return; }

  const vendorToken = vtData.jwtToken ?? vtData.token ?? '';
  if (!vendorToken) { fail('No vendor token in response'); console.log(`  Keys: ${Object.keys(vtData).join(', ')}`); return; }

  pass(`Got vendor token: ${vendorToken.slice(0, 20)}...`);

  // Step 2: Get User Token (on-behalf-of)
  console.log('\n  Step 2: Get User Token (on-behalf-of)');
  if (!cfg.userUrl) { warn('FNF_USER_URL not set — skipping user token'); return; }

  const userTokenUrl = `${userBase}userToken`;
  info(`POST ${userTokenUrl}`);

  const { res: utRes, elapsed: utMs, error: utErr } = await safeFetch(userTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: vendorToken, onBehalfOfUser: cfg.onBehalfOfUser }),
  });

  if (utErr) { fail(`User token failed: ${utErr} (${utMs}ms)`); return; }

  const utStatus = utRes.status;
  const utText = await utRes.text();
  info(`HTTP ${utStatus} (${utMs}ms)`);

  if (utStatus !== 200) {
    fail(`User token returned ${utStatus}`);
    console.log(`  Response: ${utText.slice(0, 500)}`);
    return;
  }

  let utData;
  try { utData = JSON.parse(utText); } catch { fail('User token response not JSON'); return; }

  const userToken = utData.user_token ?? utData.userToken ?? utData.token ?? '';
  if (!userToken) { fail('No user token in response'); console.log(`  Keys: ${Object.keys(utData).join(', ')}`); return; }

  pass(`Got user token: ${userToken.slice(0, 20)}...`);

  // Step 3: GetCPLList (SOAP)
  console.log('\n  Step 3: GetCPLList (SOAP)');
  if (!cfg.cplUrl) { warn('FNF_CPL_URL not set — skipping SOAP calls'); return; }

  const soapUrl = `${cplBase}v3/CPLManagement.svc`;
  const getCplListEnvelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    '                  xmlns:v3="http://www.fnf.com/xes/cpl/v3">',
    '  <soapenv:Header/>',
    '  <soapenv:Body>',
    '    <v3:GetCPLList>',
    `      <v3:Token>${escapeXml(userToken)}</v3:Token>`,
    `      <v3:PropertyState>${escapeXml(TEST_ORDER.property.state)}</v3:PropertyState>`,
    `      <v3:PropertyCounty>${escapeXml(TEST_ORDER.property.county)}</v3:PropertyCounty>`,
    '    </v3:GetCPLList>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');

  info(`POST ${soapUrl} (SOAPAction: GetCPLList)`);

  const { res: listRes, elapsed: listMs, error: listErr } = await safeFetch(soapUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'GetCPLList',
      'Authorization': `Bearer ${vendorToken}`,
      'ClientID': cfg.clientId,
    },
    body: getCplListEnvelope,
  });

  if (listErr) { fail(`GetCPLList failed: ${listErr} (${listMs}ms)`); return; }

  const listStatus = listRes.status;
  const listXml = await listRes.text();
  info(`HTTP ${listStatus} (${listMs}ms)`);

  if (listStatus !== 200) {
    fail(`GetCPLList returned ${listStatus}`);
    console.log(`  Response: ${listXml.slice(0, 800)}`);
    return;
  }

  pass('GetCPLList SOAP call succeeded');
  info(`Response XML length: ${listXml.length} chars`);

  const formMatches = listXml.match(/<.*?CPLFormID>(.*?)<\//g) ?? [];
  const formNameMatches = listXml.match(/<.*?CPLFormName>(.*?)<\//g) ?? [];
  if (formMatches.length > 0) {
    pass(`Found ${formMatches.length} CPL form(s) in response`);
    for (let i = 0; i < Math.min(formMatches.length, 5); i++) {
      info(`  Form: ${formMatches[i]} / ${formNameMatches[i] ?? ''}`);
    }
  } else {
    warn('No CPLFormID elements found in SOAP response');
    console.log(`  First 800 chars: ${listXml.slice(0, 800)}`);
  }

  // Step 4: CreateCPL (SOAP) — only if we got forms
  if (formMatches.length > 0) {
    console.log('\n  Step 4: CreateCPL (SOAP)');
    const firstFormId = formMatches[0].replace(/<.*?>/g, '');

    const createEnvelope = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
      '                  xmlns:v3="http://www.fnf.com/xes/cpl/v3">',
      '  <soapenv:Header/>',
      '  <soapenv:Body>',
      '    <v3:CreateCPL>',
      `      <v3:Token>${escapeXml(userToken)}</v3:Token>`,
      `      <v3:CPLFormID>${escapeXml(firstFormId)}</v3:CPLFormID>`,
      `      <v3:FileNumber>${escapeXml(TEST_ORDER.fileNumber)}</v3:FileNumber>`,
      `      <v3:PropertyAddress>${escapeXml(TEST_ORDER.property.address)}</v3:PropertyAddress>`,
      `      <v3:PropertyCity>${escapeXml(TEST_ORDER.property.city)}</v3:PropertyCity>`,
      `      <v3:PropertyState>${escapeXml(TEST_ORDER.property.state)}</v3:PropertyState>`,
      `      <v3:PropertyZip>${escapeXml(TEST_ORDER.property.zip)}</v3:PropertyZip>`,
      `      <v3:PropertyCounty>${escapeXml(TEST_ORDER.property.county)}</v3:PropertyCounty>`,
      `      <v3:BuyerName>${escapeXml(TEST_ORDER.buyers.join('; '))}</v3:BuyerName>`,
      '      <v3:SellerName></v3:SellerName>',
      `      <v3:LenderName>${escapeXml(TEST_ORDER.lender.name)}</v3:LenderName>`,
      `      <v3:LenderAddress>${escapeXml(TEST_ORDER.lender.address)}</v3:LenderAddress>`,
      `      <v3:LenderCity>${escapeXml(TEST_ORDER.lender.city)}</v3:LenderCity>`,
      `      <v3:LenderState>${escapeXml(TEST_ORDER.lender.state)}</v3:LenderState>`,
      `      <v3:LenderZip>${escapeXml(TEST_ORDER.lender.zip)}</v3:LenderZip>`,
      `      <v3:PurchasePrice>${TEST_ORDER.salesPrice}</v3:PurchasePrice>`,
      `      <v3:LoanAmount>${TEST_ORDER.loanAmount}</v3:LoanAmount>`,
      '    </v3:CreateCPL>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n');

    info(`POST ${soapUrl} (SOAPAction: CreateCPL)`);

    const { res: createRes, elapsed: createMs, error: createErr } = await safeFetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'CreateCPL',
        'Authorization': `Bearer ${vendorToken}`,
        'ClientID': cfg.clientId,
      },
      body: createEnvelope,
      timeoutMs: 30_000,
    });

    if (createErr) { fail(`CreateCPL failed: ${createErr} (${createMs}ms)`); return; }

    const createStatus = createRes.status;
    const createXml = await createRes.text();
    info(`HTTP ${createStatus} (${createMs}ms)`);

    if (createStatus !== 200) {
      fail(`CreateCPL returned ${createStatus}`);
      console.log(`  Response: ${createXml.slice(0, 800)}`);
      return;
    }

    const hasPdf = createXml.includes('Content') && createXml.length > 2000;
    if (hasPdf) {
      pass(`CreateCPL succeeded! Response XML length: ${createXml.length} chars (likely contains PDF)`);
    } else {
      warn('CreateCPL returned 200 but response may not contain PDF');
      console.log(`  First 800 chars: ${createXml.slice(0, 800)}`);
    }
  }

  console.log('\n  ✅ FNF CPL FLOW COMPLETE\n');
}

// ─── NATIC Tests ──────────────────────────────────────────────────────────────

async function testNatic(underwriter = 'natic') {
  const label = underwriter.toUpperCase();
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ${label} CPL TEST`);
  console.log('═══════════════════════════════════════════\n');

  const prefix = underwriter.toUpperCase();
  const cfg = {
    url: env(`${prefix}_URL`),
    username: env(`${prefix}_USERNAME`),
    password: env(`${prefix}_PASSWORD`),
    company: env(`${prefix}_COMPANY`),
    documentId: env(`${prefix}_DOCUMENT_ID`),
  };

  if (!cfg.url) { fail(`${prefix}_URL not set — skipping`); return; }

  const base = cfg.url.endsWith('/') ? cfg.url : cfg.url + '/';
  info(`Base URL: ${base}`);
  info(`Username: ${cfg.username || '(empty)'}`);
  info(`Company:  ${cfg.company || '(empty)'}`);
  info(`Doc ID:   ${cfg.documentId || '(empty)'}`);

  // Step 1: Authorize
  console.log('\n  Step 1: Authorize');
  const password = underwriter === 'natic' ? cfg.password + '#' : cfg.password;

  const authXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Authorize>',
    `  <Username>${escapeXml(cfg.username)}</Username>`,
    `  <Password>${escapeXml(password)}</Password>`,
    `  <Company>${escapeXml(cfg.company)}</Company>`,
    '</Authorize>',
  ].join('\n');

  const authUrl = `${base}Authorize`;
  info(`POST ${authUrl}`);

  const { res: authRes, elapsed: authMs, error: authErr } = await safeFetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: authXml,
  });

  if (authErr) { fail(`Authorize failed: ${authErr} (${authMs}ms)`); return; }

  const authStatus = authRes.status;
  const authText = await authRes.text();
  info(`HTTP ${authStatus} (${authMs}ms)`);

  if (authStatus !== 200) {
    fail(`Authorize returned ${authStatus}`);
    console.log(`  Response: ${authText.slice(0, 500)}`);
    return;
  }

  pass('Authorize call succeeded');
  info(`Response: ${authText.slice(0, 300)}`);

  // Step 2: GetDocuments
  console.log('\n  Step 2: GetDocuments');
  const docXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<GetDocuments>',
    `  <Username>${escapeXml(cfg.username)}</Username>`,
    `  <Password>${escapeXml(password)}</Password>`,
    `  <Company>${escapeXml(cfg.company)}</Company>`,
    `  <DocumentId>${escapeXml(cfg.documentId)}</DocumentId>`,
    `  <FileNumber>${escapeXml(TEST_ORDER.fileNumber)}</FileNumber>`,
    `  <PropertyAddress>${escapeXml(TEST_ORDER.property.address)}</PropertyAddress>`,
    `  <PropertyCity>${escapeXml(TEST_ORDER.property.city)}</PropertyCity>`,
    `  <PropertyState>${escapeXml(TEST_ORDER.property.state)}</PropertyState>`,
    `  <PropertyZip>${escapeXml(TEST_ORDER.property.zip)}</PropertyZip>`,
    `  <PropertyCounty>${escapeXml(TEST_ORDER.property.county)}</PropertyCounty>`,
    `  <BuyerName>${escapeXml(TEST_ORDER.buyers.join('; '))}</BuyerName>`,
    `  <LenderName>${escapeXml(TEST_ORDER.lender?.name ?? '')}</LenderName>`,
    `  <LoanAmount>${TEST_ORDER.loanAmount}</LoanAmount>`,
    '</GetDocuments>',
  ].join('\n');

  const docUrl = `${base}GetDocuments`;
  info(`POST ${docUrl}`);

  const { res: docRes, elapsed: docMs, error: docErr } = await safeFetch(docUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: docXml,
    timeoutMs: 30_000,
  });

  if (docErr) { fail(`GetDocuments failed: ${docErr} (${docMs}ms)`); return; }

  const docStatus = docRes.status;
  const docText = await docRes.text();
  info(`HTTP ${docStatus} (${docMs}ms)`);

  if (docStatus !== 200) {
    fail(`GetDocuments returned ${docStatus}`);
    console.log(`  Response: ${docText.slice(0, 500)}`);
    return;
  }

  const hasPdfContent = docText.length > 2000;
  if (hasPdfContent) {
    pass(`GetDocuments succeeded! Response length: ${docText.length} chars`);
  } else {
    warn('GetDocuments returned 200 but short response');
    console.log(`  Response: ${docText.slice(0, 500)}`);
  }

  console.log(`\n  ✅ ${label} CPL FLOW COMPLETE\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const runAll = args.length === 0;
  const runWestcor = runAll || args.includes('--westcor');
  const runFnf = runAll || args.includes('--fnf');
  const runNatic = runAll || args.includes('--natic');
  const runDoma = runAll || args.includes('--doma');

  console.log('╔═══════════════════════════════════════════╗');
  console.log('║       CPL Integration Test Suite          ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`\nTest Order: ${TEST_ORDER.fileNumber}`);
  console.log(`Property:   ${TEST_ORDER.property.address}, ${TEST_ORDER.property.city}, ${TEST_ORDER.property.state}`);

  // Show which env vars are set
  console.log('\nEnvironment Check:');
  const checks = [
    ['WESTCOR_URL', runWestcor],
    ['FNF_VENDOR_URL', runFnf],
    ['NATIC_URL', runNatic],
    ['DOMA_URL', runDoma],
  ];
  for (const [key, needed] of checks) {
    if (!needed) continue;
    const val = env(key);
    console.log(`  ${val ? '✅' : '❌'} ${key}: ${val ? val.slice(0, 40) + '...' : '(not set)'}`);
  }

  if (runWestcor) await testWestcor();
  if (runFnf) await testFnf();
  if (runNatic) await testNatic('natic');
  if (runDoma) await testNatic('doma');

  console.log('\n═══════════════════════════════════════════');
  console.log('  TEST SUITE COMPLETE');
  console.log('═══════════════════════════════════════════\n');
}

main().catch(console.error);
