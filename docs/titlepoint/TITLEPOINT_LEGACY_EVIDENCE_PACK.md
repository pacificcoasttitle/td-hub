# TitlePoint Legacy Evidence Pack

## Purpose
This document pulls the exact legacy evidence for the TitlePoint questions that were blocking the TD Hub rewrite.

It separates three kinds of evidence:

- **Code-proven**: directly verified from legacy PHP
- **Sample-proven**: supported by saved raw XML files in `TransactionDeskClone/docs/titlepoint-samples`
- **Unavailable in repo**: would require live access to historical `pct_order_api_logs`

Primary legacy sources:

- `TransactionDeskClone/application/libraries/order/Titlepoint.php`
- `TransactionDeskClone/application/modules/frontend/controllers/order/TitlePoint.php`
- `TransactionDeskClone/application/libraries/order/Order.php`

Supporting sample XML:

- `TransactionDeskClone/docs/titlepoint-samples/05_raw_xml_tax_search.xml`
- `TransactionDeskClone/docs/titlepoint-samples/06_raw_xml_legal_vesting.xml`
- `TransactionDeskClone/docs/titlepoint-samples/07_raw_xml_grant_deed.xml`
- `TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml`
- `TransactionDeskClone/docs/titlepoint-samples/09_raw_xml_geo_document.xml`

---

## 1. LV GetResultByID — exact legacy evidence

## Method
**Code-proven:** GET

Legacy frontend controller:

```355:382:TransactionDeskClone/application/modules/frontend/controllers/order/TitlePoint.php
        $requestParams = array(
            'userID' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'company' => '',
            'department' => '',
            'titleOfficer' => '',
            'resultID' => $resultId,
        );

        $resultUrl = env('TP_GET_RESULT_BY_ID');

        if ($methodId == 3) {
            $requestParams['requestingTPXML'] = 'true';
            $resultUrl = env('TP_GET_RESULT_BY_ID_3');
        }

        $request = $resultUrl . http_build_query($requestParams);
        $file = file_get_contents($request, false, $context);
```

For **LV** (`methodId == 4`):

- endpoint = `TP_GET_RESULT_BY_ID`
- method = `GET`
- query string = encoded by `http_build_query(...)`
- no `requestingTPXML`

## Exact param order
**Code-proven:**

1. `userID`
2. `password`
3. `company`
4. `department`
5. `titleOfficer`
6. `resultID`

## Reconstructed wire example
Using the saved LV sample response id `RES-LV-3318743` style:

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/GetResultByID?userID=PCTXML01&password=AlphaOmega637&company=&department=&titleOfficer=&resultID=RES-LV-3318743
```

## Exact XML root and parsed path
**Sample-proven:** `docs/titlepoint-samples/06_raw_xml_legal_vesting.xml`

Raw XML root:

```xml
<ServiceResult xmlns="http://titlepoint.com/ws/">
```

Legacy reads:

- `ReturnStatus`
- `Result.BriefLegal`
- `Result.Vesting`
- `Result.Fips`
- `Result.Status`
- `Result.LvDeeds.LegalAndVesting2DeedInfo`

Legacy evidence:

```413:458:TransactionDeskClone/application/modules/frontend/controllers/order/TitlePoint.php
            if ($methodId == 4) {
                if ($responseStatus == 'Success') {
                    $briefLegal = isset($result['Result']['BriefLegal']) && !empty($result['Result']['BriefLegal']) ? $result['Result']['BriefLegal'] : '';
                    $vesting = isset($result['Result']['Vesting']) && !empty($result['Result']['Vesting']) ? $result['Result']['Vesting'] : '';
                    $fips = isset($result['Result']['Fips']) && !empty($result['Result']['Fips']) ? $result['Result']['Fips'] : '';
                    $legal_vesting_info = isset($result['Result']['LvDeeds']['LegalAndVesting2DeedInfo']) && !empty($result['Result']['LvDeeds']['LegalAndVesting2DeedInfo']) ? $result['Result']['LvDeeds']['LegalAndVesting2DeedInfo'] : array();
```

Sample raw response:

```8:33:TransactionDeskClone/docs/titlepoint-samples/06_raw_xml_legal_vesting.xml
<ServiceResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <Result>
    <BriefLegal>LOT 18 OF TRACT NO 37201 ...</BriefLegal>
    <Vesting>JOHN SMITH AND JANE SMITH, HUSBAND AND WIFE AS JOINT TENANTS</Vesting>
    <Fips>06037</Fips>
    <Status>Complete</Status>
    <LvDeeds>
      <LegalAndVesting2DeedInfo>
        <DocType>Grant Deed</DocType>
        <InstrumentNumber>20190298741</InstrumentNumber>
        <RecordedDate>03/15/2019</RecordedDate>
      </LegalAndVesting2DeedInfo>
```

---

## 2. Is pre-init strictly Tax + LV only?

## Answer
**Code-proven:** Yes. Pre-init is **Tax + LV only**. Geo does **not** start there.

### Evidence: frontend pre-init controller
The frontend `TitlePoint` controller only supports:

- `methodId == 3` → Tax
- `methodId == 4` → Legal Vesting

```54:93:TransactionDeskClone/application/modules/frontend/controllers/order/TitlePoint.php
        if ($methodId == 3) {
            // tax
        } else if ($methodId == 4) {
            // legal vesting
        }
```

There is no geo branch in pre-init.

### Evidence: post-order geo trigger
Geo starts after order creation in `Home.php`:

```857:895:TransactionDeskClone/application/modules/frontend/controllers/order/Home.php
                    $this->load->library('order/titlepoint');

                    if ($lpOrderFlag == 0) {
                        $postData['file_number'] = $orderNumber;
                        $postData['order_id']    = $orderId;
                        $postData['state']       = $PropertyState;
                        $postData['county']      = $County;
                        $postData['property']    = $PropertyAddress;
                        $postData['apn']         = $apn;
                        $postData['unit_number'] = $this->input->post('unit_number');
                        $this->titlepoint->generateGeoDoc($postData, 1);
                    }
```

So:

- **pre-init** = Tax + LV
- **post-order** = Geo, then Tax PDF, LV PDF, Grant Deed

---

## 3. Does Geo result retrieval really do the dual-call?

## Answer
**Code-proven:** Yes.

The geo result flow does:

1. **GET** raw XML via `file_get_contents($request, false, $context)`
2. **POST** same params via `curl_post($requestUrl, $requestParams)`

### Legacy evidence

```1147:1179:TransactionDeskClone/application/libraries/order/Titlepoint.php
    public function generateGeoDocument($resultId, $orderId, $fileNumber, $postData)
    {
        $requestParams = array(
            'userID' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'company' => '',
            'department' => '',
            'titleOfficer' => '',
            'requestingTPXML' => "true",
            'resultID' => $resultId,
        );

        $requestUrl = env('TP_SERVICE_ENDPOINT') . TP_GEO_GET_RESULT_URL;
        $request = $requestUrl . http_build_query($requestParams);

        $file = file_get_contents($request, false, $context);
        // save raw XML to lp-xml

        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
```

### Example GET wire
**Code-proven** request shape:

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/GetResultByID3?userID=PCTXML01&password=AlphaOmega637&company=&department=&titleOfficer=&requestingTPXML=true&resultID={resultId}
```

### Example POST wire
**Code-proven** request shape:

```text
POST https://www.titlepoint.com/TitlePointServices/TpsService.asmx/GetResultByID3

userID=PCTXML01&password=AlphaOmega637&company=&department=&titleOfficer=&requestingTPXML=true&resultID={resultId}&
```

### Example raw XML stored by the GET step
**Sample-proven:** `docs/titlepoint-samples/09_raw_xml_geo_document.xml`

```8:20:TransactionDeskClone/docs/titlepoint-samples/09_raw_xml_geo_document.xml
<ServiceResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <Result>
    <PickList>
      <PickListItems>
        <Item>
          <APN>7012-017-018</APN>
          <Address>1245 MAPLE AVE, CERRITOS CA 90703</Address>
```

That file also explicitly notes:

```6:6:TransactionDeskClone/docs/titlepoint-samples/09_raw_xml_geo_document.xml
  This XML is also saved to S3 as lp-xml/{orderNumber}.xml
```

---

## 4. Where does `enable_lv_with_address_apn` live?

## Setting definition and storage

### Read site
**Code-proven:** frontend TitlePoint controller

```80:87:TransactionDeskClone/application/modules/frontend/controllers/order/TitlePoint.php
            $configData = $this->order->getConfigData();
            $enableLvWithAddressApn = $configData['enable_lv_with_address_apn']['is_enable'];
            $requestParams['serviceType'] = env('SERVICE_TYPE');
            if (empty($enableLvWithAddressApn) || $enableLvWithAddressApn == 0) {
                $requestParams['parameters'] = 'Pin=' . $apn . ';LvLookup=Address;LvLookupValue=' . $address . ', ' . $unitinfo . $city . ';LvReportFormat=LV;IncludeTaxAssessor=true';
            } else {
                $requestParams['parameters'] = 'Address1=' . $address . ';City=' . $city . ';Pin=' . $apn . ';LvLookup=Address;LvLookupValue=' . $address . ', ' . $unitinfo . $city . ';LvReportFormat=LV;IncludeTaxAssessor=true';
            }
```

### Admin save path
**Code-proven:** stored in `pct_configs.slug = 'enable_lv_with_address_apn'`

```6844:6848:TransactionDeskClone/application/modules/admin/controllers/order/Home.php
            $enable_lv_with_address_apn = isset($input['enable_lv_with_address_apn']) && !empty($input['enable_lv_with_address_apn']) ? 1 : 0;
            $lpDocData                  = [
                'is_enable' => $enable_lv_with_address_apn,
            ];
            $this->db->update('pct_configs', $lpDocData, ['slug' => 'enable_lv_with_address_apn']);
```

### Admin UI

```55:57:TransactionDeskClone/application/modules/admin/views/order/home/settings.php
                            <label for="enable_lv_with_address_apn" class="col-sm-7 col-form-label">Enable LV with Address + APN </label>
                            <div class="col-sm-1">
                                <input type="checkbox" value="1" class="form-control" style="width:20px;"  name="enable_lv_with_address_apn" id="enable_lv_with_address_apn" ... >
```

## Example request with setting OFF
Using:

- address = `1245 Maple Ave`
- city = `Cerritos`
- apn = `7012-017-018`
- fipsCode = `06037`

Exact param order:

1. `userID`
2. `password`
3. `orderNo`
4. `customerRef`
5. `company`
6. `department`
7. `titleOfficer`
8. `orderComment`
9. `starterRemarks`
10. `serviceType`
11. `parameters`
12. `fipsCode`

Encoded GET example:

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService4?userID=PCTXML01&password=AlphaOmega637&orderNo=&customerRef=123456789&company=&department=&titleOfficer=&orderComment=&starterRemarks=&serviceType=TitlePoint.LegalAndVesting2&parameters=Pin%3D7012-017-018%3BLvLookup%3DAddress%3BLvLookupValue%3D1245+Maple+Ave%2C+Cerritos%3BLvReportFormat%3DLV%3BIncludeTaxAssessor%3Dtrue&fipsCode=06037
```

## Example request with setting ON

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService4?userID=PCTXML01&password=AlphaOmega637&orderNo=&customerRef=123456789&company=&department=&titleOfficer=&orderComment=&starterRemarks=&serviceType=TitlePoint.LegalAndVesting2&parameters=Address1%3D1245+Maple+Ave%3BCity%3DCerritos%3BPin%3D7012-017-018%3BLvLookup%3DAddress%3BLvLookupValue%3D1245+Maple+Ave%2C+Cerritos%3BLvReportFormat%3DLV%3BIncludeTaxAssessor%3Dtrue&fipsCode=06037
```

The only difference is the `parameters` string.

---

## 5. Request + response pairs by endpoint

These are the best evidence-backed pairs available from the repo.

## 5.1 CreateService3 (Geo)

### Request
**Code-proven** from `Titlepoint.php::generateGeoDoc()`

POST endpoint:

```text
POST https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService3
```

Raw body:

```text
userID=PCTXML01&password=AlphaOmega637&serviceType=TitlePoint.Geo.Address&parameters=Address.FullAddress=1245 Maple Ave;General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False;General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False;General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;&department=&orderNo=&customerRef=&company=&titleOfficer=&orderComment=&starterRemarks=&state=CA&county=LOS ANGELES&
```

### Response
**Sample-proven:** generic CreateService3 response shape from `08_raw_xml_create_service.xml`

```19:24:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<ServiceResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <RequestID>9841523</RequestID>
  <OrderID>TP-8847291</OrderID>
</ServiceResult>
```

## 5.2 CreateService3 (Tax)

### Request
**Code-proven** from frontend pre-init controller

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService3?userID=PCTXML01&password=AlphaOmega637&orderNo=&customerRef=123456789&company=&department=&titleOfficer=&orderComment=&starterRemarks=&serviceType=TitlePoint.TaxSearch&parameters=Tax.APN%3D7012-017-018%3BGeneral.AutoSearchTaxes%3Dtrue%3BGeneral.AutoSearchProperty%3Dfalse&state=CA&county=LOS+ANGELES
```

### Response
**Sample-proven:** same saved CreateService3 response block as above

## 5.3 CreateService4 (LV)

### Request
**Code-proven** from frontend pre-init controller, setting OFF example

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/CreateService4?userID=PCTXML01&password=AlphaOmega637&orderNo=&customerRef=123456789&company=&department=&titleOfficer=&orderComment=&starterRemarks=&serviceType=TitlePoint.LegalAndVesting2&parameters=Pin%3D7012-017-018%3BLvLookup%3DAddress%3BLvLookupValue%3D1245+Maple+Ave%2C+Cerritos%3BLvReportFormat%3DLV%3BIncludeTaxAssessor%3Dtrue&fipsCode=06037
```

### Response
**Sample-proven:**

```6:11:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<ServiceResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <RequestID>9841524</RequestID>
  <OrderID>TP-8847292</OrderID>
</ServiceResult>
```

## 5.4 GetRequestSummaries

### Request
**Code-proven** from frontend controller and geo library

```text
GET https://www.titlepoint.com/TitlePointServices/TpsService.asmx/GetRequestSummaries?userID=PCTXML01&password=AlphaOmega637&company=&department=&titleOfficer=&requestId=9841524&maxWaitSeconds=20
```

### Response
**Sample-proven:**

```33:58:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<ServiceResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <RequestSummaries>
    <RequestSummary>
      <Status>Complete</Status>
      <Order>
        <Services>
          <Service>
            <ID>SVC-LV-7721895</ID>
            <ThumbNails>
              <ResultThumbNail>
                <ID>RES-LV-3318743</ID>
```

## 5.5 CreateRequest3

### Request
**Code-proven** from `generateImg()`, `generateTaxDoc()`, `generateGeoImg()`

```text
POST https://www.titlepoint.com/TitlePointServices/TpsGenerateImage.asmx/CreateRequest3

username=PCTXML01&password=AlphaOmega637&serviceId1=SVC-LV-7721895&serviceId2=&source=&clientKey1=&clientKey2=&sortOrder=&fileType=pdf&
```

### Response
**Sample-proven:**

```68:73:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<GenerateImageResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <RequestID>IMG-9988742</RequestID>
  <OrderID>TP-IMG-5541873</OrderID>
</GenerateImageResult>
```

## 5.6 GetRequestStatus

### Request
**Code-proven**

```text
POST https://www.titlepoint.com/TitlePointServices/TpsGenerateImage.asmx/GetRequestStatus

username=PCTXML01&password=AlphaOmega637&requestId=IMG-9988742&
```

### Response (processing)
**Sample-proven:**

```101:106:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<GenerateImageResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <Status>Processing</Status>
  <Message>Request is being processed</Message>
</GenerateImageResult>
```

### Response (ready)
**Sample-proven:**

```116:121:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<GenerateImageResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <Status>Success</Status>
  <Message>Request completed</Message>
</GenerateImageResult>
```

## 5.7 GetGeneratedImage

### Request
**Code-proven**

```text
POST https://www.titlepoint.com/TitlePointServices/TpsGenerateImage.asmx/GetGeneratedImage

username=PCTXML01&password=AlphaOmega637&requestId=IMG-9988742&
```

### Response
**Sample-proven:**

```84:90:TransactionDeskClone/docs/titlepoint-samples/08_raw_xml_create_service.xml
<GenerateImageResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <ReturnStatus>Success</ReturnStatus>
  <ReturnErrors />
  <Status>Success</Status>
  <Message>Image generated successfully</Message>
  <Data>JVBERi0xLjcNCiW1tbW1DQo... [BASE64_ENCODED_PDF_DATA]</Data>
</GenerateImageResult>
```

## 5.8 GetDocumentsByParameters3 (Grant Deed)

### Request
**Code-proven**

```text
POST https://www.titlepoint.com/TitlePointServices/TpsImage.asmx/GetDocumentsByParameters3

parameters=FIPS=06037,TYPE=REC,SUBTYPE=ALL,YEAR=2019,INST=298741&username=PCTXML01&password=AlphaOmega637&company=&department=&titleOfficer=&pages=&propertyOnly=FALSE&maxPageCount=0&maxSizeInKB=0&additionalInfo=&customerRef=&fileType=PDF&
```

### Response
**Sample-proven:**

```9:33:TransactionDeskClone/docs/titlepoint-samples/07_raw_xml_grant_deed.xml
<ImageResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://titlepoint.com/ws/">
  <Status>
    <Code>0</Code>
    <Msg>OK</Msg>
  </Status>
  <Documents>
    <DocumentResponse>
      <DocStatus>
        <Code>0</Code>
        <Msg>OK</Msg>
      </DocStatus>
      <Document>
        <FileType>PDF</FileType>
        <PageCount>2</PageCount>
        <FIPS>06037</FIPS>
        <Year>2019</Year>
        <Instrument>298741</Instrument>
```

---

## 6. Grant Deed normalization examples

## Proven normalization logic

```191:206:TransactionDeskClone/application/libraries/order/Titlepoint.php
        if (isset($instrumentNumber) && !empty($instrumentNumber)) {
            if (isset($recordedDate) && !empty($recordedDate)) {
                $time = strtotime($recordedDate);
                $year = date('Y', $time);
            }
            $count = substr_count($instrumentNumber, '-');

            if (isset($count) && !empty($count)) {
                $detailDocInfo = explode('-', $instrumentNumber);
                $docId = isset($detailDocInfo['1']) && !empty($detailDocInfo['1']) ? $detailDocInfo['1'] : '';
            } else {
                $docId = str_replace($year, '', $instrumentNumber);
            }

            $docId = (string) ((int) ($docId));
        }
```

## Real examples available in repo

### Example 1
- original instrument number: `20190298741`
- recorded date: `03/15/2019`
- normalized `INST=`: `298741`

Evidence:

- LV sample original:

```18:20:TransactionDeskClone/docs/titlepoint-samples/06_raw_xml_legal_vesting.xml
        <DocType>Grant Deed</DocType>
        <InstrumentNumber>20190298741</InstrumentNumber>
        <RecordedDate>03/15/2019</RecordedDate>
```

- Grant Deed sample normalized:

```23:29:TransactionDeskClone/docs/titlepoint-samples/07_raw_xml_grant_deed.xml
        <FIPS>06037</FIPS>
        <Year>2019</Year>
        <Instrument>298741</Instrument>
```

### Example 2
- original instrument number: `20190298742`
- recorded date: `03/15/2019`
- normalized `INST=`: `298742`

Evidence:

```25:27:TransactionDeskClone/docs/titlepoint-samples/06_raw_xml_legal_vesting.xml
        <DocType>Deed Of Trust</DocType>
        <InstrumentNumber>20190298742</InstrumentNumber>
        <RecordedDate>03/15/2019</RecordedDate>
```

Applying the legacy normalization logic:

- strip year `2019`
- remaining string = `0298742`
- cast to int string = `298742`

### Example 3
The repo does **not** contain a third full original-to-normalized pair from stored legacy request/response evidence.

What is available:

- normalized geo/grant-deed-era document ids like `187432`, `187433`, `045219` in the geo sample
- only two original LV instrument numbers in the saved LV sample

So a third **real** pair is **not available in the repo artifacts I could access**.

---

## 7. Legacy logs with exact final wire string

## What is proven
The legacy system logs:

- `request_url`
- `request_data`
- `response_data`

Model evidence:

```9:39:TransactionDeskClone/application/modules/frontend/models/order/ApiLogs.php
    public function syncLogs($user_id, $api_type, $request_type, $request_url, $request_data, $response_data, $order_id = 0, $logId = 0) 
    {
        if(is_array($request_data)) {
            $request_data = json_encode($request_data, true);
        }
        // ...
                'request_data' => !empty($request_data) ? $request_data : '',
                'request_url' => $request_url,
        // ...
                'response_data' => !empty($response_data) ? $response_data : '',
```

So the exact final wire string did exist in the legacy DB logs:

- GET form as `request_url`
- POST params as `request_data`

## What is unavailable in this repo snapshot
I could not pull live historical rows from `pct_order_api_logs` in this session, so I do **not** have actual persisted request/response log rows to attach here.

That means:

- the **code-proven request shapes** above are exact
- the **sample XML responses** above are exact sample payloads
- but a **live legacy row dump** of `request_url` / `request_data` / `response_data` is not included here

## Best next lookup if DB access is restored
Query `pct_order_api_logs` for `api_type = 'titlepoint'` and these `request_type` values:

- `create_service_3`
- `create_service_4`
- `get_request_summary_3`
- `get_request_summary_4`
- `get_result_by_id_3`
- `get_result_by_id_4`
- `create_geo_request`
- `generate_geo_document`
- `create_lv_image_request`
- `lv_image_request_status`
- `generate_lv_image`
- `create_tax_image_request`
- `tax_image_request_status`
- `generate_tax_image`
- `create_geo_image_request`
- `geo_image_request_status`
- `generate_geo_image`
- `generate_grant_deed`

That would produce the exact historical wire evidence the code was logging.

---

## Bottom Line

The key blocking questions are now settled by legacy evidence:

- LV `GetResultByID` is **GET**, not POST
- pre-init is **Tax + LV only**
- Geo does **not** start in pre-init
- Geo result retrieval **does** use the GET + POST dual-call pattern
- `enable_lv_with_address_apn` is a real admin config in `pct_configs`
- `requestId` lowercase is the legacy casing for the polling/image calls
- Grant Deed is a POST request with one `parameters` field, not split params

The only major missing evidence now is live historical `pct_order_api_logs` rows, not code truth.
