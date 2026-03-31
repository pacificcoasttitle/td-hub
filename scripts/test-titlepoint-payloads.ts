import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildGeoGetResultById3GetRequest,
  buildGeoGetResultById3PostRequest,
  buildGetRequestSummariesRequest,
  buildGetResultByIdRequest,
  buildPostOrderGeoCreateServiceRequest,
  buildPostOrderLvCreateServiceRequest,
  buildPostOrderTaxCreateServiceRequest,
  buildPreOrderLvCreateServiceRequest,
  buildPreOrderTaxCreateServiceRequest,
  parseCreateServiceLiveResponse,
  parseGetRequestSummariesLiveResponse,
  parseLvGetResultLiveResponse,
  buildTaxGetResultById3Request,
} from '../src/lib/integrations/titlepoint/client';
import {
  buildCreateRequest3Request,
  buildGetDocumentsByParameters3Request,
  buildGetGeneratedImageRequest,
  buildGetRequestStatusRequest,
  parseCreateRequest3LiveResponse,
  parseGetGeneratedImageLiveResponse,
  parseGetRequestStatusLiveResponse,
  parseGrantDeedImageResponse,
} from '../src/lib/integrations/titlepoint/client-image';
import {
  buildLegacyGeoParameters,
  buildLegacyGrantDeedParameters,
  buildLegacyLvParameters,
  buildLegacyTaxParameters,
} from '../src/lib/integrations/titlepoint/params';
import { PRE_INIT_SEARCH_TYPES } from '../src/lib/domain/titlepoint/pre-initiate';

const TEST_PROPERTY = {
  address: '1358 5th St',
  city: 'La Verne',
  state: 'CA',
  county: 'LOS ANGELES',
  fips: '06037',
  apn: '8381-021-001',
};

const TEST_CREDS = {
  userID: 'PCTXML01',
  password: 'TestPass123',
  baseUrl: 'https://www.titlepoint.com/TitlePointServices/',
};

const TEST_IDS = {
  requestId: 'REQ-12345',
  serviceId: 'SVC-67890',
  resultId: 'RES-11111',
  imgRequestId: 'IMG-22222',
  year: '2020',
  docId: '123456',
};

let passed = 0;
let failed = 0;
const failures: string[] = [];
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function assert(testName: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}${details ? ` — ${details}` : ''}`);
    failed++;
    failures.push(`${testName}${details ? `: ${details}` : ''}`);
  }
}

function assertParamOrder(testName: string, payload: string, keys: string[]) {
  let lastIdx = -1;
  for (const key of keys) {
    const idx = payload.indexOf(`${key}=`);
    if (idx === -1) {
      assert(testName, false, `param '${key}' not found`);
      return;
    }
    if (idx <= lastIdx) {
      assert(testName, false, `param '${key}' is out of order`);
      return;
    }
    lastIdx = idx;
  }
  assert(testName, true);
}

console.log('\n=== TITLEPOINT RUNTIME CONTRACT VALIDATION ===\n');

console.log('1. Parameter builders');
{
  assert(
    'Geo parameters match legacy string',
    buildLegacyGeoParameters(TEST_PROPERTY.address) ===
      'Address.FullAddress=1358 5th St;General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False;General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False;General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;'
  );
  assert(
    'Tax parameters use Tax.APN and General.* flags',
    buildLegacyTaxParameters(TEST_PROPERTY.apn) ===
      'Tax.APN=8381-021-001;General.AutoSearchTaxes=true;General.AutoSearchProperty=false'
  );
  assert(
    'LV builder with Address1/City matches legacy branch',
    buildLegacyLvParameters({
      address: TEST_PROPERTY.address,
      city: TEST_PROPERTY.city,
      apn: TEST_PROPERTY.apn,
      includeAddressApn: true,
    }) ===
      'Address1=1358 5th St;City=La Verne;Pin=8381-021-001;LvLookup=Address;LvLookupValue=1358 5th St, La Verne;LvReportFormat=LV;IncludeTaxAssessor=true'
  );
  assert(
    'LV builder without Address1/City matches legacy branch',
    buildLegacyLvParameters({
      address: TEST_PROPERTY.address,
      city: TEST_PROPERTY.city,
      apn: TEST_PROPERTY.apn,
      includeAddressApn: false,
    }) ===
      'Pin=8381-021-001;LvLookup=Address;LvLookupValue=1358 5th St, La Verne;LvReportFormat=LV;IncludeTaxAssessor=true'
  );
  assert(
    'Grant deed builder uses single comma-separated parameters field',
    buildLegacyGrantDeedParameters(TEST_PROPERTY.fips, TEST_IDS.year, TEST_IDS.docId) ===
      'FIPS=06037,TYPE=REC,SUBTYPE=ALL,YEAR=2020,INST=123456'
  );
}

console.log('\n2. CreateService request specs');
{
  const geo = buildPostOrderGeoCreateServiceRequest(TEST_CREDS, { ...TEST_PROPERTY, searchType: 'geo_address' });
  const postOrderTax = buildPostOrderTaxCreateServiceRequest(TEST_CREDS, { ...TEST_PROPERTY, searchType: 'tax' });
  const postOrderLv = buildPostOrderLvCreateServiceRequest(TEST_CREDS, { ...TEST_PROPERTY, searchType: 'legal_vesting' });
  const tax = buildPreOrderTaxCreateServiceRequest(TEST_CREDS, { ...TEST_PROPERTY, searchType: 'tax' }, '123456789');
  const lv = buildPreOrderLvCreateServiceRequest(TEST_CREDS, { ...TEST_PROPERTY, searchType: 'legal_vesting' }, true, '123456789');

  assert('Geo uses POST transport', geo.method === 'POST');
  assert('Geo customerRef is empty', geo.rawBody?.includes('customerRef=&') === true);
  assert('Geo orderNo is empty', geo.rawBody?.includes('orderNo=&') === true);
  assertParamOrder('Geo param order matches legacy', geo.rawBody!, [
    'userID', 'password', 'serviceType', 'parameters',
    'department', 'orderNo', 'customerRef', 'company',
    'titleOfficer', 'orderComment', 'starterRemarks', 'state', 'county',
  ]);

  assert('Post-order tax uses POST transport', postOrderTax.method === 'POST');
  assert('Post-order tax uses TitlePoint.Geo.Tax service type', postOrderTax.rawBody?.includes('serviceType=TitlePoint.Geo.Tax&') === true);
  assert('Post-order tax keeps Tax.APN parameter grammar', postOrderTax.rawBody?.includes('parameters=Tax.APN=8381-021-001;General.AutoSearchTaxes=true;General.AutoSearchProperty=false&') === true);

  assert('Post-order LV uses POST transport', postOrderLv.method === 'POST');
  assert('Post-order LV uses fipsCode', postOrderLv.rawBody?.includes('fipsCode=06037&') === true);

  assert('Pre-order tax uses GET transport', tax.method === 'GET');
  assert('Pre-order tax uses TitlePoint.Geo.Tax service type', tax.url.includes('serviceType=TitlePoint.Geo.Tax'));
  assert('Pre-order tax query string is encoded', tax.url.includes('parameters=Tax.APN%3D8381-021-001%3BGeneral.AutoSearchTaxes%3Dtrue%3BGeneral.AutoSearchProperty%3Dfalse'));
  assert('Pre-order tax uses customerRef', tax.url.includes('customerRef=123456789'));
  assertParamOrder('Pre-order tax param order matches legacy', tax.url, [
    'userID', 'password', 'orderNo', 'customerRef',
    'company', 'department', 'titleOfficer', 'orderComment',
    'starterRemarks', 'serviceType', 'parameters', 'state', 'county',
  ]);

  assert('Pre-order LV uses GET transport', lv.method === 'GET');
  assert('Pre-order LV uses fipsCode', lv.url.includes('fipsCode=06037'));
  assert('Pre-order LV uses customerRef', lv.url.includes('customerRef=123456789'));
  assert('Pre-order LV query encodes Address1 branch', lv.url.includes('Address1%3D1358+5th+St%3BCity%3DLa+Verne%3BPin%3D8381-021-001'));
  assertParamOrder('Pre-order LV param order matches legacy', lv.url, [
    'userID', 'password', 'orderNo', 'customerRef',
    'company', 'department', 'titleOfficer', 'orderComment',
    'starterRemarks', 'serviceType', 'parameters', 'fipsCode',
  ]);
}

console.log('\n3. GetRequestSummaries and result specs');
{
  const summary = buildGetRequestSummariesRequest(TEST_CREDS, TEST_IDS.requestId);
  const lvResult = buildGetResultByIdRequest(TEST_CREDS, TEST_IDS.resultId);
  const taxResult = buildTaxGetResultById3Request(TEST_CREDS, TEST_IDS.resultId);
  const geoResultGet = buildGeoGetResultById3GetRequest(TEST_CREDS, TEST_IDS.resultId);
  const geoResultPost = buildGeoGetResultById3PostRequest(TEST_CREDS, TEST_IDS.resultId);

  assert('GetRequestSummaries uses GET', summary.method === 'GET');
  assert('GetRequestSummaries uses requestId lowercase d', summary.url.includes('requestId=REQ-12345'));
  assert('GetRequestSummaries uses maxWaitSeconds=20', summary.url.includes('maxWaitSeconds=20'));
  assertParamOrder('GetRequestSummaries param order matches legacy', summary.url, [
    'userID', 'password', 'company', 'department', 'titleOfficer', 'requestId', 'maxWaitSeconds',
  ]);

  assert('LV result uses GET', lvResult.method === 'GET');
  assertParamOrder('LV result param order matches legacy', lvResult.url, [
    'userID', 'password', 'company', 'department', 'titleOfficer', 'resultID',
  ]);

  assert('Tax GetResultByID3 uses GET', taxResult.method === 'GET');
  assert('Tax GetResultByID3 keeps requestingTPXML=true', taxResult.url.includes('requestingTPXML=true'));
  assertParamOrder('Tax GetResultByID3 param order matches legacy', taxResult.url, [
    'userID', 'password', 'company', 'department', 'titleOfficer', 'resultID', 'requestingTPXML',
  ]);

  assert('Geo raw result uses GET', geoResultGet.method === 'GET');
  assert('Geo raw result keeps requestingTPXML=true', geoResultGet.url.includes('requestingTPXML=true'));
  assert('Geo parsed result uses POST', geoResultPost.method === 'POST');
  assert('Geo parsed result keeps requestingTPXML=true', geoResultPost.rawBody?.includes('requestingTPXML=true&') === true);
}

console.log('\n4. Image and grant deed specs');
{
  const createRequest = buildCreateRequest3Request(TEST_CREDS, TEST_IDS.serviceId);
  const requestStatus = buildGetRequestStatusRequest(TEST_CREDS, TEST_IDS.imgRequestId);
  const generatedImage = buildGetGeneratedImageRequest(TEST_CREDS, TEST_IDS.imgRequestId);
  const grantDeed = buildGetDocumentsByParameters3Request(TEST_CREDS, {
    fips: TEST_PROPERTY.fips,
    year: TEST_IDS.year,
    instrumentDocId: TEST_IDS.docId,
  });

  assertParamOrder('CreateRequest3 param order matches legacy', createRequest.rawBody!, [
    'username', 'password', 'serviceId1', 'serviceId2', 'source', 'clientKey1', 'clientKey2', 'sortOrder', 'fileType',
  ]);
  assert('CreateRequest3 does not send serviceId3', !createRequest.rawBody?.includes('serviceId3='));
  assert('GetRequestStatus uses lowercase requestId', requestStatus.rawBody?.includes('requestId=IMG-22222&') === true);
  assert('GetGeneratedImage uses lowercase requestId', generatedImage.rawBody?.includes('requestId=IMG-22222&') === true);
  assertParamOrder('Grant Deed param order matches legacy', grantDeed.rawBody!, [
    'parameters', 'username', 'password', 'company', 'department',
    'titleOfficer', 'pages', 'propertyOnly', 'maxPageCount',
    'maxSizeInKB', 'additionalInfo', 'customerRef', 'fileType',
  ]);
  assert('Grant Deed uses one comma-separated parameters field', grantDeed.rawBody?.includes('parameters=FIPS=06037,TYPE=REC,SUBTYPE=ALL,YEAR=2020,INST=123456&') === true);
}

console.log('\n5. Pre-init flow and image sequencing');
{
  assert(
    'Pre-init search set is tax + legal_vesting only',
    JSON.stringify(PRE_INIT_SEARCH_TYPES) === JSON.stringify(['tax', 'legal_vesting'])
  );

  const servicePath = path.resolve(scriptDir, '../src/lib/domain/titlepoint/service.ts');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');
  const statusIdx = serviceSource.indexOf('getRequestStatus(imgReqResult.data!.requestId, oid)');
  const imageIdx = serviceSource.indexOf('getImage(imgReqResult.data!.requestId, oid)');
  assert('fetchImage calls getRequestStatus before getImage', statusIdx !== -1 && imageIdx !== -1 && statusIdx < imageIdx);
}

;(async () => {
console.log('\n6. Live root parser assertions');
{
  const createXml = `<?xml version="1.0" encoding="utf-8"?>
<CreateAsynchServicesReturn xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <ReturnMessages />
  <RequestID>786662901</RequestID>
  <OrderID>443942786</OrderID>
</CreateAsynchServicesReturn>`;
  const createWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<ServiceResult xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <RequestID>BAD</RequestID>
  <OrderID>BAD</OrderID>
</ServiceResult>`;

  const summaryXml = `<?xml version="1.0" encoding="utf-8"?>
<GetRequestSummariesReturn xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <RequestSummaries>
    <RequestSummary>
      <Status>Complete</Status>
      <Order>
        <ID>443942786</ID>
        <Services>
          <Service>
            <ID>1722408212</ID>
            <ThumbNails>
              <ResultThumbNail>
                <ID>2728361345</ID>
              </ResultThumbNail>
            </ThumbNails>
          </Service>
        </Services>
      </Order>
    </RequestSummary>
  </RequestSummaries>
</GetRequestSummariesReturn>`;
  const summaryWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<ServiceResult xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
</ServiceResult>`;

  const lvResultXml = `<?xml version="1.0" encoding="utf-8"?>
<GetResultReturn xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <Result>
    <ID>2728361345</ID>
    <Status>Complete</Status>
    <Fips>06037</Fips>
    <BriefLegal>TRACT NO 6654 LOT 44</BriefLegal>
    <Vesting>OWNER NAME</Vesting>
    <Apn>8381-021-001</Apn>
    <PropertyAddress>1358 5TH ST, LA VERNE CA 91750-4224</PropertyAddress>
    <LvDeeds>
      <LegalAndVesting2DeedInfo>
        <DocType>Grant Deed</DocType>
        <RecordedDate>12/23/2015</RecordedDate>
        <InstrumentNumber>15-1611995</InstrumentNumber>
      </LegalAndVesting2DeedInfo>
    </LvDeeds>
  </Result>
</GetResultReturn>`;
  const lvWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<ServiceResult xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <Result>
    <ID>BAD</ID>
  </Result>
</ServiceResult>`;
  const createRequestXml = `<?xml version="1.0" encoding="utf-8"?>
<CreateAsynchServicesReturn xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <ReturnMessages />
  <RequestID>189500001</RequestID>
  <OrderID>0</OrderID>
</CreateAsynchServicesReturn>`;
  const createRequestWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<GenerateImageResult xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <RequestID>BAD</RequestID>
  <OrderID>BAD</OrderID>
</GenerateImageResult>`;
  const requestStatusXml = `<?xml version="1.0" encoding="utf-8"?>
<GenerateImageRequestStatusReturn xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <RequestId>189501141</RequestId>
  <Status>Processing</Status>
  <Message>OK</Message>
</GenerateImageRequestStatusReturn>`;
  const requestStatusWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<GenerateImageResult xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <Status>BAD</Status>
</GenerateImageResult>`;
  const generatedImageXml = `<?xml version="1.0" encoding="utf-8"?>
<GenerateImageData xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <Status>Processing</Status>
  <Message>OK</Message>
  <Data></Data>
</GenerateImageData>`;
  const generatedImageWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<GenerateImageResult xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <Data>BAD</Data>
</GenerateImageResult>`;
  const grantDeedXml = `<?xml version="1.0" encoding="utf-8"?>
<GetDocumentReturn xmlns="http://www.TitlePoint.com">
  <Status>
    <Msg>OK</Msg>
  </Status>
  <Documents>
    <DocumentResponse>
      <DocStatus>
        <Msg>OK</Msg>
      </DocStatus>
      <Document>
        <Body>
          <Body>JVBERi0xLjQ=</Body>
        </Body>
      </Document>
    </DocumentResponse>
  </Documents>
</GetDocumentReturn>`;
  const grantDeedWrongRootXml = `<?xml version="1.0" encoding="utf-8"?>
<GenerateImageResult xmlns="http://www.TitlePoint.com">
  <ReturnStatus>Success</ReturnStatus>
  <Data>BAD</Data>
</GenerateImageResult>`;

  const createParsed = await parseCreateServiceLiveResponse(createXml);
  const createWrongRootParsed = await parseCreateServiceLiveResponse(createWrongRootXml);
  const summaryParsed = await parseGetRequestSummariesLiveResponse(summaryXml);
  const summaryWrongRootParsed = await parseGetRequestSummariesLiveResponse(summaryWrongRootXml);
  const lvParsed = await parseLvGetResultLiveResponse(lvResultXml);
  const lvWrongRootParsed = await parseLvGetResultLiveResponse(lvWrongRootXml);
  const createRequestParsed = await parseCreateRequest3LiveResponse(createRequestXml);
  const createRequestWrongRootParsed = await parseCreateRequest3LiveResponse(createRequestWrongRootXml);
  const requestStatusParsed = await parseGetRequestStatusLiveResponse(requestStatusXml);
  const requestStatusWrongRootParsed = await parseGetRequestStatusLiveResponse(requestStatusWrongRootXml);
  const generatedImageParsed = await parseGetGeneratedImageLiveResponse(generatedImageXml);
  const generatedImageWrongRootParsed = await parseGetGeneratedImageLiveResponse(generatedImageWrongRootXml);
  const grantDeedParsed = await parseGrantDeedImageResponse(grantDeedXml);
  const grantDeedWrongRootParsed = await parseGrantDeedImageResponse(grantDeedWrongRootXml);

  assert('Create parser reads CreateAsynchServicesReturn ReturnStatus', createParsed.returnStatus === 'Success');
  assert('Create parser reads CreateAsynchServicesReturn RequestID', createParsed.requestId === '786662901');
  assert('Create parser reads CreateAsynchServicesReturn OrderID', createParsed.orderId === '443942786');
  assert('Create parser no longer depends on ServiceResult', createWrongRootParsed.returnStatus === '' && createWrongRootParsed.requestId === '' && createWrongRootParsed.orderId === '');

  assert('Poll parser reads GetRequestSummariesReturn ReturnStatus', summaryParsed.returnStatus === 'Success');
  assert('Poll parser reads summary status', summaryParsed.status === 'success');
  assert('Poll parser reads order ID', summaryParsed.orderIds[0] === '443942786');
  assert('Poll parser reads service ID', summaryParsed.serviceIds[0] === '1722408212');
  assert('Poll parser reads result thumbnail ID', summaryParsed.resultIds[0] === '2728361345');
  assert('Poll parser no longer depends on ServiceResult', summaryWrongRootParsed.returnStatus === '' && summaryWrongRootParsed.serviceIds.length === 0 && summaryWrongRootParsed.resultIds.length === 0);

  assert('LV result parser reads GetResultReturn ReturnStatus', lvParsed.returnStatus === 'Success');
  assert('LV result parser reads result ID', lvParsed.data.ID === '2728361345');
  assert('LV result parser reads BriefLegal', lvParsed.data.BriefLegal === 'TRACT NO 6654 LOT 44');
  assert('LV result parser reads Vesting', lvParsed.data.Vesting === 'OWNER NAME');
  assert('LV result parser reads Fips', lvParsed.data.Fips === '06037');
  assert('LV result parser reads deed info', (lvParsed.data.LvDeeds as { LegalAndVesting2DeedInfo?: { InstrumentNumber?: string } }).LegalAndVesting2DeedInfo?.InstrumentNumber === '15-1611995');
  assert('LV result parser no longer depends on ServiceResult', lvWrongRootParsed.returnStatus === '' && lvWrongRootParsed.data.ID === '');

  assert('CreateRequest3 parser reads CreateAsynchServicesReturn ReturnStatus', createRequestParsed.returnStatus === 'Success');
  assert('CreateRequest3 parser reads CreateAsynchServicesReturn RequestID', createRequestParsed.requestId === '189500001');
  assert('CreateRequest3 parser reads CreateAsynchServicesReturn OrderID', createRequestParsed.orderId === '0');
  assert('CreateRequest3 parser no longer depends on GenerateImageResult', createRequestWrongRootParsed.returnStatus === '' && createRequestWrongRootParsed.requestId === '' && createRequestWrongRootParsed.orderId === '');

  assert('GetRequestStatus parser reads GenerateImageRequestStatusReturn ReturnStatus', requestStatusParsed.returnStatus === 'Success');
  assert('GetRequestStatus parser reads RequestId', requestStatusParsed.requestId === '189501141');
  assert('GetRequestStatus parser reads Status', requestStatusParsed.status === 'processing');
  assert('GetRequestStatus parser reads Message', requestStatusParsed.message === 'OK');
  assert('GetRequestStatus parser no longer depends on GenerateImageResult', requestStatusWrongRootParsed.returnStatus === '' && requestStatusWrongRootParsed.status === '' && requestStatusWrongRootParsed.requestId === '');

  assert('GetGeneratedImage parser reads GenerateImageData ReturnStatus', generatedImageParsed.returnStatus === 'Success');
  assert('GetGeneratedImage parser reads Status', generatedImageParsed.status === 'processing');
  assert('GetGeneratedImage parser reads Message', generatedImageParsed.message === 'OK');
  assert('GetGeneratedImage parser reads Data', generatedImageParsed.base64Data === '');
  assert('GetGeneratedImage parser no longer depends on GenerateImageResult', generatedImageWrongRootParsed.returnStatus === '' && generatedImageWrongRootParsed.status === '' && generatedImageWrongRootParsed.base64Data === '');

  assert('Grant deed parser reads GetDocumentReturn Status.Msg', grantDeedParsed.returnStatus === 'OK');
  assert('Grant deed parser reads DocStatus.Msg', grantDeedParsed.docStatus === 'OK');
  assert('Grant deed parser reads PDF body path', grantDeedParsed.base64Data === 'JVBERi0xLjQ=');
  assert('Grant deed parser no longer depends on GenerateImageResult', grantDeedWrongRootParsed.returnStatus === '' && grantDeedWrongRootParsed.docStatus === '' && grantDeedWrongRootParsed.base64Data === '');
}

console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n❌ FAILURES:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}

console.log('\n✅ Runtime-backed request builders match the intended legacy contracts.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
