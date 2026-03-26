<?php
if (!defined('BASEPATH')) {
    exit('No direct script access allowed');
}

class Titlepoint
{
    public $count = 0;
    public $taxcount = 0;
    public $geocount = 0;
    public $lvcount = 0;
    public static $CI;

    public function __construct($params = array())
    {
        $this->CI = &get_instance();
        $this->CI->load->database();
        $this->CI->load->library('session');
        $this->CI->load->model('order/titlePointData');
        $this->CI->load->model('order/titlePointDocumentRecords');
        $this->CI->load->model('order/apiLogs');
        $this->CI->load->library('order/order');
        self::$CI = $this->CI;
    }

    public function generateImg($serviceId, $fileNumber, $orderId)
    {
        $userdata = $this->CI->session->userdata('user');
        $serviceId = isset($serviceId) && !empty($serviceId) ? $serviceId : '';
        $opts = array(
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );
        $context = stream_context_create($opts);

        if ($serviceId) {
            $requestParams = array(
                'username' => env('TP_USERNAME'),
                'password' => env('TP_PASSWORD'),
                'serviceId1' => $serviceId,
                'serviceId2' => '',
                'source' => '',
                'clientKey1' => '',
                'clientKey2' => '',
                'sortOrder' => '',
                'fileType' => 'pdf',
            );
            $requestUrl = env('TP_IMAGE_ENDPOINT');

            $request = $requestUrl . http_build_query($requestParams);

            $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_lv_image_request', $request, $requestParams, array(), $orderId, 0);
            $response = $this->CI->order->curl_post($requestUrl, $requestParams);

            // $file = file_get_contents($request,false,$context);
            // $xmlData = simplexml_load_string($file);
            // $response = json_encode($xmlData);
            $result = json_decode($response, true);

            $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_lv_image_request', $request, $requestParams, $result, $orderId, $logid);

            $returnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
            $returnStatus = strtolower($returnStatus);
            if ($returnStatus == 'success') {
                $requestId = isset($result['RequestID']) && !empty($result['RequestID']) ? $result['RequestID'] : '';
                $requestOrderId = isset($result['OrderID']) && !empty($result['OrderID']) ? $result['OrderID'] : '';

                if (isset($requestId) && !empty($requestId)) {
                    /*$response = $this->getImageRequestStatus($requestId,$orderId);

                    $imgResult = json_decode($response, TRUE);

                    if(isset($imgResult) && !empty($imgResult))
                    {
                    $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
                    $status = isset($imgResult['Status']) && !empty($imgResult['Status']) ? $imgResult['Status'] : '';
                    $imgReturnStatus = strtolower($imgReturnStatus);
                    $status = strtolower($status);
                    if($imgReturnStatus == 'success' && $status == 'success')
                    {*/
                    $generateImgResponse = $this->generateImage($requestId, $orderId, $fileNumber, 'LV');

                    $generateImgResult = json_decode($generateImgResponse, true);
                    $generateImgReturnStatus = isset($generateImgResult['ReturnStatus']) && !empty($generateImgResult['ReturnStatus']) ? $generateImgResult['ReturnStatus'] : '';
                    $generateImgStatus = isset($generateImgResult['Status']) && !empty($generateImgResult['Status']) ? $generateImgResult['Status'] : '';

                    $generateImgMsg = isset($generateImgResult['Message']) && !empty($generateImgResult['Message']) ? $generateImgResult['Message'] : '';
                    $generateImgReturnStatus = strtolower($generateImgReturnStatus);
                    $generateImgStatus = strtolower($generateImgStatus);
                    if ($generateImgReturnStatus == 'success' && $generateImgStatus == 'success') {
                        $base64_data = isset($generateImgResult['Data']) && !empty($generateImgResult['Data']) ? $generateImgResult['Data'] : '';

                        if (isset($base64_data) && !empty($base64_data)) {
                            $bin = base64_decode($base64_data, true);

                            if (!is_dir('uploads/legal-vesting')) {
                                mkdir('./uploads/legal-vesting', 0777, true);
                            }
                            $pdfFilePath = './uploads/legal-vesting/' . $fileNumber . '.pdf';
                            file_put_contents($pdfFilePath, $bin);
                            $this->CI->order->uploadDocumentOnAwsS3($fileNumber . '.pdf', 'legal-vesting');
                        }

                        $tpData = array(
                            'lv_file_status' => $generateImgStatus,
                            'lv_file_message' => $generateImgMsg,
                            'lv_request_id' => $requestId,
                            'lv_order_id' => $requestOrderId,
                        );
                    } else if ($generateImgReturnStatus == 'success' && $generateImgStatus != 'success') {
                        $tpData = array(
                            'lv_file_status' => $generateImgStatus,
                            'lv_file_message' => $generateImgMsg,
                            'lv_request_id' => $requestId,
                            'lv_order_id' => $requestOrderId,
                        );
                        /*$condition =array(
                    'file_number' => $fileNumber
                    );
                    $this->CI->titlePointData->update($tpData,$condition);*/
                    } else {
                        $error = isset($generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                        $tpData = array(
                            'lv_file_status' => $generateImgReturnStatus,
                            'lv_file_message' => $error,
                            'lv_request_id' => $requestId,
                            'lv_order_id' => $requestOrderId,
                        );
                        /*$condition =array(
                    'file_number' => $fileNumber
                    );
                    $this->CI->titlePointData->update($tpData,$condition);*/
                    }
                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);

                    /*}
                else if($imgReturnStatus == 'success' && $status != 'success')
                {
                $message = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                $tpData = array(
                'lv_file_status' => $status,
                'lv_file_message' => $message,
                'lv_order_id' => $requestOrderId
                );
                $condition =array(
                'file_number' => $fileNumber
                );
                $this->CI->titlePointData->update($tpData,$condition);
                }
                else
                {
                $error = isset($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $imgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                $tpData = array(
                'lv_file_status' => $imgReturnStatus,
                'lv_file_message' => $error,
                'lv_order_id' => $requestOrderId
                );
                $condition =array(
                'file_number' => $fileNumber
                );
                $this->CI->titlePointData->update($tpData,$condition);
                }
                }*/

                }
            } else {
                $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                $tpData = array(
                    'lv_file_status' => $returnStatus,
                    'lv_file_message' => $error,
                );
                $condition = array(
                    'file_number' => $fileNumber,
                );
                $this->CI->titlePointData->update($tpData, $condition);
            }
        }
    }

    public function generateGrantDeed($instrumentNumber, $recordedDate, $fips, $fileNumber, $orderId)
    {
        $userdata = $this->CI->session->userdata('user');
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

        $requestParams = array(
            'parameters' => 'FIPS=' . $fips . ',TYPE=REC,SUBTYPE=ALL,YEAR=' . $year . ',INST=' . $docId . '',
            'username' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'company' => '',
            'department' => '',
            'titleOfficer' => '',
            'pages' => '',
            'propertyOnly' => 'FALSE',
            'maxPageCount' => 0,
            'maxSizeInKB' => 0,
            'additionalInfo' => '',
            'customerRef' => '',
            'fileType' => 'PDF',
        );

        $request = env('GRANT_DEED_ENDPOINT') . http_build_query($requestParams);

        $opts = array(
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );

        $context = stream_context_create($opts);

        $requestUrl = env('GRANT_DEED_ENDPOINT');
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_grant_deed', $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        // $file = file_get_contents($request,false,$context);
        // $xmlData = simplexml_load_string($file);

        // $response = json_encode($xmlData);
        $result = json_decode($response, true);

        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_grant_deed', $request, $requestParams, $result, $orderId, $logid);

        $responseStatus = isset($result['Status']['Msg']) && !empty($result['Status']['Msg']) ? $result['Status']['Msg'] : '';

        $docStatus = isset($result['Documents']['DocumentResponse']['DocStatus']['Msg']) && !empty($result['Documents']['DocumentResponse']['DocStatus']['Msg']) ? $result['Documents']['DocumentResponse']['DocStatus']['Msg'] : '';
        $docStatus = strtolower($docStatus);
        if (isset($docStatus) && !empty($docStatus) && $docStatus == 'ok') {
            $base64_data = isset($result['Documents']['DocumentResponse']['Document']['Body']['Body']) && !empty($result['Documents']['DocumentResponse']['Document']['Body']['Body']) ? $result['Documents']['DocumentResponse']['Document']['Body']['Body'] : '';

            if (isset($base64_data) && !empty($base64_data)) {
                $bin = base64_decode($base64_data, true);

                if (!is_dir('uploads/grant-deed')) {
                    mkdir('./uploads/grant-deed', 0777, true);
                }
                $pdfFilePath = './uploads/grant-deed/' . $fileNumber . '.pdf';
                file_put_contents($pdfFilePath, $bin);
                $this->CI->order->uploadDocumentOnAwsS3($fileNumber . '.pdf', 'grant-deed');
                $tpData = array(
                    'grant_deed_status' => $docStatus,
                    'grant_deed_message' => 'success',
                );
            } else {
                $tpData = array(
                    'grant_deed_status' => 'failed',
                    'grant_deed_message' => 'failed',
                );
            }

        } else {
            $tpData = array(
                'grant_deed_status' => 'failed',
                'grant_deed_message' => $docStatus,
            );
        }

        $condition = array(
            'file_number' => $fileNumber,
        );
        $this->CI->titlePointData->update($tpData, $condition);
    }

    public function generateTaxDoc($serviceId, $fileNumber, $orderId)
    {
        $userdata = $this->CI->session->userdata('user');
        $serviceId = isset($serviceId) && !empty($serviceId) ? $serviceId : '';
        $opts = array(
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );
        $context = stream_context_create($opts);

        if ($serviceId) {
            $requestParams = array(
                'username' => env('TP_USERNAME'),
                'password' => env('TP_PASSWORD'),
                'serviceId1' => $serviceId,
                'serviceId2' => '',
                'source' => '',
                'clientKey1' => '',
                'clientKey2' => '',
                'sortOrder' => '',
                'fileType' => 'pdf',
            );
            $requestUrl = env('TP_IMAGE_ENDPOINT');

            $request = $requestUrl . http_build_query($requestParams);

            $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_tax_image_request', $request, $requestParams, array(), $orderId, 0);
            $response = $this->CI->order->curl_post($requestUrl, $requestParams);
            // $file = file_get_contents($request,false,$context);
            // $xmlData = simplexml_load_string($file);
            // $response = json_encode($xmlData);
            $result = json_decode($response, true);

            $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_tax_image_request', $request, $requestParams, $result, $orderId, $logid);

            $returnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
            $returnStatus = strtolower($returnStatus);

            if ($returnStatus == 'success') {
                $requestId = isset($result['RequestID']) && !empty($result['RequestID']) ? $result['RequestID'] : '';
                $requestOrderId = isset($result['OrderID']) && !empty($result['OrderID']) ? $result['OrderID'] : '';
                if (isset($requestId) && !empty($requestId)) {
                    /*$imgresponse = $this->getTaxImageRequestStatus($requestId,$orderId);
                    $imgResult = json_decode($imgresponse, TRUE);

                    $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
                    $status = isset($imgResult['Status']) && !empty($imgResult['Status']) ? $imgResult['Status'] : '';
                    $imgReturnStatus = strtolower($imgReturnStatus);
                    $status = strtolower($status);
                    if($imgReturnStatus == 'success' && $status == 'success')
                    {*/
                    $generateImgResponse = $this->generateTaxImage($requestId, $orderId, $fileNumber);

                    $generateImgResult = json_decode($generateImgResponse, true);
                    $generateImgReturnStatus = isset($generateImgResult['ReturnStatus']) && !empty($generateImgResult['ReturnStatus']) ? $generateImgResult['ReturnStatus'] : '';
                    $generateImgStatus = isset($generateImgResult['Status']) && !empty($generateImgResult['Status']) ? $generateImgResult['Status'] : '';

                    $generateImgMsg = isset($generateImgResult['Message']) && !empty($generateImgResult['Message']) ? $generateImgResult['Message'] : '';
                    $generateImgReturnStatus = strtolower($generateImgReturnStatus);
                    $generateImgStatus = strtolower($generateImgStatus);
                    if ($generateImgReturnStatus == 'success' && $generateImgStatus == 'success') {
                        $base64_data = isset($generateImgResult['Data']) && !empty($generateImgResult['Data']) ? $generateImgResult['Data'] : '';

                        if (isset($base64_data) && !empty($base64_data)) {
                            $bin = base64_decode($base64_data, true);

                            if (!is_dir('uploads/tax')) {
                                mkdir('./uploads/tax', 0777, true);
                            }

                            $pdfFilePath = './uploads/tax/' . $fileNumber . '.pdf';
                            file_put_contents($pdfFilePath, $bin);
                            $this->CI->order->uploadDocumentOnAwsS3($fileNumber . '.pdf', 'tax');
                        }

                        $tpData = array(
                            'tax_file_status' => $generateImgStatus,
                            'tax_file_message' => $generateImgMsg,
                            'tax_request_id' => $requestId,
                            'tax_order_id' => $requestOrderId,
                        );
                    } else if ($generateImgReturnStatus == 'success' && $generateImgStatus != 'success') {
                        $tpData = array(
                            'tax_file_status' => $generateImgStatus,
                            'tax_file_message' => $generateImgMsg,
                            'tax_request_id' => $requestId,
                            'tax_order_id' => $requestOrderId,
                        );
                    } else {
                        $error = isset($generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                        $tpData = array(
                            'tax_file_status' => $generateImgReturnStatus,
                            'tax_file_message' => $error,
                            'tax_request_id' => $requestId,
                            'tax_order_id' => $requestOrderId,
                        );
                    }
                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);

                    /*}
                else if($imgReturnStatus == 'success' && $status != 'success')
                {
                $message = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                $tpData = array(
                'tax_file_status' => $status,
                'tax_file_message' => $message,
                'tax_order_id' => $requestOrderId
                );
                $condition =array(
                'file_number' => $fileNumber
                );
                $this->CI->titlePointData->update($tpData,$condition);
                }
                else
                {
                $error = isset($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $imgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                $tpData = array(
                'tax_file_status' => $imgReturnStatus,
                'tax_file_message' => $error,
                'tax_order_id' => $requestOrderId
                );
                $condition =array(
                'file_number' => $fileNumber
                );
                $this->CI->titlePointData->update($tpData,$condition);
                }*/
                }
            } else {
                $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                $tpData = array(
                    'tax_file_status' => $returnStatus,
                    'tax_file_message' => $error,
                );
                $condition = array(
                    'file_number' => $fileNumber,
                );
                $this->CI->titlePointData->update($tpData, $condition);
            }
        }
    }

    public function generateGeoDoc($postData, $normalOrderFlag = 0)
    {
        $fileNumber = $postData['file_number'];
        $orderId = $postData['order_id'];
        $state = $postData['state'];
        $county = $postData['county'];
        $property = $postData['property'];
        $apn = $postData['apn'];
        $unit_number = $postData['unit_number'];

        if (empty($unit_number) || (isset($postData['tax_search_done_flag']) && $postData['tax_search_done_flag'] == 1)) {
            $parameters = 'Address.FullAddress=' . $property . ';General.AutoSearchTaxes=False;Tax.CurrentYearTaxesOnly=False;General.AutoSearchProperty=True;General.AutoSearchOwnerNames=False;General.AutoSearchStarters=False;Property.IntelligentPropertyGrouping=true;';
            $addressFlag = 1;
        } else {
            $addressFlag = 0;
            $parameters = 'Tax.APN=' . $apn . ';IncludeReferenceDocs=True;General.AutoSearchProperty=True;General.AutoSearchTaxes=True;Property.IntelligentPropertyGrouping=True;Property.IncludeReferenceDocs=TrueGeneral.AutoSearchTaxes=True;Tax.CurrentYearTaxesOnly=True;';
        }

        $userdata = $this->CI->session->userdata('user');
        // $serviceId = isset($serviceId) && !empty($serviceId) ? $serviceId : '';
        $opts = array(
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );
        $context = stream_context_create($opts);

        $requestParams = array(
            'userID' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'serviceType' => TP_GEO_SERVICE_TYPE,
            // 'parameters' =>  'Address.FullAddress=1358 5th St;General.AutoSearchTaxes=False;General.AutoSearchProperty=True',
            'parameters' => $parameters,
            'department' => '',
            'orderNo' => '',
            'customerRef' => '',
            'company' => '',
            'titleOfficer' => '',
            'orderComment' => '',
            'starterRemarks' => '',
            // 'state'=>  'CA',
            'state' => $state,
            // 'county'=>  'Los Angeles',
            'county' => $county,
        );

        $requestUrl = env('TP_SERVICE_ENDPOINT') . TP_GEO_CREATE_SERVICE_URL;

        $request = $requestUrl . http_build_query($requestParams);

        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_geo_request', $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        $result = json_decode($response, true);

        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_geo_request', $request, $requestParams, $result, $orderId, $logid);

        $returnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
        $returnStatus = strtolower($returnStatus);

        if ($returnStatus == 'success') {
            $requestId = isset($result['RequestID']) && !empty($result['RequestID']) ? $result['RequestID'] : '';
            $requestOrderId = isset($result['OrderID']) && !empty($result['OrderID']) ? $result['OrderID'] : '';

            if (isset($requestId) && !empty($requestId)) {
                $imgresponse = $this->getGeoImageRequestStatus($requestId, $orderId);
                $imgResult = json_decode($imgresponse, true);
                $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
                $status = isset($imgResult['RequestSummaries']['RequestSummary']) && !empty($imgResult['RequestSummaries']['RequestSummary']) ? $imgResult['RequestSummaries']['RequestSummary']['Status'] : '';
                $imgReturnStatus = strtolower($imgReturnStatus);
                $status = strtolower($status);
                // print_r($status);
                // print_r($imgReturnStatus == 'success');
                if ($imgReturnStatus == 'success' && $status == 'complete') {
                    $requestSummary = $imgResult['RequestSummaries']['RequestSummary']['Order']['Services']['Service'];
                    if ($addressFlag == 1) {
                        $thumbnail = $requestSummary['ThumbNails']['ResultThumbNail'];
                        if (isset($thumbnail['Highlights']['string'][2])) {
                            $lineNum = $thumbnail['Highlights']['string'][2];
                            $lineNumArr = explode("=", $lineNum);
                            if ($lineNumArr[1] == 0 && (!isset($postData['is_suffix_adjustment']) || $postData['is_suffix_adjustment'] == 0)) {
                                $words = explode(" ", $property);
                                array_splice($words, -1);
                                $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'suffix_adjustment', $request, $property, [], $orderId, null);
                                $property = implode(" ", $words);
                                $postData['property'] = $property;
                                $postData['is_suffix_adjustment'] = 1;
                                $postData['address_search_done_flag'] = 1;
                                return $this->generateGeoDoc($postData);
                            } else {
                                if (!isset($postData['tax_search_done_flag']) && $lineNumArr[1] == 0) {
                                    $postData['unit_number'] = 1;
                                    $postData['address_search_done_flag'] = 1;
                                    return $this->generateGeoDoc($postData);
                                }
                            }
                        }
                        $serviceId = $requestSummary['ID'];
                        $resultId = $thumbnail['ID'];
                    } else {
                        $count = 0;
                        //echo "<pre>";
                        //print_r($requestSummary);
                        if (count($requestSummary) == 2) {
                            foreach ($requestSummary as $service) {
                                //echo "here";
                                //print_r($service);
                                $thumbnail = $service['ThumbNails']['ResultThumbNail'];
                                //print_r($thumbnail);exit;
                                $lineNum = $thumbnail['Highlights']['string'][2];
                                $lineNumArr = explode("=", $lineNum);
                                if ($lineNumArr[1] >= $count) {
                                    $count = $lineNumArr[1];
                                    $resultId = $thumbnail['ID'];
                                    $serviceId = $service['ID'];
                                }
                            }
                        } else {
                            $thumbnail = $requestSummary['ThumbNails']['ResultThumbNail'];
                            //print_r($thumbnail);exit;
                            $lineNum = $thumbnail['Highlights']['string'][2];
                            $lineNumArr = explode("=", $lineNum);
                            if ($lineNumArr[1] > $count) {
                                $count = $lineNumArr[1];
                            } else {
                                if (!isset($postData['address_search_done_flag'])) {
                                    $postData['tax_search_done_flag'] = 1;
                                    return $this->generateGeoDoc($postData);
                                }
                            }
                            $resultId = $thumbnail['ID'];
                            $serviceId = $requestSummary['ID'];
                        }
                        //echo $resultId."-----".$serviceId;exit;
                    }

                    // echo "Hello if";
                    $generateImgResponse = $this->generateGeoDocument($resultId, $orderId, $fileNumber, $postData);

                    $generateImgResult = json_decode($generateImgResponse, true);
                    // echo "<pre>Hello";
                    // print_r($generateImgResult['ReturnStatus']);die;
                    $generateImgReturnStatus = isset($generateImgResult['ReturnStatus']) && !empty($generateImgResult['ReturnStatus']) ? $generateImgResult['ReturnStatus'] : '';
                    // $generateImgStatus = isset($generateImgResult['Status']) && !empty($generateImgResult['Status']) ? $generateImgResult['Status'] : '';

                    $generateImgMsg = isset($generateImgResult['Message']) && !empty($generateImgResult['Message']) ? $generateImgResult['Message'] : '';
                    $generateImgReturnStatus = strtolower($generateImgReturnStatus);
                    // $generateImgStatus = strtolower($generateImgStatus);
                    if ($generateImgReturnStatus == 'success') {
                        /** Generate image and uploadin AWS */
                        if ($normalOrderFlag == 1) {
                            return true;
                        } else {
                            return $this->generateGeoImg($serviceId, $fileNumber, $orderId, $requestOrderId);
                        }
                    } else {
                        $error = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                        $tpData = array(
                            'geo_file_status' => $generateImgReturnStatus,
                            'geo_file_message' => $error,
                            'geo_order_id' => $resultId,
                        );
                        $condition = array(
                            'file_number' => $fileNumber,
                        );
                        $this->CI->titlePointData->update($tpData, $condition);
                    }
                } else if ($imgReturnStatus == 'success' && $status != 'success') {
                    $message = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                    $tpData = array(
                        'geo_file_status' => $status,
                        'geo_file_message' => $message,
                        'geo_order_id' => $requestOrderId,
                    );
                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);
                } else {
                    $error = isset($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $imgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                    $tpData = array(
                        'geo_file_status' => $imgReturnStatus,
                        'geo_file_message' => $error,
                        'geo_order_id' => $requestOrderId,
                    );
                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);
                }
            }
        } else {
            $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

            $tpData = array(
                'geo_file_status' => $returnStatus,
                'geo_file_message' => $error,
            );
            $condition = array(
                'file_number' => $fileNumber,
            );
            $this->CI->titlePointData->update($tpData, $condition);
        }

    }

    public function generateGeoImg($serviceId, $fileNumber, $orderId, $requestOrderId)
    {
        $userdata = $this->CI->session->userdata('user');
        $serviceId = isset($serviceId) && !empty($serviceId) ? $serviceId : '';
        $opts = array(
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );
        $context = stream_context_create($opts);

        if ($serviceId) {
            $requestParams = array(
                'username' => env('TP_USERNAME'),
                'password' => env('TP_PASSWORD'),
                'serviceId1' => $serviceId,
                'serviceId2' => '',
                'source' => '',
                'clientKey1' => '',
                'clientKey2' => '',
                'sortOrder' => '',
                'fileType' => 'pdf',
            );
            $requestUrl = env('TP_IMAGE_ENDPOINT');

            $request = $requestUrl . http_build_query($requestParams);

            $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_geo_image_request', $request, $requestParams, array(), $orderId, 0);
            $response = $this->CI->order->curl_post($requestUrl, $requestParams);
            // $file = file_get_contents($request,false,$context);
            // $xmlData = simplexml_load_string($file);
            // $response = json_encode($xmlData);
            $result = json_decode($response, true);

            $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_geo_image_request', $request, $requestParams, $result, $orderId, $logid);

            $returnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
            $returnStatus = strtolower($returnStatus);
            if ($returnStatus == 'success') {
                $requestId = isset($result['RequestID']) && !empty($result['RequestID']) ? $result['RequestID'] : '';
                // $requestOrderId = isset($result['OrderID']) && !empty($result['OrderID']) ? $result['OrderID'] : '';
                if (isset($requestId) && !empty($requestId)) {
                    $response = $this->getImageRequestStatus($requestId, $orderId, 'Geo');

                    $imgResult = json_decode($response, true);

                    if (isset($imgResult) && !empty($imgResult)) {
                        $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
                        $status = isset($imgResult['Status']) && !empty($imgResult['Status']) ? $imgResult['Status'] : '';
                        $imgReturnStatus = strtolower($imgReturnStatus);
                        $status = strtolower($status);
                        if ($imgReturnStatus == 'success' && $status == 'success') {
                            $generateImgResponse = $this->generateImage($requestId, $orderId, $fileNumber, 'Geo');

                            $generateImgResult = json_decode($generateImgResponse, true);
                            // echo "<pre>";
                            // print_r($generateImgResult);die;
                            $generateImgReturnStatus = isset($generateImgResult['ReturnStatus']) && !empty($generateImgResult['ReturnStatus']) ? $generateImgResult['ReturnStatus'] : '';
                            $generateImgStatus = isset($generateImgResult['Status']) && !empty($generateImgResult['Status']) ? $generateImgResult['Status'] : '';

                            $generateImgMsg = isset($generateImgResult['Message']) && !empty($generateImgResult['Message']) ? $generateImgResult['Message'] : '';
                            $generateImgReturnStatus = strtolower($generateImgReturnStatus);
                            $generateImgStatus = strtolower($generateImgStatus);
                            if ($generateImgReturnStatus == 'success' && $generateImgStatus == 'success') {
                                $base64_data = isset($generateImgResult['Data']) && !empty($generateImgResult['Data']) ? $generateImgResult['Data'] : '';

                                if (isset($base64_data) && !empty($base64_data)) {
                                    $bin = base64_decode($base64_data, true);

                                    if (!is_dir('uploads/pre-listing-doc')) {
                                        mkdir('./uploads/pre-listing-doc', 0777, true);
                                    }
                                    $pdfFilePath = './uploads/pre-listing-doc/' . $fileNumber . '.pdf';
                                    file_put_contents($pdfFilePath, $bin);
                                    $this->CI->order->uploadDocumentOnAwsS3($fileNumber . '.pdf', 'pre-listing-doc');
                                }

                                $tpData = array(
                                    'geo_file_status' => $generateImgStatus,
                                    'geo_file_message' => $generateImgMsg,
                                    'geo_order_id' => $requestId,
                                );
                                // $condition =array(
                                //     'file_number' => $fileNumber
                                // );
                                // $updated = $this->CI->titlePointData->update($tpData,$condition);
                                // echo "Hello checlk" . $updated; print_r($condition); die;
                            } else if ($generateImgReturnStatus == 'success' && $generateImgStatus != 'success') {

                                $tpData = array(
                                    'geo_file_status' => $generateImgStatus,
                                    'geo_file_message' => $generateImgMsg,
                                    'geo_order_id' => $requestId,
                                );
                                // $condition =array(
                                //     'file_number' => $fileNumber
                                // );
                                // $this->CI->titlePointData->update($tpData,$condition);
                            } else {
                                $error = isset($generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $generateImgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                                $tpData = array(
                                    'geo_file_status' => $generateImgReturnStatus,
                                    'geo_file_message' => $error,
                                    'geo_order_id' => $requestId,
                                );
                                // $condition =array(
                                //     'file_number' => $fileNumber
                                // );
                                // $this->CI->titlePointData->update($tpData,$condition);
                            }
                            $condition = array(
                                'file_number' => $fileNumber,
                            );
                            return $this->CI->titlePointData->update($tpData, $condition);

                        } else if ($imgReturnStatus == 'success' && $status != 'success') {
                            $message = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                            $tpData = array(
                                'geo_file_status' => $status,
                                'geo_file_message' => $message,
                                'geo_order_id' => $requestId,
                            );
                            $condition = array(
                                'file_number' => $fileNumber,
                            );
                            return $this->CI->titlePointData->update($tpData, $condition);
                        } else {
                            $error = isset($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $imgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                            $tpData = array(
                                'geo_file_status' => $imgReturnStatus,
                                'geo_file_message' => $error,
                                'geo_order_id' => $requestId,
                            );
                            $condition = array(
                                'file_number' => $fileNumber,
                            );
                            return $this->CI->titlePointData->update($tpData, $condition);
                        }
                    }

                }
            } else {
                $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

                $tpData = array(
                    'geo_file_status' => $returnStatus,
                    'geo_file_message' => $error,
                    'geo_order_id' => $serviceId,
                );
                $condition = array(
                    'file_number' => $fileNumber,
                );
                return $this->CI->titlePointData->update($tpData, $condition);
            }
        }
    }

    /*public function generateTaxDoc($serviceId,$fileNumber)
    {
    $serviceId = isset($serviceId) && !empty($serviceId) ? $serviceId : '';
    $opts = array(
    "ssl"=>array(
    "verify_peer"=>false,
    "verify_peer_name"=>false,
    ),
    );
    $context = stream_context_create($opts);
    if($serviceId)
    {
    $requestParams = array(
    'username' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'serviceId1' =>  $serviceId,
    'serviceId2'=>  '',
    'source'=>  '',
    'clientKey1'=>  '',
    'clientKey2'=>  '',
    'sortOrder'=>  '',
    'fileType'=>  'pdf',
    );
    $requestUrl= env('TP_IMAGE_ENDPOINT');

    $request = $requestUrl.http_build_query($requestParams);

    $file = file_get_contents($request,false,$context);
    $xmlData = simplexml_load_string($file);
    $response = json_encode($xmlData);
    $result = json_decode($response,TRUE);
    $status = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
    if($status == 'Success' || $status == 'Processing')
    {
    $requestId = isset($result['RequestID']) && !empty($result['RequestID']) ? $result['RequestID'] : '';

    if(isset($requestId) && !empty($requestId))
    {
    $requestParams = array(
    'username' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'requestId'=>  $requestId
    );
    $request = env('TP_IMAGE_REQUEST_STATUS').http_build_query($requestParams);

    $file = file_get_contents($request,false,$context);
    $xmlData = simplexml_load_string($file);
    $response = json_encode($xmlData);
    $result = json_decode($response,TRUE);

    $status = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
    $reqStatus = isset($result['Status']) && !empty($result['Status']) ? $result['Status'] : '';
    $reqMessage = isset($result['Message']) && !empty($result['Message']) ? $result['Message'] : '';
    if($status == 'Success')
    {
    if($reqStatus == 'Success' || $reqStatus == 'Processing')
    {
    $requestParams = array(
    'username' => env('TP_USERNAME'),
    'password' => env('TP_PASSWORD'),
    'requestId'=>  $requestId
    );

    $request = env('TP_GENERATE_IMAGE').http_build_query($requestParams);
    $file = file_get_contents($request,false,$context);

    $xmlData = simplexml_load_string($file);
    $response = json_encode($xmlData);
    $result = json_decode($response,TRUE);
    $responseStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
    if($responseStatus == 'Success' || $reqStatus == 'Processing')
    {
    $reqStatus = isset($result['Status']) && !empty($result['Status']) ? $result['Status'] : '';
    $reqMessage = isset($result['Message']) && !empty($result['Message']) ? $result['Message'] : '';
    $base64_data = isset($result['Data']) && !empty($result['Data']) ? $result['Data'] : '';
    $bin = base64_decode($base64_data, true);

    if (!is_dir('uploads/tax')) {
    mkdir('./uploads/tax', 0777, TRUE);
    }
    $pdfFilePath = './uploads/tax/'.$fileNumber.'.pdf';
    file_put_contents($pdfFilePath, $bin);
    }
    }
    $tpData = array(
    'tax_file_status' => $reqStatus,
    'tax_file_message' => $reqMessage
    );
    $condition =array(
    'file_number' => $fileNumber
    );
    $this->CI->titlePointData->update($tpData,$condition);

    }
    else
    {
    $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

    $tpData = array(
    'tax_file_status' => $status,
    'tax_file_message' => $error
    );
    $condition =array(
    'file_number' => $fileNumber
    );
    $this->CI->titlePointData->update($tpData,$condition);
    }
    }
    }
    else
    {
    $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';

    $tpData = array(
    'tax_file_status' => $status,
    'tax_file_message' => $error
    );
    $condition =array(
    'file_number' => $fileNumber
    );
    $this->CI->titlePointData->update($tpData,$condition);
    }

    }
    }*/

    public function getImageRequestStatus($requestId, $orderId, $requestFrom = '')
    {
        $userdata = $this->CI->session->userdata('user');
        $requestParams = array(
            'username' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'requestId' => $requestId,
        );
        $request = env('TP_IMAGE_REQUEST_STATUS') . http_build_query($requestParams);
        $requestUrl = env('TP_IMAGE_REQUEST_STATUS');
        $requestName = ($requestFrom == 'Geo') ? 'geo_image_request_status' : 'lv_image_request_status';

        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', $requestName, $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);

        // $file = file_get_contents($request,false,$context);
        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);

        $imgResult = json_decode($response, true);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', $requestName, $request, $requestParams, $imgResult, $orderId, $logid);

        $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
        $imgReturnStatus = strtolower($imgReturnStatus);
        if ($imgReturnStatus == 'success') {
            $status = isset($imgResult['Status']) && !empty($imgResult['Status']) ? $imgResult['Status'] : '';
            $status = strtolower($status);
            if ($status == 'success') {
                return $response;
            } else if ($status == 'processing') {
                if ($this->count <= 3) {
                    sleep(1);
                    $this->count = $this->count + 1;
                    return $this->getImageRequestStatus($requestId, $orderId, $requestFrom);
                } else {
                    $this->count = 0;
                    return $response;
                }

            } else {
                return $response;
            }
        } else {
            return $response;
        }
    }

    public function generateImage($requestId, $orderId, $fileNumber, $requestFrom = '')
    {
        $userdata = $this->CI->session->userdata('user');
        $requestParams = array(
            'username' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'requestId' => $requestId,
        );

        $request = env('TP_GENERATE_IMAGE') . http_build_query($requestParams);
        $requestName = ($requestFrom == 'Geo') ? 'generate_geo_image' : 'generate_lv_image';
        $requestUrl = env('TP_GENERATE_IMAGE');
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', $requestName, $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        // $file = file_get_contents($request,false,$context);

        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);
        $result = json_decode($response, true);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', $requestName, $request, $requestParams, $result, $orderId, $logid);

        if ($requestFrom == 'LV') {
            $imgReturnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
            $imgReturnStatus = strtolower($imgReturnStatus);

            $generateImgStatus = isset($result['Status']) && !empty($result['Status']) ? $result['Status'] : '';
            $generateImgStatus = strtolower($generateImgStatus);

            if ($imgReturnStatus == 'success') {
                if ($generateImgStatus == 'processing') {
                    $this->CI->session->set_userdata('lv_doc_status', 'processing');
                    if ($this->lvcount <= 3) {
                        sleep(1);
                        $this->lvcount += 1;
                        return $this->generateImage($requestId, $orderId, $fileNumber, 'LV');
                    } else {
                        try {
                            $command = "php " . FCPATH . "index.php frontend/order/cron generateLVDocument $requestId $orderId $fileNumber > /dev/null &";
                            exec($command);
                        } catch (\Throwable $th) {
                            // print_r($th->getMessages());
                        }
                        $this->lvcount = 0;
                        return $response;
                    }

                } else {
                    $this->CI->session->set_userdata('lv_doc_status', 'success');
                    $tpData = array(
                        'lv_file_status' => strtolower($generateImgStatus),
                    );

                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);
                    return $response;
                }
            }
        }

        return $response;
    }

    public function getTaxImageRequestStatus($requestId, $orderId)
    {
        $userdata = $this->CI->session->userdata('user');
        $requestParams = array(
            'username' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'requestId' => $requestId,
        );
        $request = env('TP_IMAGE_REQUEST_STATUS') . http_build_query($requestParams);
        $requestUrl = env('TP_IMAGE_REQUEST_STATUS');
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'tax_image_request_status', $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        // $file = file_get_contents($request,false,$context);
        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);

        $imgResult = json_decode($response, true);

        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'tax_image_request_status', $request, $requestParams, $imgResult, $orderId, $logid);

        $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
        $imgReturnStatus = strtolower($imgReturnStatus);
        if ($imgReturnStatus == 'success') {
            $status = isset($imgResult['Status']) && !empty($imgResult['Status']) ? $imgResult['Status'] : '';
            $status = strtolower($status);
            if ($status == 'success') {
                return $response;
            } else if ($status == 'processing') {
                if ($this->taxcount < 6) {
                    sleep(1);
                    $this->taxcount = $this->taxcount + 1;
                    return $this->getTaxImageRequestStatus($requestId, $orderId);
                } else {
                    $this->taxcount = 0;
                    return $response;
                }

            } else {
                return $response;
            }
        } else {
            return $response;
        }
    }

    public function generateTaxImage($requestId, $orderId, $fileNumber)
    {
        $userdata = $this->CI->session->userdata('user');
        $requestParams = array(
            'username' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'requestId' => $requestId,
        );

        $request = env('TP_GENERATE_IMAGE') . http_build_query($requestParams);
        $requestUrl = env('TP_GENERATE_IMAGE');
        // $file = file_get_contents($request,false,$context);
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_tax_image', $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);

        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);
        $result = json_decode($response, true);

        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_tax_image', $request, $response, $result, $orderId, $logid);
        // print_r($result);die;

        $imgReturnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
        $imgReturnStatus = strtolower($imgReturnStatus);

        $generateImgStatus = isset($result['Status']) && !empty($result['Status']) ? $result['Status'] : '';
        $generateImgStatus = strtolower($generateImgStatus);

        if ($imgReturnStatus == 'success') {
            if ($generateImgStatus == 'processing') {
                $this->CI->session->set_userdata('tax_doc_status', 'processing');
                if ($this->taxcount <= 3) {
                    sleep(1);
                    $this->taxcount = $this->taxcount + 1;
                    return $this->generateTaxImage($requestId, $orderId, $fileNumber);
                } else {
                    try {
                        $command = "php " . FCPATH . "index.php frontend/order/cron generateTaxDocument $requestId $orderId $fileNumber > /dev/null &";
                        exec($command);
                    } catch (\Throwable $th) {
                        // print_r($th->getMessages());
                    }
                    $this->taxcount = 0;
                    return $response;
                }

            } else {
                $this->CI->session->set_userdata('tax_doc_status', 'success');
                $tpData = array(
                    'tax_file_status' => strtolower($generateImgStatus),
                );

                $condition = array(
                    'file_number' => $fileNumber,
                );
                $this->CI->titlePointData->update($tpData, $condition);
                return $response;
            }
        }
        return $response;
    }

    public function generateGeoDocument($resultId, $orderId, $fileNumber, $postData)
    {
        $userdata = $this->CI->session->userdata('user');
        $requestParams = array(
            'userID' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'company' => '',
            'department' => '',
            'titleOfficer' => '',
            'requestingTPXML' => "true",
            'resultID' => $resultId,
        );

        // echo "<pre>";
        $requestUrl = env('TP_SERVICE_ENDPOINT') . TP_GEO_GET_RESULT_URL;
        $request = $requestUrl . http_build_query($requestParams);

        $file = file_get_contents($request, false, $context);

        /** Start: Save lp document xml in S3 */
        if (!is_dir('uploads/lp-xml')) {
            mkdir('./uploads/lp-xml', 0777, true);
        }
        $pdfFilePath = './uploads/lp-xml/' . $fileNumber . '.xml';
        file_put_contents($pdfFilePath, $file);
        $this->CI->order->uploadDocumentOnAwsS3($fileNumber . '.xml', 'lp-xml');
        /** End: Save lp document xml in S3 */
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_geo_document', $request, $requestParams, array(), $orderId, 0);

        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_geo_document', $request, $requestParams, $response, $orderId, $logid);
        $result = json_decode($response, true);
        //print_r($result);exit;
        $condition = array(
            'where' => array(
                'file_number' => $fileNumber,
            ),
        );
        $titlePointDetails = $this->CI->titlePointData->gettitlePointDetails($condition);
        $titlePointId = $titlePointDetails[0]['id'];

        /** Save document records here Start*/
        $recordArray = [];
        $filterArr = [];
        $noticeArr = [];
        $i = 0;
        $j = 0;
        $k = 0;
        if ((strtolower($result['ReturnStatus']) == 'success')) {
            // echo "<pre>";
            //print_r($result);
            $resultForProperty = $result['Result']['PickList']['PickListItems'];
            $result = $result['Result']['DocumentList'];
            $addressIds = isset($result['Addresses']['Address']) ? array_column($result['Addresses']['Address'], 'Id') : [];
            $documentIdentifications = $result['DocumentIdentifications']['DocumentIdentification'];
            $images = $result['Images']['Item'];
            $items = $result['Items'];
            $displayDocList = $this->CI->order->getDocumetTypes();
            $displayNoticeDocList = $this->CI->order->getNoticeDocumetTypes();

            $getAllSubCategory = $this->CI->order->getAllSubCategory();
            $getAllSubCategory = array_column($getAllSubCategory, 'doc_type');

            $filteredSubCategoryList = array_filter($displayDocList, function ($item) {
                return $item['subtype_flag'] == 1;
            });
            $filteredSubCateList = array_column($filteredSubCategoryList, 'doc_type');

            $filteredMainCategoryList = array_filter($displayDocList, function ($item) {
                return $item['subtype_flag'] == 0;
            });
            $filteredMainCateList = array_column($filteredMainCategoryList, 'doc_type');
            //echo "here";
            //print_r($resultForProperty['Item']);exit;

            if (isset($items['Item'])) {
                /** Start All instrument number details fetched */
                foreach ($items['Item'] as $key => $val) {
                    $party1Arr = $party2Arr = $party3Arr = $party4Arr = $party5Arr = array();
                    if (!empty($val['Parties1st']['DocumentParty'])) {
                        if (count($val['Parties1st']['DocumentParty']) == 1) {
                            $partyId = $val['Parties1st']['DocumentParty']['@attributes']['Id'];
                            $party1Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                            });
                            $party1Arr = array_merge($party1Arr, $party1Array);
                        } else {
                            foreach ($val['Parties1st']['DocumentParty'] as $party1) {
                                $partyId = $party1['@attributes']['Id'];
                                $party1Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                    return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                                });
                                $party1Arr = array_merge($party1Arr, $party1Array);
                            }
                        }
                    }

                    if (!empty($val['Parties2nd']['DocumentParty'])) {
                        if (count($val['Parties2nd']['DocumentParty']) == 1) {
                            $partyId = $val['Parties2nd']['DocumentParty']['@attributes']['Id'];
                            $party2Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                            });
                            $party2Arr = array_merge($party2Arr, $party2Array);
                        } else {
                            foreach ($val['Parties2nd']['DocumentParty'] as $party2) {
                                $partyId = $party2['@attributes']['Id'];
                                $party2Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                    return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                                });
                                $party2Arr = array_merge($party2Arr, $party2Array);
                            }
                        }
                    }

                    if (!empty($val['Parties3rd']['DocumentParty'])) {
                        if (count($val['Parties3rd']['DocumentParty']) == 1) {
                            $partyId = $val['Parties3rd']['DocumentParty']['@attributes']['Id'];
                            $party3Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                            });
                            $party3Arr = array_merge($party3Arr, $party3Array);
                        } else {
                            foreach ($val['Parties3rd']['DocumentParty'] as $party3) {
                                $partyId = $party3['@attributes']['Id'];
                                $party3Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                    return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                                });
                                $party3Arr = array_merge($party3Arr, $party3Array);
                            }
                        }
                    }

                    if (!empty($val['Parties4th']['DocumentParty'])) {
                        if (count($val['Parties4th']['DocumentParty']) == 1) {
                            $partyId = $val['Parties4th']['DocumentParty']['@attributes']['Id'];
                            $party4Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                            });
                            $party4Arr = array_merge($party4Arr, $party4Array);
                        } else {
                            foreach ($val['Parties4th']['DocumentParty'] as $party4) {
                                $partyId = $party4['@attributes']['Id'];
                                $party4Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                    return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                                });
                                $party4Arr = array_merge($party4Arr, $party4Array);
                            }
                        }
                    }

                    if (!empty($val['Parties5th']['DocumentParty'])) {
                        if (count($val['Parties5th']['DocumentParty']) == 1) {
                            $partyId = $val['Parties5th']['DocumentParty']['@attributes']['Id'];
                            $party5Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                            });
                            $party5Arr = array_merge($party5Arr, $party5Array);
                        } else {
                            foreach ($val['Parties5th']['DocumentParty'] as $party5) {
                                $partyId = $party5['@attributes']['Id'];
                                $party5Array = array_filter($result['Parties']['DocumentParty'], function ($elem) use ($partyId) {
                                    return ($elem['Id'] == $partyId) ? $elem['Name'] : '';
                                });
                                $party5Arr = array_merge($party5Arr, $party5Array);
                            }
                        }
                    }

                    $parties = '';
                    if (!empty($party1Arr)) {
                        $parties .= "Party1: " . implode(" And ", array_column($party1Arr, 'Name'));
                    }
                    if (!empty($party2Arr)) {
                        $parties .= " <br> Party2: " . implode(" And ", array_column($party2Arr, 'Name'));
                    }
                    if (!empty($party3Arr)) {
                        $parties .= " <br> Party3: " . implode(" And ", array_column($party3Arr, 'Name'));
                    }
                    if (!empty($party4Arr)) {
                        $parties .= " <br> Party4: " . implode(" And ", array_column($party4Arr, 'Name'));
                    }
                    if (!empty($party5Arr)) {
                        $parties .= " <br> Party5: " . implode(" And ", array_column($party5Arr, 'Name'));
                    }

                    $id = $val['DocumentIdentification'];
                    if (isset($id['@attributes']['Id'])) {
                        $docId = $id['@attributes']['Id'];
                        $key = array_search($docId, array_column($documentIdentifications, 'Id'));
                        $filterNoticeExistKey = '';
                        $filterExistKey = '';
                        if (isset($documentIdentifications[$key]) && (!empty($documentIdentifications[$key]['InstrumentNumber']) || strtolower($val['DocumentType']) == 'tdd')) {
                            $recordArray[$i]['title_point_id'] = $titlePointId;
                            $recordArray[$i]['instrument'] = isset($documentIdentifications[$key]['InstrumentNumber']) ? $documentIdentifications[$key]['InstrumentNumber'] : null;
                            $recordArray[$i]['recorded_date'] = $documentIdentifications[$key]['RecordingDate'];
                            $recordArray[$i]['type'] = $images[$key]['Type'];
                            $recordArray[$i]['sub_type'] = $images[$key]['SubType'];
                            $recordArray[$i]['order_number'] = isset($images[$key]['OrderNumber']) ? $images[$key]['OrderNumber'] : null;
                            $recordArray[$i]['document_name'] = $val['DocumentFullName'];
                            $recordArray[$i]['document_type'] = $val['DocumentType'];
                            $recordArray[$i]['document_sub_type'] = (isset($val['DocumentSubType']) && !is_array($val['DocumentSubType'])) ? $val['DocumentSubType'] : null;
                            $recordArray[$i]['parties'] = isset($parties) ? $parties : null;
                            $recordArray[$i]['coupling'] = isset($val['CouplingIndicatorAll']) ? $val['CouplingIndicatorAll'] : null;
                            $recordArray[$i]['remarks'] = isset($val['PropertyRemark']) ? $val['PropertyRemark'] : null;
                            $recordArray[$i]['color_coding'] = isset($val['ColorCoding']) ? $val['ColorCoding'] : null;
                            $recordArray[$i]['icon_text'] = isset($val['ChainIconName']) ? $val['ChainIconName'] : null;
                            $recordArray[$i]['loan_amount'] = isset($val['LoanAmount']) ? $val['LoanAmount'] : null;
                            $recordArray[$i]['created_at'] = date("Y-m-d H:i:s");
                            $recordArray[$i]['amount'] = 0;

                            if ((in_array($val['DocumentSubType'], $getAllSubCategory) && in_array($val['DocumentSubType'], $filteredSubCateList)) || (empty($val['DocumentSubType']) && in_array($val['DocumentType'], $filteredMainCateList))) {
                                $key = array_search($val['DocumentType'], array_column($displayDocList, 'doc_type'));
                                $displaySection = $displayDocList[$key]['display_in_section'];

                                if (isset($val['DocumentSubType']) && !empty($val['DocumentSubType'])) {
                                    $keySubType = array_search($val['DocumentSubType'], array_column($displayDocList, 'doc_type'));
                                    // $displaySection = $displayDocList[$keySubType]['display_in_section'];
                                    $displaySection = $displayDocList[$keySubType]['map_in_section'] ? $displayDocList[$keySubType]['map_in_section'] : $displayDocList[$keySubType]['display_in_section'];
                                }
                                $recordArray[$i]['display_in_section'] = $displaySection;

                                if (isset($displaySection) && $displaySection == 'G') {
                                    if ($val['ColorCoding'] == 'FFFF00') {
                                        $recordArray[$i]['is_display'] = 1;
                                    } else if ($val['ColorCoding'] == 'C0C0C0') {
                                        if ($val['ChainIconName'] == 'Exx') {
                                            $recordArray[$i]['is_display'] = 1;
                                        } else {
                                            $recordArray[$i]['is_display'] = 0;
                                        }
                                    } else {
                                        $recordArray[$i]['is_display'] = 0;
                                    }
                                } else {
                                    if ($val['ColorCoding'] != 'A0A0FF') {
                                        if ($val['ColorCoding'] == 'C0C0C0') {
                                            if ($val['ChainIconName'] == 'Exx') {
                                                $recordArray[$i]['is_display'] = 1;
                                            } else {
                                                $recordArray[$i]['is_display'] = 0;
                                            }
                                        } else {
                                            $recordArray[$i]['is_display'] = 1;
                                        }
                                    } else {
                                        $recordArray[$i]['is_display'] = 0;
                                    }
                                }
                            } else {
                                $recordArray[$i]['display_in_section'] = null;
                                $recordArray[$i]['is_display'] = 0;
                            }
                            $i++;
                        }
                    }
                }
                // echo "<pre>";
                // print_r($recordArray);die;
                $this->CI->db->delete('pct_title_point_document_records', array('title_point_id' => $titlePointId));
                $this->CI->titlePointDocumentRecords->insertMultipleRecords($recordArray);
            } else {
                if (isset($resultForProperty['Item'])) {
                    $i = 1;
                    foreach ($resultForProperty['Item'] as $key => $val) {
                        if ($i == 1) {
                            $this->generateGeoDocBasedOnProperty($postData, $val['LegalInformation']['MapCode'], $val['LegalInformation']['MajorLegalName'], $val['LegalInformation']['Book'], $val['LegalInformation']['Page'], $val['LegalInformation']['Lot']);
                        }
                        $i++;
                    }
                }
            }
        }
        /** Save document records here end*/
        // $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'generate_geo_document', $request, $requestParams, $result, $orderId, $logid);

        return $response;
    }

    public function getGeoImageRequestStatus($requestId, $orderId)
    {
        $userdata = $this->CI->session->userdata('user');
        $requestParams = array(
            'userID' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'company' => '',
            'department' => '',
            'titleOfficer' => '',
            'requestId' => $requestId,
            'maxWaitSeconds' => '20',
        );

        $requestUrl = env('TP_SERVICE_ENDPOINT') . TP_GEO_REQUEST_SUMMARY_URL;
        $request = $requestUrl . http_build_query($requestParams);
        // print_r($request);
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'geo_request_summary_status', $request, $requestParams, array(), $orderId, 0);

        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        // $file = file_get_contents($request,false,$context);
        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);

        $imgResult = json_decode($response, true);

        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'geo_request_summary_status', $request, $requestParams, $imgResult, $orderId, $logid);

        $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
        $imgReturnStatus = strtolower($imgReturnStatus);
        if ($imgReturnStatus == 'success') {
            $status = isset($imgResult['Status']) && !empty($imgResult['Status']) ? $imgResult['Status'] : '';
            $status = strtolower($status);
            if ($status == 'success') {
                return $response;
            } else if ($status == 'processing') {
                if ($this->geocount <= 3) {
                    sleep(1);
                    $this->geocount = $this->geocount + 1;
                    return $this->getGeoImageRequestStatus($requestId, $orderId);
                } else {
                    $this->geocount = 0;
                    return $response;
                }

            } else {
                return $response;
            }
        } else {
            return $response;
        }
    }

    public function generateGeoDocBasedOnProperty($postData, $map_code, $major_legal_name, $book, $page, $lot)
    {
        $fileNumber = $postData['file_number'];
        $orderId = $postData['order_id'];
        $state = $postData['state'];
        $county = $postData['county'];
        $property = $postData['property'];
        $userdata = $this->CI->session->userdata('user');
        $opts = array(
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );
        $context = stream_context_create($opts);

        $requestParams = array(
            'userID' => env('TP_USERNAME'),
            'password' => env('TP_PASSWORD'),
            'serviceType' => 'TitlePoint.Geo.Property',
            'parameters' => 'Property.MapCode=' . $map_code . ';Property.MajorLegalName=' . $major_legal_name . ';Property.Lot=' . $lot . ';Property.Book=' . $book . ';Property.Page=' . $page . '; Property.IntelligentPropertyGrouping=true',
            'department' => '',
            'orderNo' => '',
            'customerRef' => '',
            'company' => '',
            'titleOfficer' => '',
            'orderComment' => '',
            'starterRemarks' => '',
            'state' => $state,
            'county' => $county,
        );
        $requestUrl = env('TP_SERVICE_ENDPOINT') . TP_GEO_CREATE_SERVICE_URL;
        $request = $requestUrl . http_build_query($requestParams);
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_geo_request', $request, $requestParams, array(), $orderId, 0);
        $response = $this->CI->order->curl_post($requestUrl, $requestParams);
        // $file = file_get_contents($request,false,$context);
        // $xmlData = simplexml_load_string($file);
        // $response = json_encode($xmlData);
        $result = json_decode($response, true);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'titlepoint', 'create_geo_request', $request, $requestParams, $result, $orderId, $logid);
        $returnStatus = isset($result['ReturnStatus']) && !empty($result['ReturnStatus']) ? $result['ReturnStatus'] : '';
        $returnStatus = strtolower($returnStatus);

        if ($returnStatus == 'success') {
            $requestId = isset($result['RequestID']) && !empty($result['RequestID']) ? $result['RequestID'] : '';
            $requestOrderId = isset($result['OrderID']) && !empty($result['OrderID']) ? $result['OrderID'] : '';
            if (isset($requestId) && !empty($requestId)) {
                $imgresponse = $this->getGeoImageRequestStatus($requestId, $orderId);
                $imgResult = json_decode($imgresponse, true);
                $imgReturnStatus = isset($imgResult['ReturnStatus']) && !empty($imgResult['ReturnStatus']) ? $imgResult['ReturnStatus'] : '';
                $status = isset($imgResult['RequestSummaries']['RequestSummary']) && !empty($imgResult['RequestSummaries']['RequestSummary']) ? $imgResult['RequestSummaries']['RequestSummary']['Status'] : '';
                $imgReturnStatus = strtolower($imgReturnStatus);
                $status = strtolower($status);

                if ($imgReturnStatus == 'success' && $status == 'complete') {
                    $requestSummary = $imgResult['RequestSummaries']['RequestSummary']['Order']['Services']['Service'];
                    $thumbnail = $requestSummary['ThumbNails']['ResultThumbNail'];
                    $serviceId = $requestSummary['ID'];
                    $resultId = $thumbnail['ID'];
                    $generateImgResponse = $this->generateGeoDocument($resultId, $orderId, $fileNumber, $postData);
                    $generateImgResult = json_decode($generateImgResponse, true);
                    $generateImgReturnStatus = isset($generateImgResult['ReturnStatus']) && !empty($generateImgResult['ReturnStatus']) ? $generateImgResult['ReturnStatus'] : '';
                    $generateImgMsg = isset($generateImgResult['Message']) && !empty($generateImgResult['Message']) ? $generateImgResult['Message'] : '';
                    $generateImgReturnStatus = strtolower($generateImgReturnStatus);

                    if ($generateImgReturnStatus == 'success') {
                        return $this->generateGeoImg($serviceId, $fileNumber, $orderId, $requestOrderId);
                    } else {
                        $error = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                        $tpData = array(
                            'geo_file_status' => $generateImgReturnStatus,
                            'geo_file_message' => $error,
                            'geo_order_id' => $resultId,
                        );
                        $condition = array(
                            'file_number' => $fileNumber,
                        );
                        $this->CI->titlePointData->update($tpData, $condition);
                    }
                } else if ($imgReturnStatus == 'success' && $status != 'success') {
                    $message = isset($imgResult['Message']) && !empty($imgResult['Message']) ? $imgResult['Message'] : '';
                    $tpData = array(
                        'geo_file_status' => $status,
                        'geo_file_message' => $message,
                        'geo_order_id' => $requestOrderId,
                    );
                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);
                } else {
                    $error = isset($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($imgResult['ReturnErrors']['ReturnError']['ErrorDescription']) ? $imgResult['ReturnErrors']['ReturnError']['ErrorDescription'] : '';
                    $tpData = array(
                        'geo_file_status' => $imgReturnStatus,
                        'geo_file_message' => $error,
                        'geo_order_id' => $requestOrderId,
                    );
                    $condition = array(
                        'file_number' => $fileNumber,
                    );
                    $this->CI->titlePointData->update($tpData, $condition);
                }
            }
        } else {
            $error = isset($result['ReturnErrors']['ReturnError']['ErrorDescription']) && !empty($result['ReturnErrors']['ReturnError']['ErrorDescription']) ? $result['ReturnErrors']['ReturnError']['ErrorDescription'] : '';
            $tpData = array(
                'geo_file_status' => $returnStatus,
                'geo_file_message' => $error,
            );
            $condition = array(
                'file_number' => $fileNumber,
            );
            $this->CI->titlePointData->update($tpData, $condition);
        }
    }
}
