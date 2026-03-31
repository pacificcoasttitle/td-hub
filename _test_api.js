require('dotenv').config({ path: '.env.local' });

// Exact spec payload from the user (known working) but with fresh escrow number to avoid dupe
const SPEC_PAYLOAD = {
   "baseDetails": {
       "OrderType": "Title only",
       "ProjectName": "PCT",
       "IsRushOrder": false
   },
   "personalDetails": {
       "CompanyLookupCode": "Centr20C",
       "ClientLookupCode": "FayMazCen1",
       "UserType": "EscrowCompany",
       "CompanyName": "Central Escrow Group, Inc",
       "Email": "faye.mazaheri@centralescrowgroup.com",
       "FirstName": "Faye",
       "LastName": "Mazaheri",
       "Telephone": "9493338788",
       "Address": "20 Corporate Park Suite 185",
       "City": "Irvine",
       "ZipCode": "92606",
       "EmailNotifications": true,
       "State": "",
       "SalesRep": "PCT\\awu"
   },
   "propertyDetails": [
       {
       "Address1": "660 W Vernon Ave",
       "Address2": "",
       "APNNumberParcelID": "5018-032-025",
       "Country": "Los Angeles",
       "Description": "Test lot from API test",
       "IsPrimaryResidence": true,
       "City": "Los Angeles",
       "Zip": "90037",
       "EscrowBriefLegalLookupCode": null,
       "EscrowBriefLegal": "Test lot from API test",
       "State": "CA"
   }
   ],
   "sellerDetails": {
       "PrimaryOwnerFirstName": "",
       "PrimaryOwnerMiddleName": "",
       "PrimaryOwnerLastName": "",
       "SecondaryOwnerFirstName": "",
       "SecondaryOwnerMiddleName": "",
       "SecondaryOwnerLastName": "",
       "OrganizationType": "",
       "IsOrganization": "false"
   },
   "transactionDetails": {
       "LookUpCodeTitleOffice": "OCT",
       "TitleOffice": "PCT\\cvirata",
       "Product": "Short Form",
       "EscrowNumber": "TEST-" + Date.now(),
       "SalesAmount": 0.0,
       "PrimaryBorrowerFirstName": "Test",
       "PrimaryBorrowerMiddleName": "",
       "PrimaryBorrowerLastName": "Borrower",
       "SecondaryBorrowerFirstName": "",
       "SecondaryBorrowerMiddleName": "",
       "SecondaryBorrowerLastName": "",
       "TransactionType": "Refinance",
       "LoanNumber": "TEST123",
       "LoanAmount": 100000.0,
       "LookUpCodeEscrowOfficer": null,
       "EscrowOfficerName": null,
       "UnderwriterLookUpCode": "WC",
       "CoverageAmount": 100000.0,
       "IsOrganization": false,
       "OrganizationType": ""
   },
   "buyersAgentDetails": {
       "CompanyLookUpCode": "",
       "ClientLookUpCode": "",
       "Name": "",
       "Email": "",
       "Telephone": "",
       "CompanyName": ""
   },
   "listingAgentDetails": {
       "CompanyLookUpCode": "",
       "ClientLookUpCode": "",
       "Name": "",
       "Email": "",
       "Telephone": "",
       "CompanyName": ""
   },
   "escrowDetails": {
       "CompanyLookUpCode": "",
       "ClientLookUpCode": "",
       "Name": "",
       "Email": "",
       "Telephone": "",
       "CompanyName": ""
   },
   "lenderDetails": {
       "CompanyLookUpCode": "",
       "ClientLookUpCode": "",
       "Name": "",
       "Email": "",
       "Telephone": "",
       "CompanyName": ""
   },
   "mortgageDetails": {
       "CompanyLookUpCode": "",
       "ClientLookUpCode": "",
       "Name": "",
       "Email": "",
       "Telephone": "",
       "CompanyName": ""
   }
};

async function test() {
  const url = process.env.SOFTPRO_API_URL + 'ordercreation/create';
  const hdrs = { 'Content-Type': 'application/json' };
  if (process.env.SOFTPRO_TOKEN) hdrs['X-API-KEY'] = process.env.SOFTPRO_TOKEN;

  console.log('Testing spec payload against:', url);
  console.log('Payload:', JSON.stringify(SPEC_PAYLOAD, null, 2));

  const res = await fetch(url, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify(SPEC_PAYLOAD),
    signal: AbortSignal.timeout(60000),
  });

  const body = await res.json();
  console.log('\nHTTP Status:', res.status);
  console.log('Response:', JSON.stringify(body, null, 2));
}

test().catch(e => console.error('Error:', e.message));
