/**
 * Standalone test script to POST a create-order payload to the SoftPro API.
 *
 * Usage:
 *   node scripts/test-softpro-create.mjs                     # uses production (port 3000)
 *   node scripts/test-softpro-create.mjs --staging            # uses staging   (port 8081)
 *   SOFTPRO_TOKEN=xxx node scripts/test-softpro-create.mjs    # explicit token
 *
 * The script sends the exact legacy-format payload from the SoftPro API spec
 * and reports the full response.
 */

const PROD_URL = 'http://100.29.181.61:3000/api/ordercreation/create';
const STAGING_URL = 'http://100.29.181.61:8081/api/ordercreation/create';

const useStaging = process.argv.includes('--staging');
const url = useStaging ? STAGING_URL : PROD_URL;
const token = process.env.SOFTPRO_TOKEN ?? '';

const payload = {
  baseDetails: {
    OrderType: 'Title only',
    ProjectName: 'PCT',
    IsRushOrder: false,
  },
  personalDetails: {
    CompanyLookupCode: 'Centr20C',
    ClientLookupCode: 'FayMazCen1',
    UserType: 'EscrowCompany',
    CompanyName: 'Central Escrow Group, Inc',
    Email: 'faye.mazaheri@centralescrowgroup.com',
    FirstName: 'Faye',
    LastName: 'Mazaheri',
    Telephone: '9493338788',
    Address: '20 Corporate Park Suite 185',
    City: 'Irvine',
    ZipCode: '92606',
    EmailNotifications: true,
    State: '',
    SalesRep: 'PCT\\awu',
  },
  propertyDetails: [
    {
      Address1: '660 W Vernon Ave',
      Address2: '',
      APNNumberParcelID: '5018-032-025',
      Country: 'Los Angeles',
      Description: 'Lot:61 Bradford&espes Figueroa&vernon Ave Tract Ex Of St Lot 61',
      IsPrimaryResidence: true,
      City: 'Los Angeles',
      Zip: '90037',
      EscrowBriefLegalLookupCode: null,
      EscrowBriefLegal: 'Lot:61 Bradford&espes Figueroa&vernon Ave Tract Ex Of St Lot 61',
      State: 'CA',
    },
  ],
  sellerDetails: {
    PrimaryOwnerFirstName: '',
    PrimaryOwnerMiddleName: '',
    PrimaryOwnerLastName: '',
    SecondaryOwnerFirstName: '',
    SecondaryOwnerMiddleName: '',
    SecondaryOwnerLastName: '',
    OrganizationType: '',
    IsOrganization: 'false',
  },
  transactionDetails: {
    LookUpCodeTitleOffice: 'OCT',
    TitleOffice: 'PCT\\cvirata',
    Product: 'Short Form',
    EscrowNumber: 'CEG610547-FM',
    SalesAmount: 0.0,
    PrimaryBorrowerFirstName: 'Properties',
    PrimaryBorrowerMiddleName: 'Llc',
    PrimaryBorrowerLastName: 'Javid',
    SecondaryBorrowerFirstName: '',
    SecondaryBorrowerMiddleName: '',
    SecondaryBorrowerLastName: '',
    TransactionType: 'Refinance',
    LoanNumber: '2510014312',
    LoanAmount: 375000.0,
    LookUpCodeEscrowOfficer: null,
    EscrowOfficerName: null,
    UnderwriterLookUpCode: 'WC',
    CoverageAmount: 375000.0,
    IsOrganization: true,
    OrganizationType: 'Limited Liability Company',
  },
  buyersAgentDetails: {
    CompanyLookUpCode: 'C&C1475',
    ClientLookUpCode: 'LilPinC&C1',
    Name: 'Lilly Pinedo',
    Email: 'lp.processor@gmail.com',
    Telephone: '(714) 676-6181',
    CompanyName: 'C & C Financial Corp',
  },
  listingAgentDetails: {
    CompanyLookUpCode: 'C&C1475',
    ClientLookUpCode: 'LilPinC&C1',
    Name: 'Lilly Pinedo',
    Email: 'lp.processor@gmail.com',
    Telephone: '(714) 676-6181',
    CompanyName: 'C & C Financial Corp',
  },
  escrowDetails: {
    CompanyLookUpCode: 'C&C1475',
    ClientLookUpCode: 'LilPinC&C1',
    Name: 'Lilly Pinedo',
    Email: 'lp.processor@gmail.com',
    Telephone: '(714) 676-6181',
    CompanyName: 'C & C Financial Corp',
  },
  lenderDetails: {
    CompanyLookUpCode: 'C&C1475',
    ClientLookUpCode: 'LilPinC&C1',
    Name: 'Lilly Pinedo',
    Email: 'lp.processor@gmail.com',
    Telephone: '(714) 676-6181',
    CompanyName: 'C & C Financial Corp',
  },
  mortgageDetails: {
    CompanyLookUpCode: 'C&C1475',
    ClientLookUpCode: 'LilPinC&C1',
    Name: 'Lilly Pinedo',
    Email: 'lp.processor@gmail.com',
    Telephone: '(714) 676-6181',
    CompanyName: 'C & C Financial Corp',
  },
};

async function run() {
  console.log(`\n=== SoftPro Create Order Test ===`);
  console.log(`Target:  ${url}`);
  console.log(`Token:   ${token ? token.slice(0, 6) + '...' : '(none — no X-API-KEY header)'}`);
  console.log(`Payload: ${JSON.stringify(payload, null, 2)}\n`);

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-API-KEY'] = token;

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });

    const elapsed = Date.now() - start;
    const body = await res.text();

    console.log(`HTTP Status: ${res.status}`);
    console.log(`Elapsed:     ${elapsed}ms`);
    console.log(`Response Headers:`);
    for (const [k, v] of res.headers.entries()) {
      console.log(`  ${k}: ${v}`);
    }
    console.log(`\nResponse Body:`);
    try {
      const json = JSON.parse(body);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(body);
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`FAILED after ${elapsed}ms:`, err.message ?? err);
  }
}

run();
