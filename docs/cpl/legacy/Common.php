<?php

(defined('BASEPATH')) or exit('No direct script access allowed');

class Common extends MX_Controller
{
    private $js_version = '5.11';
 
    public function __construct()
    {
        parent::__construct();
        $this->load->helper(
            array('file', 'url', 'form')
        );
        $this->load->library('order/EscrowDashboardTemplate');
        $this->load->library('order/salesDashboardTemplate');
        $this->load->library('session');
        $this->load->library('form_validation');
        $this->load->library('order/template');
        $this->load->model('order/orderRecording');
        $this->load->library('order/order');
        $this->load->model('order/apiLogs');
        $this->load->model('order/reviewPrelimData');
        $this->load->model('order/titleOfficer');
        $this->load->model('order/home_model');
        $this->load->model('order/fees_model');
        $this->load->library('order/resware');
        $this->load->library('order/softPro');
        $this->load->library('order/common_lib');
    }

    public function prelimFiles()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/prelim_orders.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order", "review_files", $data);
    }

    public function review_file()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $userdata = $this->session->userdata('user');
        $prelimDocument = array();
        $linked_doc = array();
        // $this->load->library('order/resware');
        $this->load->model('order/document');
        $orderId = $this->uri->segment(2);
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        // echo "<pre>";
        // print_r($orderDetails);die;
        $prelimDocument = $this->order->get_prelim_document($orderDetails['order_id']);
        if ((isset($userdata['is_sales_rep']) && !empty($userdata['is_sales_rep'])) || (isset($userdata['is_title_officer']) && !empty($userdata['is_title_officer']))) {
            $linked_doc = $this->order->get_order_linked_documents($orderId, 1);
        } else {
            $linked_doc = $this->order->get_order_linked_documents($orderId);
        }
        $uploaded_docs = $this->order->get_order_uploaded_documents($orderId);

        if (isset($orderDetails['file_number']) && !empty($orderDetails['file_number'])) {
            $condition = array('file_number' => $orderDetails['file_number']);
            $summaryData['is_visited'] = 1;

            $update = $this->reviewPrelimData->update($summaryData, $condition);
        }

        $data['error'] = array();
        $data['success'] = array();

        if ($this->session->userdata('errors')) {
            $data['error'] = $this->session->userdata('errors');
            $this->session->unset_userdata('error');
        }

        if ($this->session->userdata('success')) {
            $data['success'] = $this->session->userdata('success');
            $this->session->unset_userdata('success');
        }

        $data['linked_doc'] = $linked_doc;
        $data['uploaded_docs'] = $uploaded_docs;
        $data['prelimDocument'] = $prelimDocument;
        $data['orderDetails'] = $orderDetails;
        $data['is_sales_rep'] = isset($userdata['is_sales_rep']) && !empty($userdata['is_sales_rep']) ? 1 : 0;
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/prelim_order.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->addCss(base_url('assets/css/theme.css?v=' . $this->js_version));
        $this->salesdashboardtemplate->addCss(base_url('assets/frontend/css/view-review-file.css?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order", "view_review_file", $data);
        // $this->template->addJS( base_url('assets/frontend/js/order/prelim_order.js?v='.$this->js_version));
        // $this->template->show("order", "view_review_file", $data);
    }

    public function summary()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $orderId = $this->input->post('orderId');
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        // echo "<pre>";
        // print_r($orderDetails);die;
        $policy_type = '';
        if (isset($orderDetails['product_type']) && !empty($orderDetails['product_type'])) {
            if (strpos($orderDetails['product_type'], 'Loan:') !== false) {
                $policy_type = 'ALTA 2012 Short Form Residential Loan Policy';
            } else {
                $policy_type = 'ALTA 2006 Extended Loan Policy CA';
            }
        }

        $file_number = isset($orderDetails['file_number']) && !empty($orderDetails['file_number']) ? $orderDetails['file_number'] : '';
        $address = isset($orderDetails['full_address']) && !empty($orderDetails['full_address']) ? $orderDetails['full_address'] : '';
        $property_type = isset($orderDetails['property_type']) && !empty($orderDetails['property_type']) ? $orderDetails['property_type'] : '';

        $condition = array(
            'where' => array(
                'file_number' => $file_number,
            ),
        );

        $prelim_details = $this->reviewPrelimData->get_rows($condition);

        $data = json_decode($prelim_details['chatgpt_json'], true);

        if (isset($data) && !empty($data)) {
            // $this->load->library('order/parsedown');
            $this->load->library('order/tessa');
            $parcelID = isset($data['ParcelID']) && !empty($data['ParcelID']) ? $data['ParcelID'] : '';
            $vesting = isset($data['Vesting']) && !empty($data['Vesting']) ? $data['Vesting'] : '';
            $generated_date = isset($data['CommitmentEffectiveDate']) && !empty($data['CommitmentEffectiveDate']) ? date('Y-m-d H:i:s', strtotime($data['CommitmentEffectiveDate'])) : '';
            $summaryData = array(
                'file_number' => $file_number,
                'vesting' => $vesting,
                'generated_date' => $generated_date,
                'is_updated' => $prelim_details['is_updated'],
                'lien' => isset($prelim_details['lien']) && !empty($prelim_details['lien']) ? $prelim_details['lien'] : '',
                'tax' => isset($prelim_details['tax']) && !empty($prelim_details['tax']) ? $prelim_details['tax'] : '',
                'easement' => isset($prelim_details['easement']) && !empty($prelim_details['easement']) ? $prelim_details['easement'] : '',
                'requirements' => isset($prelim_details['requirements']) && !empty($prelim_details['requirements']) ? $prelim_details['requirements'] : '',
                'restrictions' => isset($prelim_details['restrictions']) && !empty($prelim_details['restrictions']) ? $prelim_details['restrictions'] : '',
                'resware_json' => $prelim_details['resware_json'],
                'parcel_id' => $parcelID,
                'policy_type' => $policy_type,
            );
            // $chatGptRes    = json_decode($prelim_details['chatgpt_json'], true);
            // $markdown = $chatGptRes['choices'][0]['message']['content'] ?? 'No content received.';
            // $summaryData['html'] = $this->parsedown->text($markdown);
            $fileName = $file_number;
            $tessaRes    = json_decode($prelim_details['chatgpt_json'], true);
            $tessaText = $tessaRes['choices'][0]['message']['content'] ?? 'No content found.';
            $summaryData['html'] = $this->tessa->format_enhanced_analysis($tessaText, $fileName);
            // $prelim_details = $summaryData;
        } else {
            $summaryData['html'] = 'No content found.';
        }
        $prelim_details = $summaryData;

        $data['prelim_details'] = array();
        if (isset($prelim_details) && !empty($prelim_details)) {
            $data['prelim_details'] = $prelim_details;
        }
        $data['prelim_details']['address'] = $address;
        $data['prelim_details']['property_type'] = $property_type;
        
        $results = $this->load->view('order/review_file_summary', $data, true);
        echo $results; exit;
        // echo json_encode($results, true);exit;
    }

    public function getPrelimSummary()
    {
        $this->load->library('order/tessa');
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $userdata = $this->session->userdata('user');
        $fileNumber = $this->input->post('fileNumber');
        $params = [
            'order_details.file_number' => $fileNumber,
        ];
        $orderDetails = $this->order->get_order_details($params);
        $orderId = $orderDetails['order_id'];
        // $file_number = isset($orderDetails['file_number']) && !empty($orderDetails['file_number']) ? $orderDetails['file_number'] : '';
        $address = isset($orderDetails['full_address']) && !empty($orderDetails['full_address']) ? $orderDetails['full_address'] : '';
        // $property_type = isset($orderDetails['property_type']) && !empty($orderDetails['property_type']) ? $orderDetails['property_type'] : '';

        $condition = array(
            'where' => array(
                'file_number' => $fileNumber,
            ),
        );

        $prelim_details = $this->reviewPrelimData->get_rows($condition);

        $data = json_decode($prelim_details['chatgpt_json'], true);
        // $this->load->library('order/parsedown');
        $getPrelimDocument = $this->order->get_prelim_document($orderId);
        if (empty($getPrelimDocument)) {
            echo json_encode(['status' => 'error', 'message' => 'Prelim document not found.']);exit;
            return "Prelim Document not found.";
        }
        $fileName = $getPrelimDocument['document_name'];
        // $filePath = env('AWS_PATH') .  'https://pct-doc.s3-us-west-2.amazonaws.com/documents/' . $fileName;
        $filePath = env('AWS_PATH') .  'documents/' . $fileName;
        $summaryExist = 0;
        if (isset($prelim_details['chatgpt_json']) && !empty($prelim_details['chatgpt_json']) && ($prelim_details['is_tessa'] == 1) && isset($data['choices'])) {
        // if (isset($data) && !empty($data)) {
        // if (false) {
            $summaryExist = 1;
            $parcelID = isset($data['ParcelID']) && !empty($data['ParcelID']) ? $data['ParcelID'] : '';
            $vesting = isset($data['Vesting']) && !empty($data['Vesting']) ? $data['Vesting'] : '';
            $generated_date = isset($data['CommitmentEffectiveDate']) && !empty($data['CommitmentEffectiveDate']) ? date('Y-m-d H:i:s', strtotime($data['CommitmentEffectiveDate'])) : '';
            $summaryData = array(
                'file_number' => $fileNumber,
                'resware_json' => $prelim_details['resware_json'],
            );
            $tessaRes    = json_decode($prelim_details['chatgpt_json'], true);
            
            // if (isset($tessaRes['choices'])) {
                $tessaText = $tessaRes['choices'][0]['message']['content'] ?? 'No content found.';
                // $tessaSummaryHtml = $summaryData['html'] = $this->parsedown->text($markdown);
                $summaryData['html'] = $tessaSummaryHtml = $this->tessa->format_enhanced_analysis($tessaText, $fileName);
            // } else {
            //     $tessaSummaryHtml = $this->tessa->format_enhanced_analysis($prelim_details['chatgpt_json'], $fileName);
            //     $summaryData['html'] = $tessaSummaryHtml;
            // }
        } else {
            // echo "else";die;
            // echo "<pre>";
            // print_r($getPrelimDocument);die;
            // $this->load->model('order/tessa_model');
            // $filePath = 'https://pct-doc.s3-us-west-2.amazonaws.com/documents/1760559435_prelim_doc_20009285-OCT.pdf';
            // $fileName = "1760559435_prelim_doc_20009285-OCT.pdf";
            // $summaryHtml = $this->tessa->analyze_pdf_with_tessa($filePath, $fileName);
            // $file_path = "https://pct-doc.s3-us-west-2.amazonaws.com/documents/1757111998_prelim_doc_20007334-GLT.pdf";
            // $pdf_text = $this->tessa_model->process_pdf($file_path);
            // print_r($summaryHtml);
            // echo "<br><br>";die;
            // $apiEndPoints = SOFTPRO_API_END;
            // $req['orderNumber'] = $fileNumber;
            
            // $queryParams = http_build_query($req);
            // $reqData     = json_encode($req);
            // $reqUrl  = getenv("SOFT_PRO_API") . $apiEndPoints['get_prelim_summary'] . '?'.$queryParams;
            
            // $logid = $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'get_prelim_summary', $reqUrl, $reqData, [], 0, 0);
            // $response    = $this->softpro->make_request('GET', 'get_prelim_summary', $reqData, $queryParams);
            // $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'get_prelim_summary', 'get_prelim_summary', $reqData, json_encode($response), 0, $logid);
            
            // echo "<pre>";
            // if (!empty($response) && $response['status'] == 'success') {
            //     $prelimSummaryJson = $response['data'];
                //  $pdf_text = $prelimSummaryJson;
                // Compute facts from PDF text
                // $facts = $this->tessa_model->compute_facts(json_encode($pdf_text));
                // echo "<pre>";
                // print_r($facts);die;
                // // Store in session for potential further use
                // $this->session->set_userdata('last_computed_facts', $facts);
                
                // // Generate analysis
                // print_r($facts);echo "<br><br>";
                // print_r($file_path);echo "<br><br>";
                // print_r($pdf_text);die;
                // $analysis = $this->generate_analysis($pdf_text, $upload_data['file_name'], $facts);
                
                // echo $analysis;
                // echo "<pre>";
                // print_r($prelimSummaryJson);die;
                // $prelimData = array(
                //     'resware_json' => json_encode($prelimSummaryJson)
                // );
                $condition = [
                    // 'file_number' => '20001146-GLT' //$response['OrderNumber'],
                    'file_number' => $fileNumber,
                ];
                // $this->db->set($prelimData);
                // $this->db->where($condition);
                // $this->db->update('pct_order_prelim_summary');
                
                // $chatGptJsonRes = $this->order->getPrelimAISummary($pdf_text, $prelimSummaryJson);
                $tessaJsonRes = $this->tessa->analyze_pdf_with_tessa($filePath, $fileName);
                $tessaRes    = json_decode($tessaJsonRes, true);
                $prelimData = array(
                    'chatgpt_json' => $tessaJsonRes,
                    'is_tessa' => 1
                );
                $this->db->set($prelimData);
                $this->db->where($condition);
                $this->db->update('pct_order_prelim_summary');
                $tessaText = $tessaRes['choices'][0]['message']['content'] ?? 'No content found.';
                // $summaryData['html'] = $this->parsedown->text($markdown);
                
                $tessaSummaryHtml = $this->tessa->format_enhanced_analysis($tessaText, $fileName);
                $summaryData['html'] = $tessaSummaryHtml;


                $configData                  = $this->order->getConfigData();
                $prelimSummaryEmailFlag = $configData['enable_prelim_summary_email']['is_enable'];
                $prelimSummaryShutOffFlag = $configData['prelim_summary_shut_off']['is_enable'];
                if ($prelimSummaryEmailFlag == 1 && $summaryExist == 0) {
                    // $emailData['html'] = $this->parsedown->text($markdown);
                    $emailData['html'] = $tessaSummaryHtml;
                    $emailData['file_number'] = $fileNumber;
                    $message = $this->load->view('emails/prelim_summary.php', $emailData, true);
                    $from_name = 'Pacific Coast Title Company';
                    $from_mail = env('FROM_EMAIL');
                    $to = 'ghernandez@pct.com';
                    $subject = 'Prelim Summary : '. $fileNumber;
                    $cc = ['piyush.j@crestinfosystems.com'];
                    $mailParams = array(
                        'from_mail' => $from_mail,
                        'from_name' => $from_name,
                        'to' => $to,
                        'subject' => $subject,
                        'message' => $fileNumber,
                        'cc' => $cc,
                    );
                    $this->load->helper('sendemail');
                    $logid = $this->apiLogs->syncLogs(0, 'sendgrid', 'send_mail_for_prelim_summary', '', $mailParams, array(), 0, 0);
                    $mail_result = send_email($from_mail, $from_name, $to, $subject, $message, [], $cc, []);
                    $this->apiLogs->syncLogs(0, 'sendgrid', 'send_mail_for_prelim_summary', '', $mailParams, array('status' => $mail_result), 0, $logid);
                } else {
                    $res = "Prelim Summary Email is disabled by Admin.";
                    $this->apiLogs->syncLogs(0, 'sendgrid', 'send_mail_for_prelim_summary', 'send_mail_for_prelim_summary', null, $res, 0, 0);
                }
            // } else {
            //     $markdown = 'No content found.';
            //     $summaryData['html'] = 'No content found.';
            // }

        }
        $prelim_details = $summaryData;

        $data['prelim_details'] = array();
        if (isset($prelim_details) && !empty($prelim_details)) {
            $data['prelim_details'] = $prelim_details;
        }
        $data['prelim_details']['address'] = $address;
        $data['prelim_details']['file_number'] = $fileNumber;
        
        

        $results['summary_view'] = $this->load->view('order/ai_prelim_summary', $data, true);
        $results['file_number'] = $fileNumber;
        $results['address'] = $address;
        // echo json_encode($results);
        echo json_encode($results, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_IGNORE);
    }

    public function regeneratePrelimSummary()
    {
        $userdata = $this->session->userdata('user');
        $fileNumber = $this->input->post('fileNumber');
        $params = [
            'order_details.file_number' => $fileNumber,
        ];
        $orderDetails = $this->order->get_order_details($params);
        
        $address = isset($orderDetails['full_address']) && !empty($orderDetails['full_address']) ? $orderDetails['full_address'] : '';
        
        $condition = array(
            'where' => array(
                'file_number' => $fileNumber,
            ),
        );

        // $prelim_details = $this->reviewPrelimData->get_rows($condition);

        // $data = json_decode($prelim_details['chatgpt_json'], true);

        // $this->load->library('order/parsedown');
        // if (isset($data) && !empty($data)) {
        //     $parcelID = isset($data['ParcelID']) && !empty($data['ParcelID']) ? $data['ParcelID'] : '';
        //     $vesting = isset($data['Vesting']) && !empty($data['Vesting']) ? $data['Vesting'] : '';
        //     $generated_date = isset($data['CommitmentEffectiveDate']) && !empty($data['CommitmentEffectiveDate']) ? date('Y-m-d H:i:s', strtotime($data['CommitmentEffectiveDate'])) : '';
        //     $summaryData = array(
        //         'file_number' => $fileNumber,
        //         'resware_json' => $prelim_details['resware_json'],
        //     );
        //     $chatGptRes    = json_decode($prelim_details['chatgpt_json'], true);
        //     $markdown = $chatGptRes['choices'][0]['message']['content'] ?? 'No content found.';
        //     $summaryData['html'] = $this->parsedown->text($markdown);
        // } else {
            $apiEndPoints = SOFTPRO_API_END;
            $req['orderNumber'] = $fileNumber;
            
            $queryParams = http_build_query($req);
            $reqData     = json_encode($req);
            $reqUrl  = getenv("SOFT_PRO_API") . $apiEndPoints['get_prelim_summary'] . '?'.$queryParams;
            
            $logid = $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'get_prelim_summary', $reqUrl, $reqData, [], 0, 0);
            $response    = $this->softpro->make_request('GET', 'get_prelim_summary', $reqData, $queryParams);
            $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'get_prelim_summary', 'get_prelim_summary', $reqData, json_encode($response), 0, $logid);
            
            // echo "<pre>";
        if (!empty($response) && $response['status'] == 'success') {
            $prelimSummaryJson = $response['data'];
            // print_r($prelimSummaryJson);die;
            $prelimData = array(
                'resware_json' => json_encode($prelimSummaryJson)
            );
            $condition = [
                // 'file_number' => '20001146-GLT' //$response['OrderNumber'],
                'file_number' => $fileNumber,
            ];
            $this->db->set($prelimData);
            $this->db->where($condition);
            $this->db->update('pct_order_prelim_summary');

            // $chatGptJsonRes = $this->order->getPrelimAISummary($prelimSummaryJson);
            
            // $chatGptRes    = json_decode($chatGptJsonRes, true);
            // $prelimData = array(
            //     'chatgpt_json' => $chatGptJsonRes
            // );
            
            $orderId = $orderDetails['order_id'];
            $getPrelimDocument = $this->order->get_prelim_document($orderId);
            if (empty($getPrelimDocument)) {
                $res = "Prelim document not found.";
                $this->apiLogs->syncLogs(0, 'softpro', 'received_prelim_summary', 'received_prelim_summary', $reqData, $res, 0, $logid);
                echo $res; exit;
            }
            $fileName = $getPrelimDocument['document_name'];
            // $filePath = 'https://pct-doc.s3-us-west-2.amazonaws.com/documents/' . $fileName;
            $filePath = env('AWS_PATH') .  'documents/' . $fileName;

            $this->load->library('order/tessa');
            $tessaJsonRes = $this->tessa->analyze_pdf_with_tessa($filePath, $fileName);
            $tessaRes    = json_decode($tessaJsonRes, true);
            $prelimData = array(
                'chatgpt_json' => $tessaJsonRes,
                'is_tessa' => 1
            );

            $condition = [
                // 'file_number' => '20001146-GLT'
                'file_number' => $fileNumber,
            ];
            $this->db->set($prelimData);
            $this->db->where($condition);
            $this->db->update('pct_order_prelim_summary');

            // $markdown = $chatGptRes['choices'][0]['message']['content'] ?? 'No content found.';
            // $summaryData['html'] = $this->parsedown->text($markdown);
            $tessaText = $tessaRes['choices'][0]['message']['content'] ?? 'No content found.';
            $summaryData['html'] = $this->tessa->format_enhanced_analysis($tessaText, $fileName);

            $configData                  = $this->order->getConfigData();
            $prelimSummaryEmailFlag = $configData['enable_prelim_summary_email']['is_enable'];
            $prelimSummaryShutOffFlag = $configData['prelim_summary_shut_off']['is_enable'];

            if ($prelimSummaryEmailFlag == 1) {
                $emailData['html'] = $summaryData['html'];
                $emailData['file_number'] = $fileNumber;
                $message = $this->load->view('emails/prelim_summary.php', $emailData, true);
                $from_name = 'Pacific Coast Title Company';
                $from_mail = env('FROM_EMAIL');
                $to = 'ghernandez@pct.com';
                $subject = 'Prelim Summary : '. $response['OrderNumber'];
                $cc = ['piyush-crest@yopmail.com', 'piyush.j@crestinfosystems.com'];
                $mailParams = array(
                    'from_mail' => $from_mail,
                    'from_name' => $from_name,
                    'to' => $to,
                    'subject' => $subject,
                    'message' => $response['OrderNumber'],
                    'cc' => $cc,
                );
                $this->load->helper('sendemail');
                $logid = $this->apiLogs->syncLogs(0, 'sendgrid', 'send_mail_for_prelim_summary', '', $mailParams, array(), 0, 0);
                $mail_result = send_email($from_mail, $from_name, $to, $subject, $message, [], $cc, []);
                $this->apiLogs->syncLogs(0, 'sendgrid', 'send_mail_for_prelim_summary', '', $mailParams, array('status' => $mail_result), 0, $logid);
            } else {
                $res = "Prelim Summary Email is disabled by Admin.";
                $this->apiLogs->syncLogs(0, 'sendgrid', 'send_mail_for_prelim_summary', 'send_mail_for_prelim_summary', $reqData, $res, 0, $logid);
            }
        } else {
            $summaryData['html'] = 'No content found.';
        }

        // }
        $prelim_details = $summaryData;

        $data['prelim_details'] = array();
        if (isset($prelim_details) && !empty($prelim_details)) {
            $data['prelim_details'] = $prelim_details;
        }
        $data['prelim_details']['address'] = $address;
        $data['prelim_details']['file_number'] = $fileNumber;
        
        $results['summary_view'] = $this->load->view('order/ai_prelim_summary', $data, true);
        $results['file_number'] = $fileNumber;
        $results['address'] = $address;
        echo json_encode($results);
    }

    public function load_doc()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $this->load->model('order/document');
        // $this->load->library('order/resware');
        $this->load->model('order/apiLogs');
        $userdata = $this->session->userdata('user');
        // $resware_document_id = $this->input->post('resware_document_id');
        $order_id = $this->input->post('order_id');
        $document_id = $this->input->post('document_id');
        $documentDetail = $this->order->get_document_detail($order_id, $document_id);
        $is_sync = $this->input->post('is_sync');

        if ($userdata['is_title_officer'] == 1 || $userdata['is_sales_rep'] == 1 || $userdata['is_master'] == 1) {
            $user_data['admin_api'] = 1;
        } else {
            $user_data = array();
        }

        // if ($is_sync == 0) {
        //     $endPoint = 'documents/' . $resware_document_id . '?format=json';
        //     $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), array(), $order_id, 0);
        //     $resultDocument = $this->resware->make_request('GET', $endPoint, '', $user_data);
        //     $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), $resultDocument, $order_id, $logid);
        //     $resDocument = json_decode($resultDocument, true);
        //     if (isset($resDocument['Document']) && !empty($resDocument['Document'])) {
        //         $documentContent = base64_decode($resDocument['Document']['DocumentBody'], true);
        //         if (!is_dir('uploads/documents')) {
        //             mkdir('./uploads/documents', 0777, true);
        //         }
        //         file_put_contents('./uploads/documents/' . $documentDetail['document_name'], $documentContent);
        //         $this->order->uploadDocumentOnAwsS3($documentDetail['document_name'], 'documents');
        //         $this->document->update(array('is_sync' => 1), array('api_document_id' => $resware_document_id));
        //     }
        // }

        // $data['api_document_id'] = $resware_document_id;
        $data['order_id'] = $order_id;
        $data['document_name'] = $documentDetail['document_name'];
        if ($documentDetail['is_grant_doc'] == 1) {
            if (env('AWS_ENABLE_FLAG') == 1) {
                $data['url'] = env('AWS_PATH') . "grant-deed/" . $documentDetail['document_name'];
            } else {
                $data['url'] = base_url() . 'uploads/grant-deed/' . $documentDetail['document_name'];
            }
        } else if ($documentDetail['is_proposed_insured_doc'] == 1) {
            if (env('AWS_ENABLE_FLAG') == 1) {
                $data['url'] = env('AWS_PATH') . "proposed-insured/" . $documentDetail['document_name'];
            } else {
                $data['url'] = base_url() . 'uploads/proposed-insured/' . $documentDetail['document_name'];
            }
        } else {
            if (env('AWS_ENABLE_FLAG') == 1) {
                $data['url'] = env('AWS_PATH') . "documents/" . $documentDetail['document_name'];
            } else {
                $data['url'] = base_url() . 'uploads/documents/' . $documentDetail['document_name'];
            }
        }
        if ($documentDetail['is_prelim_document'] == 1) {
            $data['prelim_flag'] = 1;
            $data['doc_document_name'] = str_replace("pdf", "docx", $documentDetail['document_name']);
        } else {
            $data['prelim_flag'] = 0;
            $data['doc_document_name'] = '';
        }

        $results = $this->load->view('order/review_file_load_doc', $data, true);
        echo json_encode($results, true);
    }

    public function logout()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $this->session->sess_destroy();
        $this->session->unset_userdata('user');
        redirect(base_url() . 'order');
    }

    public function legal_vesting()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $orderId = $this->input->post('orderId');
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);

        $file_number = isset($orderDetails['file_number']) && !empty($orderDetails['file_number']) ? $orderDetails['file_number'] : '';
        if (env('AWS_ENABLE_FLAG') == 1) {
            $file_path = env('AWS_PATH') . "legal-vesting/" . $file_number . '.pdf';
        } else {
            $file_path = FCPATH . 'uploads/legal-vesting/' . $file_number . '.pdf';
        }

        $file_url = '';

        if (file_exists($file_path)) {
            if (env('AWS_ENABLE_FLAG') == 1) {
                $file_url = env('AWS_PATH') . "legal-vesting/" . $file_number . '.pdf';
            } else {
                $file_url = base_url() . 'uploads/legal-vesting/' . $file_number . '.pdf';
            }
        } else {
            $this->load->model('order/titlePointData');
            // $file_id = isset($orderDetails['file_id']) && !empty($orderDetails['file_id']) ? $orderDetails['file_id'] : '';

            $condition = array(
                'where' => array(
                    'file_number' => $file_number,
                ),
            );
            $titlePointDetails = $this->titlePointData->gettitlePointDetails($condition);

            $serviceId = isset($titlePointDetails[0]['cs4_service_id']) && !empty($titlePointDetails[0]['cs4_service_id']) ? $titlePointDetails[0]['cs4_service_id'] : '';
        }

        $data['file_url'] = $file_url;
        $data['file_number'] = $file_number;
        $data['serviceId'] = $serviceId;

        $results = $this->load->view('order/review_file_legal_vesting', $data, true);
        echo json_encode($results, true);
    }

    public function plat_map()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $orderId = $this->input->post('orderId');
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);

        $file_number = isset($orderDetails['file_number']) && !empty($orderDetails['file_number']) ? $orderDetails['file_number'] : '';
        if (env('AWS_ENABLE_FLAG') == 1) {
            $file_path = env('AWS_PATH') . "plat-map/" . $file_number . '.pdf';
        } else {
            $file_path = FCPATH . 'uploads/plat-map/' . $file_number . '.pdf';
        }

        $file_url = '';

        if (file_exists($file_path)) {
            if (env('AWS_ENABLE_FLAG') == 1) {
                $file_url = env('AWS_PATH') . "plat-map/" . $file_number . '.pdf';
            } else {
                $file_url = base_url() . 'uploads/plat-map/' . $file_number . '.pdf';
            }
        } else {
            $address = isset($orderDetails['address']) && !empty($orderDetails['address']) ? $orderDetails['address'] : '';

            $locale = isset($orderDetails['property_city']) && !empty($orderDetails['property_city']) ? $orderDetails['property_city'] : '';

            $propertyState = isset($orderDetails['property_state']) && !empty($orderDetails['property_state']) ? $orderDetails['property_state'] : '';

            $PropertyZip = isset($orderDetails['property_zip']) && !empty($orderDetails['property_zip']) ? $orderDetails['property_zip'] : '';

            if (($locale)) {
                if (!empty($propertyState)) {
                    $locale .= ', ' . $propertyState;
                } else {
                    $locale .= ', CA';
                }
            }

            $data['address'] = $address;
            $data['locale'] = $locale;
            $data['zip'] = $PropertyZip;
        }

        $data['file_url'] = $file_url;
        $data['file_number'] = $file_number;

        $results = $this->load->view('order/review_file_plat_map', $data, true);
        echo json_encode($results, true);
    }

    /*public function download_document()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $userdata = $this->session->userdata('user');
        $resware_document_id = $this->input->post('resware_document_id');
        $order_id = $this->input->post('order_id');
        $document_name = $this->input->post('document_name');
        $prelimSyncFlag = 0;
        if (env('AWS_ENABLE_FLAG') == 1) {
            $contents = file_get_contents(env('AWS_PATH') . "documents/" . $document_name);
            if (empty($contents)) {
                $prelim_doc_name = str_replace("docx", "pdf", $document_name);
                $pdfContents = file_get_contents($prelim_doc_name);
                if (empty($pdfContents)) {
                    $user_data = array(
                        'admin_api' => 1,
                    );
                    $endPoint = 'documents/' . $resware_document_id . '?format=json';
                    $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), array(), 0, 0);
                    $resultDocument = $this->resware->make_request('GET', $endPoint, '', $user_data);
                    $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), $resultDocument, 0, $logid);
                    $resDocument = json_decode($resultDocument, true);
                    if (isset($resDocument['Document']) && !empty($resDocument['Document'])) {
                        $pdfContents = base64_decode($resDocument['Document']['DocumentBody'], true);
                    }
                    $prelimSyncFlag = 1;
                }
                if (!is_dir('uploads/documents')) {
                    mkdir(FCPATH . '/uploads/documents', 0777, true);
                }
                file_put_contents(FCPATH . '/uploads/documents/' . $prelim_doc_name, $pdfContents);
                $source_pdf = FCPATH . '/uploads/documents/' . $prelim_doc_name;
                $wordsApi = new \Aspose\Words\WordsApi(getenv('PDF_TO_DOC_CLIENT_ID'), getenv('PDF_TO_DOC_SECRET_KEY'));
                $format = "docx";
                $file = $source_pdf;
                $doc_file_name = str_replace('pdf', 'docx', $document_name);
                $dest_doc = FCPATH . '/uploads/documents/' . $doc_file_name;
                $request = new Aspose\Words\Model\Requests\ConvertDocumentRequest($file, $format, null);
                $result = $wordsApi->ConvertDocument($request);
                copy($result->getPathName(), $dest_doc);
                
                // $contents = file_get_contents(FCPATH.'/uploads/documents/'.$doc_file_name);
                
                $contents = file_get_contents(FCPATH . '/uploads/documents/' . $document_name);
                // $contents = file_get_contents(base_url().'uploads/documents/'.$document_name);
                $this->order->uploadPrelimDocxDocToResware($doc_file_name, $order_id, base64_encode($pdfContents), $this->input->post('fileId'));
                $this->order->uploadDocumentOnAwsS3($doc_file_name, 'documents');
                if ($prelimSyncFlag == 1) {
                    $this->order->uploadDocumentOnAwsS3($prelim_doc_name, 'documents');
                }
            }
        } else {
            $contents = file_get_contents(base_url() . 'uploads/documents/' . $document_name);
        }

        $binaryData = base64_encode($contents);
        echo $binaryData;
    }*/

    /*public function upload_document()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $userdata = $this->session->userdata('user');
        $resware_document_id = $this->input->post('resware_document_id');
        $order_id = $this->input->post('order_id');
        $document_name = $this->input->post('document_name');
        $prelimSyncFlag = 0;
        if (env('AWS_ENABLE_FLAG') == 1) {
            $contents = file_get_contents(env('AWS_PATH') . "documents/" . $document_name);
            if (empty($contents)) {
                $prelim_doc_name = str_replace("docx", "pdf", $document_name);
                $pdfContents = file_get_contents($prelim_doc_name);
                if (empty($pdfContents)) {
                    $user_data = array(
                        'admin_api' => 1,
                    );
                    $endPoint = 'documents/' . $resware_document_id . '?format=json';
                    $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), array(), 0, 0);
                    $resultDocument = $this->resware->make_request('GET', $endPoint, '', $user_data);
                    $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), $resultDocument, 0, $logid);
                    $resDocument = json_decode($resultDocument, true);
                    if (isset($resDocument['Document']) && !empty($resDocument['Document'])) {
                        $pdfContents = base64_decode($resDocument['Document']['DocumentBody'], true);
                    }
                    $prelimSyncFlag = 1;
                }
                if (!is_dir('uploads/documents')) {
                    mkdir(FCPATH . '/uploads/documents', 0777, true);
                }
                file_put_contents(FCPATH . '/uploads/documents/' . $prelim_doc_name, $pdfContents);
                $source_pdf = FCPATH . '/uploads/documents/' . $prelim_doc_name;
                $wordsApi = new \Aspose\Words\WordsApi(getenv('PDF_TO_DOC_CLIENT_ID'), getenv('PDF_TO_DOC_SECRET_KEY'));
                $format = "docx";
                $file = $source_pdf;
                $doc_file_name = str_replace('pdf', 'docx', $document_name);
                $dest_doc = FCPATH . '/uploads/documents/' . $document_name;
                $request = new Aspose\Words\Model\Requests\ConvertDocumentRequest($file, $format, null);
                $result = $wordsApi->ConvertDocument($request);
                copy($result->getPathName(), $dest_doc);
                $contents = file_get_contents(base_url() . 'uploads/documents/' . $document_name);
                $this->order->uploadPrelimDocxDocToResware($doc_file_name, $order_id, base64_encode($pdfContents), $this->input->post('fileId'));
                $this->order->uploadDocumentOnAwsS3($doc_file_name, 'documents');
                if ($prelimSyncFlag == 1) {
                    $this->order->uploadDocumentOnAwsS3($prelim_doc_name, 'documents');
                }
            }
        } else {
            $contents = file_get_contents(base_url() . 'uploads/documents/' . $document_name);
        }
        $res = array('status' => 'success', 'msg' => "Prelim document uploaded successfully on Resware side.");
        echo json_encode($res);exit;
    }*/

    public function generate_plat_map()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $response = array();
        $imagedata = isset($_POST['imagedata']) && !empty($_POST['imagedata']) ? $_POST['imagedata'] : '';
        $file_number = isset($_POST['file_number']) && !empty($_POST['file_number']) ? $_POST['file_number'] : '';
        if ($imagedata) {
            if (!is_dir('uploads/plat-map')) {
                mkdir('./uploads/plat-map', 0777, true);
            }
            $path = './uploads/plat-map/' . $file_number . '.png';

            file_put_contents($path, base64_decode($imagedata, true));
            if (env('AWS_ENABLE_FLAG') == 1) {
                $plat_map_url = env('AWS_PATH') . "plat-map/" . $file_number . '.png';
            } else {
                $plat_map_url = base_url() . 'uploads/plat-map/' . $file_number . '.png';
            }

            $this->order->uploadDocumentOnAwsS3($file_number . '.png', 'plat-map');
            $response = array('status' => 'success', 'plat_map_url' => $plat_map_url);
        } else {
            $response = array('status' => 'error');
        }
        echo json_encode($response);exit;
    }

    public function getSearchResults()
    {
        $userdata = $this->session->userdata('user');
        ini_set('max_execution_time', 300);
        $request = $_GET['requrl'];
        $api_key = env('BLACK_KNIGHT_KEY');
        $request .= '&key=' . $api_key;
        $query_string = parse_url($request, PHP_URL_QUERY);
        parse_str($query_string, $requestParams);
        $getsortedresults = isset($_GET['getsortedresults']) ? $_GET['getsortedresults'] : 'false';
        $opts = array(
            'http' => array(
                'header' => "User-Agent:MyAgent/1.0\r\n",
            ),
            "ssl" => array(
                "verify_peer" => false,
                "verify_peer_name" => false,
            ),
        );
        $context = stream_context_create($opts);
        $this->load->model('order/apiLogs');
        $logid = $this->apiLogs->syncLogs($userdata['id'], 'black knight', 'address_search', $request, $requestParams, array(), 0, 0);
        $file = file_get_contents($request, false, $context);
        $xmlData = simplexml_load_string($file);
        $response = json_encode($xmlData);
        $result = json_decode($response, true);

        $this->apiLogs->syncLogs($userdata['id'], 'black knight', 'address_search', $request, array(), $result, 0, $logid);
        echo trim($file);
    }

    public function updatePrelimAction()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $userdata = $this->session->userdata('user');
        $this->load->model('order/note');
        $this->load->model('order/document');
        $orderId = $this->uri->segment(2);
        // print_r($orderId);die;
        
        $error = '';
        $success = '';

        $config['upload_path'] = './uploads/prelim-upload-doc/';
        $config['allowed_types'] = 'pdf';
        $config['max_size'] = 12000;
        $this->load->library('upload', $config);
        $path = FCPATH . 'uploads/prelim-upload-doc';
        if (!is_dir($path)) {
            mkdir('./uploads/prelim-upload-doc', 0777, true);
        }

        if (!empty($_FILES['file_upload']['name'])) {
            // if (false) {
            if (!$this->upload->do_upload('file_upload')) {
                $errorMsg = $this->upload->display_errors();
                $this->session->set_userdata('error', $errorMsg);
                $file_upload_error_msg = 1;
            } else {
                
                $subject = isset($_POST['note_subject']) && !empty($_POST['note_subject']) ? $_POST['note_subject'] : '';
                $body = isset($_POST['note']) && !empty($_POST['note']) ? $_POST['note'] : '';
                $params = [
                    'order_details.id' => $orderId,
                ];
                $orderDetails = $this->order->get_order_details($params);
                

                $endPoint = 'add_note';
                // $notes['Subject'] = $subject;
                $orderDetails['note_subject'] = $subject;
                $notes['Text'] = $orderDetails['note_text'] = $body;
                $notes['OrderNumber'] = $orderNumber = $orderDetails['file_number'];
                $notesReq[] = $notes;
                $reqData = json_encode($notesReq);
                $user_data = array();
                $softproEndPoint = getSoftproAPIUrl($endPoint);

                $logid = $this->apiLogs->syncLogs($userdata['id'], 'softpro', $endPoint, $softproEndPoint, $reqData, array(), $orderId, 0);
                $result = $this->softpro->make_request('POST', $endPoint, $reqData);
                $this->apiLogs->syncLogs($userdata['id'], 'softpro', $endPoint, $softproEndPoint, $reqData, $result, $orderId, $logid);
                $response      = json_decode($result, true);
                
                $softproLog = [
                    'request_type' => 'add_note_in_softpro',
                    'request_url'  => 'add_note',
                    'request'      => $reqData,
                    'response'     => json_encode($response),
                    'status'       => 'success', // $response['status'],
                    'file_number'  => $orderNumber,
                    'created_at'   => date("Y-m-d H:i:s"),
                ];
                $this->db->insert('pct_resware_log', $softproLog);

                if (isset($response) && ! empty($response)) {

                    if (isset($response[0]['status']) && $response[0]['status'] != 200) {
                        $message = isset($response[0]['Message']) && !empty($response[0]['Message']) ? $response[0]['Message'] : '';
                        $errors[] = $message;
                    } else {
                        $this->order->updateTaskStatus('update_prelim', $orderNumber);
                        $taskIds = SOFTPRO_TASK_ID;
                        $taskId = $taskIds['update_prelim'];
                        $notesData = array(
                            'is_softpro_notes' => 1,
                            'is_sync' => 0,
                            'subject' => $subject,
                            'note' => $body,
                            'user_id' => $userdata['id'],
                            'order_id' => $orderId,
                            'task_type' => $taskId,
                            'task_id' => $taskId,
                        );
                        $note_id = $this->note->insert($notesData);

                        if ($note_id) {
                            $success .= 'Note added successfully.';
                        } else {
                            $errors[]= 'Something went wrong. Please try again.';
                        }
                    }
                }
                

                $data = $this->upload->data();
                $contents = file_get_contents($data['full_path']);
                $binaryData = base64_encode($contents);
                $document_name = date('YmdHis') . "_" . $data['file_name'];
                rename(FCPATH . "/uploads/prelim-upload-doc/" . $data['file_name'], FCPATH . "/uploads/prelim-upload-doc/" . $document_name);
                $documentData = array(
                    'document_name' => $document_name,
                    'original_document_name' => $data['file_name'],
                    'document_type_id' => 1032,
                    'document_size' => ($data['file_size'] * 1000),
                    'user_id' => $userdata['id'],
                    'order_id' => $orderId,
                    'task_id' => 0,
                    'description' => 'Prelim Upload Document',
                    'is_sync' => 0,
                    'is_prelim_document' => 1,
                );

                $this->order->uploadDocumentOnAwsS3($document_name, 'prelim-upload-doc');
                $documentIds[] = $this->document->insert($documentData);

                $uploadFileToSoftPro[] = [
                    "FolderName" => 'prelim',
                    "FileURL"    => env('AWS_PATH') . "prelim-upload-doc/" . $document_name,
                ];
                $orderDetails['file_link'] = env('AWS_PATH') . "prelim-upload-doc/" . $document_name;
                $logData = [
                    'order_number' => $orderNumber,
                    'document_name' => $document_name,
                    'file_list' => json_encode($uploadFileToSoftPro),
                    "document_ids" => json_encode($documentIds)
                ];
                
                $fileUploadLogId = $this->order->save_sp_file_upload_log($logData);

                $fileData = [
                    "Id" => $fileUploadLogId,
                    "OrderNumber"  => $orderNumber,
                    "DocumentName" => $document_name,
                    "FileList"     => $uploadFileToSoftPro,
                ];
                $fileUploadReq[] = $fileData;
                $reqData = json_encode($fileUploadReq);
                // print_r($reqData);
                $logid = $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'upload_document', getSoftproAPIUrl('upload_document'), $reqData, [], 0, 0);
                $result = $this->softpro->make_request('POST', 'upload_document', $reqData);
                $response = json_decode($result, true);
                $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'upload_document', getSoftproAPIUrl('upload_document'), $reqData, json_encode($response), 0, $logid);

                if (isset($response) && !empty($response)) {
                    foreach ($response as $key => $res) {
                        if ($res['Status'] == 200) {
                            $updateData[] = [
                                'is_synced' => 1,
                                'id' => $res['Id']
                            ];
                            $this->db->where_in('id', $documentIds);
                            $this->db->update('pct_order_documents', ['is_sync' => 1]);

                            /** Send email to Ruby for prelim action update */
                        $this->order->sendPrelimUpdateEmail($orderDetails);
                        }
                    }
                }

                foreach ($updateData as $key => $update_row) {
                    $this->db->where('id', $update_row['id']);
                    $this->db->update('sp_file_upload_logs', $update_row);
                }

                /* Start upload softpro api logs */
                $softproLog = [
                    'request_type' => 'upload_file_in_softpro',
                    'request_url'  => 'upload_file',
                    'request'      => $reqData,
                    'response'     => $result,
                    'status'       => 'success',//$response['status'],
                    'file_number'  => $orderNumber,
                    'created_at'   => date("Y-m-d H:i:s"),
                ];
                $this->db->insert('pct_resware_log', $softproLog);
                /* End upload softpro api logs */

                $data = array(
                    "error" => $errors,
                    "success" => $success,
                );
                $this->session->set_flashdata($data);
                // print_r($this->session->flashdata('success'));
                // print_r($data);exit;
            }
        }
        // redirect(base_url() . 'review-file/' . $orderId);
        redirect($_SERVER['HTTP_REFERER']);
        // redirect(base_url() . 'prelim-files');
    }

    /*public function get_partners()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $fileId = $this->input->post('fileId');
        
        if ($fileId) {
            $userdata = $this->session->userdata('user');
            $orderDetails = $this->order->get_order_details($fileId);
            $endPoint = 'files/' . $fileId . '/partners';
            $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_partners', env('RESWARE_ORDER_API') . $endPoint, array(), array(), $orderDetails['order_id'], 0);

            if ($userdata['is_title_officer'] == 1 || $userdata['is_sales_rep'] == 1 || $userdata['is_master'] == 1) {
                $user_data['admin_api'] = 1;
            } else {
                $user_data = array();
            }

            $result = $this->resware->make_request('GET', $endPoint, '', $user_data);
            $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_partners', env('RESWARE_ORDER_API') . $endPoint, array(), $result, $orderDetails['order_id'], $logid);
            $partners = json_decode($result, true);
            $partners = isset($partners['Partners']) && !empty($partners['Partners']) ? $partners['Partners'] : '';
            $res = array('status' => 'success', 'partners' => $partners);
        } else {
            $res = array('status' => 'error', 'msg' => "Please select file.");
        }
        echo json_encode($res);
    }*/

    public function get_contacts()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $fileNumber = $this->input->post('fileNumber');
        if ($fileNumber) {
            // $userdata = $this->session->userdata('user');
            // $params = [
            //     'order_details.id' => $orderId,
            // ];
            // $orderDetails = $this->order->get_order_details($params, 1);
            
            $softproContacts = $this->order->fetchAndSyncContacts($fileNumber);
            $res = array('status' => 'success', 'contacts' => $softproContacts);
        } else {
            $res = array('status' => 'error', 'msg' => "Please select file.");
        }
        echo json_encode($res);
    }

    public function get_fees_invoice()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $orderId = $this->input->post('orderId');
        if ($orderId) {
            $params = [
                'order_details.id' => $orderId,
            ];
            $orderDetails = $this->order->get_order_details($params, 1);
            
            $this->order->generateFeesEstimationPdf($orderId);
            $reportFileName      = $orderDetails['file_number'] . '-Fees.pdf';
            $file = '';
            if ($this->order->fileExistOrNotOnS3('fees-pdf/' . $reportFileName)) {
                $file = env('AWS_PATH') . "fees-pdf/" . $reportFileName;
            }
            $res = array('status' => 'success', 'pdf_url' => $file);
        } else {
            $res = array('status' => 'error', 'msg' => "Please select file.");
        }
        echo json_encode($res);
    }

    public function uploadDocOrders()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/upload_doc_orders.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order/common", "upload_doc_orders", $data);
    }

    public function getOrdersUploadDoc()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $params = array();
        $data = array();
        if (isset($_POST['draw']) && !empty($_POST['draw'])) {
            $params['draw'] = isset($_POST['draw']) && !empty($_POST['draw']) ? $_POST['draw'] : 10;
            $params['length'] = isset($_POST['length']) && !empty($_POST['length']) ? $_POST['length'] : 2;
            $params['start'] = isset($_POST['start']) && !empty($_POST['start']) ? $_POST['start'] : 0;
            $params['orderColumn'] = isset($_POST['order'][0]['column']) && !empty($_POST['order'][0]['column']) ? $_POST['order'][0]['column'] : 0;
            $params['orderDir'] = isset($_POST['order'][0]['dir']) && !empty($_POST['order'][0]['dir']) ? $_POST['order'][0]['dir'] : 0;
            $params['searchvalue'] = isset($_POST['search']['value']) && !empty($_POST['search']['value']) ? $_POST['search']['value'] : '';
            $pageno = ($params['start'] / $params['length']) + 1;
            $order_lists = $this->order->get_orders($params);
            $json_data['draw'] = intval($params['draw']);
        } else {
            $params['searchvalue'] = isset($_POST['keyword']) && !empty($_POST['keyword']) ? $_POST['keyword'] : '';
            $order_lists = $this->order->get_orders($params);
        }

        if (isset($order_lists['data']) && !empty($order_lists['data'])) {
            $i = $params['start'] + 1;
            foreach ($order_lists['data'] as $order) {
                $nestedData = array();
                $nestedData[] = $i;
                $nestedData[] = $order['file_number'];
                $nestedData[] = $order['full_address'];
                $nestedData[] = "<a href='" . base_url() . "upload-documents/" . $order['id'] . "'>
									<button type='submit' class='btn btn-info btn-icon-split'>
										<span class='icon text-white-50'>
											<i class='fas fa-file'></i>
										</span>
										<span class='text'>Attach Files</span>
									</button>
								</a>";
                $data[] = $nestedData;
                $i++;
            }
        }
        $json_data['recordsTotal'] = intval($order_lists['recordsTotal']);
        $json_data['recordsFiltered'] = intval($order_lists['recordsFiltered']);
        $json_data['data'] = $data;
        echo json_encode($json_data);
    }

    public function policyOrders()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/policy.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order/common", "policy_orders", $data);
    }

    public function getOrdersPolicy()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $params = array();
        $data = array();
        if (isset($_POST['draw']) && !empty($_POST['draw'])) {
            $params['draw'] = isset($_POST['draw']) && !empty($_POST['draw']) ? $_POST['draw'] : 10;
            $params['length'] = isset($_POST['length']) && !empty($_POST['length']) ? $_POST['length'] : 2;
            $params['start'] = isset($_POST['start']) && !empty($_POST['start']) ? $_POST['start'] : 0;
            $params['orderColumn'] = isset($_POST['order'][0]['column']) && !empty($_POST['order'][0]['column']) ? $_POST['order'][0]['column'] : 0;
            $params['orderDir'] = isset($_POST['order'][0]['dir']) && !empty($_POST['order'][0]['dir']) ? $_POST['order'][0]['dir'] : 0;
            $params['searchvalue'] = isset($_POST['search']['value']) && !empty($_POST['search']['value']) ? $_POST['search']['value'] : '';
            $pageno = ($params['start'] / $params['length']) + 1;
            $order_lists = $this->order->get_orders($params);
            $json_data['draw'] = intval($params['draw']);
        } else {
            $params['searchvalue'] = isset($_POST['keyword']) && !empty($_POST['keyword']) ? $_POST['keyword'] : '';
            $order_lists = $this->order->get_orders($params);
        }

        if (isset($order_lists['data']) && !empty($order_lists['data'])) {
            $i = $params['start'] + 1;
            foreach ($order_lists['data'] as $order) {
                $nestedData = array();
                $nestedData[] = $i;
                $nestedData[] = $order['file_number'];
                $nestedData[] = $order['full_address'];
                $nestedData[] = "<a href='" . base_url() . "policy-order/" . $order['id'] . "'>
									<button type='submit' class='btn btn-info btn-icon-split'>
										<span class='icon text-white-50'>
											<i class='fas fa-file'></i>
										</span>
										<span class='text'>Get Policy</span>
									</button>
								</a>";
                $data[] = $nestedData;
                $i++;
            }
        }
        $json_data['recordsTotal'] = intval($order_lists['recordsTotal']);
        $json_data['recordsFiltered'] = intval($order_lists['recordsFiltered']);
        $json_data['data'] = $data;
        echo json_encode($json_data);
    }

    public function policy()
    {
        $data['errors'] = array();
        $data['success'] = array();
        if ($this->session->userdata('errors')) {
            $data['errors'] = $this->session->userdata('errors');
            $this->session->unset_userdata('errors');
        }
        if ($this->session->userdata('success')) {
            $data['success'] = $this->session->userdata('success');
            $this->session->unset_userdata('success');
        }
        $orderId = $this->uri->segment(2);
        $data['title'] = 'Get Policy | Pacific Coast Title Company';
        $data['mail_dashboard'] = 1;
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params, 1);
        $fileId = $orderDetails['file_id'];
        $data['file_number'] = $orderDetails['file_number'];
        $data['full_address'] = $orderDetails['full_address'];
        $data['file_id'] = $orderDetails['file_id'];
        $data['order_id'] = $orderDetails['order_id'];
        $data['created'] = !empty($orderDetails['opened_date']) ? date("m/d/Y", strtotime($orderDetails['opened_date'])) : '';

        if ($orderDetails['is_softpro_order'] != 1) {
            $user_data['admin_api'] = 1;
            $endPoint = 'files/' . $fileId . '/documents';
            $logid = $this->apiLogs->syncLogs(0, 'resware', 'get_resware_document', env('RESWARE_ORDER_API') . $endPoint, array(), array(), $orderDetails['order_id'], 0);
            $result = $this->resware->make_request('GET', $endPoint, '', $user_data);
            $this->apiLogs->syncLogs(0, 'resware', 'get_resware_document', env('RESWARE_ORDER_API') . $endPoint, array(), $result, $orderDetails['order_id'], $logid);
            $res = json_decode($result, true);
    
            $policyDocuments = array();
            $i = 0;
            foreach ($res['Documents'] as $document) {
                if ($document['DocumentType']['DocumentTypeID'] == 103) {
                    $policyDocuments[$i]['no'] = $i + 1;
                    $policyDocuments[$i]['api_document_id'] = $document['DocumentID'];
                    $policyDocuments[$i]['document_name'] = $document['DocumentName'];
                    $time = round((int) (str_replace("-0000)/", "", str_replace("/Date(", "", $document['CreateDate']))) / 1000);
                    $created_date = date('m/d/Y', $time);
                    $policyDocuments[$i]['created_at'] = $created_date;
                    $i++;
                }
            }
    
            $data['policyDocuments'] = $policyDocuments;

        }

        $this->salesdashboardtemplate->show("order/common", "policy_package", $data);
    }

    /*public function upload_documents()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $this->load->model('order/document');
        $data['errors'] = array();
        $data['success'] = array();
        $userdata = $this->session->userdata('user');
        if ($this->session->userdata('errors')) {
            $data['errors'] = $this->session->userdata('errors');
            $this->session->unset_userdata('errors');
        }
        if ($this->session->userdata('success')) {
            $data['success'] = $this->session->userdata('success');
            $this->session->unset_userdata('success');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $fileId = $this->uri->segment(2);
        $data['orderDetails'] = $this->order->get_order_details($fileId);
        $data['documentTypes'] = $this->order->get_document_types();

        if ($userdata['is_title_officer'] == 1) {
            $documents = $this->order->get_user_documents($data['orderDetails']['order_id']);
            $user_data = array();
            $user_data = array(
                'admin_api' => 1,
            );
            $user_data['from_mail'] = 1;
            $endPoint = 'files/' . $fileId . '/documents';
            $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_documents', env('RESWARE_ORDER_API') . $endPoint, array(), array(), $data['orderDetails']['order_id'], 0);
            $resultDocuments = $this->resware->make_request('GET', $endPoint, '', $user_data);
            $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_documents', env('RESWARE_ORDER_API') . $endPoint, array(), $resultDocuments, $data['orderDetails']['order_id'], $logid);
            $resDocuments = json_decode($resultDocuments, true);
            $apiDocumentIds = array_column($documents, 'api_document_id');

            if (!empty($resDocuments['Documents'])) {
                foreach ($resDocuments['Documents'] as $resDocument) {
                    $ext = end(explode('.', $resDocument['DocumentName']));
                    $time = round((int) (str_replace("-0000)/", "", str_replace("/Date(", "", $resDocument['CreateDate']))) / 1000);
                    $created_date = date('Y-m-d H:i:s', $time);
                    $document_name = date('YmdHis') . "_" . $resDocument['DocumentName'];
                    if (strtolower($ext) == 'doc' || strtolower($ext) == 'docx') {
                        $document_name = str_replace($ext, 'pdf', $document_name);
                    }
                    if (in_array($resDocument['DocumentID'], $apiDocumentIds)) {
                        $documentData = array(
                            'original_document_name' => $resDocument['DocumentName'],
                            'document_type_id' => $resDocument['DocumentType']['DocumentTypeID'],
                            'document_size' => $resDocument['Size'],
                            'order_id' => $data['orderDetails']['order_id'],
                            'description' => $resDocument['DocumentName'],
                            'created' => $created_date,
                        );
                        $condition = array(
                            'api_document_id' => $resDocument['DocumentID'],
                        );
                        $this->document->update($documentData, $condition);
                    } else {
                        $documentData = array(
                            'document_name' => $document_name,
                            'original_document_name' => $resDocument['DocumentName'],
                            'document_type_id' => $resDocument['DocumentType']['DocumentTypeID'],
                            'api_document_id' => $resDocument['DocumentID'],
                            'document_size' => $resDocument['Size'],
                            'user_id' => 0,
                            'order_id' => $data['orderDetails']['order_id'],
                            'description' => $resDocument['DocumentName'],
                            'created' => $created_date,
                            'is_sync' => 0,
                            'is_prelim_document' => 0,
                        );
                        $this->document->insert($documentData);
                    }
                }
            }
        } else {
            if ($userdata['is_escrow_officer'] == 1 || $userdata['is_escrow_assistant'] == 1) {
                $prod_type = $data['orderDetails']['prod_type'];
                $this->load->model('admin/escrow/tasks_model');
                $data['tasks'] = $this->tasks_model->get_many_by("(status = 1 and parent_task_id = 0 and (prod_type = 'both' or prod_type = '$prod_type') )");
            }
        }
        // $this->template->addJS( base_url('assets/frontend/js/order/upload_document_for_order.js?v='.$this->js_version));
        // $this->template->show("order/common", "upload_documents", $data);
        $this->escrowdashboardtemplate->addJS(base_url('assets/frontend/js/order/upload_document_for_order.js?v=' . $this->js_version));
        $this->escrowdashboardtemplate->show("order/common", "upload_documents", $data);
    }*/

    public function getOrderDocuments()
    {
        $userdata = $this->session->userdata('user');
        $params = array();
        $data = array();
        $params['order_id'] = $this->input->post('order_id');
        $params['file_id'] = $this->input->post('file_id');
        if (isset($_POST['draw']) && !empty($_POST['draw'])) {
            $params['draw'] = isset($_POST['draw']) && !empty($_POST['draw']) ? $_POST['draw'] : 10;
            $params['length'] = isset($_POST['length']) && !empty($_POST['length']) ? $_POST['length'] : 2;
            $params['start'] = isset($_POST['start']) && !empty($_POST['start']) ? $_POST['start'] : 0;
            $params['orderColumn'] = isset($_POST['order'][0]['column']) && !empty($_POST['order'][0]['column']) ? $_POST['order'][0]['column'] : 0;
            $params['orderDir'] = isset($_POST['order'][0]['dir']) && !empty($_POST['order'][0]['dir']) ? $_POST['order'][0]['dir'] : 0;
            $params['searchvalue'] = isset($_POST['search']['value']) && !empty($_POST['search']['value']) ? $_POST['search']['value'] : '';
            $pageno = ($params['start'] / $params['length']) + 1;
            $documents_lists = $this->order->getOrderdocuments($params);
            $json_data['draw'] = intval($params['draw']);
        } else {
            $params['searchvalue'] = isset($_POST['keyword']) && !empty($_POST['keyword']) ? $_POST['keyword'] : '';
            $documents_lists = $this->order->getOrderdocuments($params);
        }

        if (isset($documents_lists['data']) && !empty($documents_lists['data'])) {
            $i = $params['start'] + 1;
            foreach ($documents_lists['data'] as $document) {
                $nestedData = array();
                $nestedData[] = $i;
                $nestedData[] = $document['original_document_name'];
                if ($userdata['is_escrow_officer'] == 1 || $userdata['is_escrow_assistant'] == 1) {
                    if ($document['is_uploaded_by_borrower'] == 1) {
                        $nestedData[] = 'Yes';
                    } else {
                        $nestedData[] = 'No';
                    }
                }
                $nestedData[] = date('m/d/Y', strtotime($document['created']));
                $apiDocumentId = $document['api_document_id'];
                $documentName = $document['document_name'];
                $documentUrl = env('AWS_PATH') . "documents/" . $documentName;
                $nestedData[] = '<div style="display:inline-flex;"><a href="javascript:void(0)" onclick="downloadDocumentFromAws(' . "'" . $documentUrl . "'" . ', ' . "'" . $apiDocumentId . "'" . ');" class="btn btn-success btn-icon-split btn-sm"><span class="icon text-white-50"><i class="fas fa-download"></i></span><span class="text">Download</span></a></div>';
                $data[] = $nestedData;
                $i++;
            }
        }
        $json_data['recordsTotal'] = intval($documents_lists['recordsTotal']);
        $json_data['recordsFiltered'] = intval($documents_lists['recordsFiltered']);
        $json_data['data'] = $data;
        echo json_encode($json_data);
    }

    /*public function files_upload()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $this->load->model('order/document');
        $this->load->model('order/apiLogs');
        $this->load->library('order/resware');
        $errors = array();
        $success = array();
        $config['upload_path'] = './uploads/documents/';
        $config['allowed_types'] = 'doc|docx|gif|msg|pdf|tif|tiff|xls|xlsx|xml';
        $config['max_size'] = 12000;
        $userdata = $this->session->userdata('user');
        $this->load->library('upload', $config);
        $fileId = $this->input->post('file_id');
        $orderId = $this->input->post('order_id');

        if (!is_dir('uploads/documents')) {
            mkdir('./uploads/documents', 0777, true);
        }

        for ($i = 1; $i <= 4; $i++) {
            if (!empty($_FILES['document_' . $i]['name'])) {
                if (!$this->upload->do_upload('document_' . $i)) {
                    $errors[$i] = "Document #" . $i . ": " . $this->upload->display_errors();
                } else {
                    $data = $this->upload->data();
                    $contents = file_get_contents($data['full_path']);
                    $binaryData = base64_encode($contents);
                    $document_name = date('YmdHis') . "_" . $data['file_name'];
                    rename(FCPATH . "/uploads/documents/" . $data['file_name'], FCPATH . "/uploads/documents/" . $document_name);

                    $documentData = array(
                        'document_name' => $document_name,
                        'original_document_name' => $data['file_name'],
                        'document_type_id' => $this->input->post('document_type_' . $i),
                        'document_size' => ($data['file_size'] * 1000),
                        'user_id' => $userdata['id'],
                        'order_id' => $orderId,
                        'task_id' => $this->input->post('task_id_' . $i) ? $this->input->post('task_id_' . $i) : 0,
                        'description' => $this->input->post('description_' . $i),
                        'is_sync' => 1,
                        'is_prelim_document' => 0,
                    );

                    $this->order->uploadDocumentOnAwsS3($document_name, 'documents');
                    $documentId = $this->document->insert($documentData);
                    if (($userdata['is_escrow_officer'] == 1 || $userdata['is_escrow_assistant'] == 1) && $documentId) {
                        $success[$i] = "Document #" . $i . ": uploaded successfully";
                    } else {
                        $endPoint = 'files/' . $fileId . '/documents';
                        $documentApiData = array(
                            'DocumentName' => $data['file_name'],
                            'DocumentType' => array(
                                'DocumentTypeID' => $this->input->post('document_type_' . $i),
                            ),
                            'Description' => $this->input->post('description_' . $i),
                            'InternalOnly' => false,
                            'DocumentBody' => $binaryData,
                        );
                        $document_api_data = json_encode($documentApiData, JSON_UNESCAPED_SLASHES);
                        if ($userdata['is_title_officer'] == 1 || $userdata['is_master'] == 1) {
                            $user_data['admin_api'] = 1;
                        }

                        $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'create_document', env('RESWARE_ORDER_API') . $endPoint, $documentApiData, array(), $orderId, 0);
                        $result = $this->resware->make_request('POST', $endPoint, $document_api_data, $user_data);
                        $this->apiLogs->syncLogs($userdata['id'], 'resware', 'create_document', env('RESWARE_ORDER_API') . $endPoint, $documentApiData, $result, $orderId, $logid);
                        $res = json_decode($result);
                        if (!empty($res->Document->DocumentID)) {
                            $this->document->update(array('api_document_id' => $res->Document->DocumentID), array('id' => $documentId));
                            $success[$i] = "Document #" . $i . ": uploaded successfully";
                        } else {
                            $errors[$i] = "Document #" . $i . ": Something went wrong.Please try again";
                        }
                    }
                }
            }
        }
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        if (!empty($userdata) && $userdata['id'] == $orderDetails['title_officer']) {
            $message = 'Documents uploaded for order number #' . $orderDetails['file_number'];
            $notificationData = array(
                'sent_user_id' => $orderDetails['customer_id'],
                'message' => $message,
                'is_admin' => 0,
                'type' => 'created',
            );
            $this->home_model->insert($notificationData, 'pct_order_notifications');
            $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
        } else if (!empty($userdata) && $userdata['id'] == $orderDetails['customer_id']) {
            $message = 'Documents uploaded for order number #' . $orderDetails['file_number'];
            $notificationData = array(
                'sent_user_id' => $orderDetails['title_officer'],
                'message' => $message,
                'is_admin' => 0,
                'type' => 'created',
            );
            $this->home_model->insert($notificationData, 'pct_order_notifications');
            $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
        }
        $data['errors'] = $errors;
        $data['success'] = $success;
        $data = array(
            "errors" => $errors,
            "success" => $success,
        );
        $this->session->set_userdata($data);
        redirect(base_url() . 'upload-documents/' . $fileId);
    }*/

    public function cpl()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $data['errors'] = array();
        $data['success'] = array();
        if ($this->session->userdata('errors')) {
            $data['errors'] = $this->session->userdata('errors');
            $this->session->unset_userdata('errors');
        }
        if ($this->session->userdata('success')) {
            $data['success'] = $this->session->userdata('success');
            $this->session->unset_userdata('success');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/cpl.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order", "cpl", $data);
        // $this->template->show("order", "cpl", $data);
    }

    public function get_orders_cpl()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $params = array();
        $data = array();
        if (isset($_POST['draw']) && !empty($_POST['draw'])) {
            $params['draw'] = isset($_POST['draw']) && !empty($_POST['draw']) ? $_POST['draw'] : 10;
            $params['length'] = isset($_POST['length']) && !empty($_POST['length']) ? $_POST['length'] : 2;
            $params['start'] = isset($_POST['start']) && !empty($_POST['start']) ? $_POST['start'] : 0;
            $params['orderColumn'] = isset($_POST['order'][0]['column']) && !empty($_POST['order'][0]['column']) ? $_POST['order'][0]['column'] : 0;
            $params['orderDir'] = isset($_POST['order'][0]['dir']) && !empty($_POST['order'][0]['dir']) ? $_POST['order'][0]['dir'] : 0;
            $params['searchvalue'] = isset($_POST['search']['value']) && !empty($_POST['search']['value']) ? $_POST['search']['value'] : '';
            $pageno = ($params['start'] / $params['length']) + 1;
            $order_lists = $this->order->get_orders($params);
            $json_data['draw'] = intval($params['draw']);
        } else {
            $params['searchvalue'] = isset($_POST['keyword']) && !empty($_POST['keyword']) ? $_POST['keyword'] : '';
            $order_lists = $this->order->get_orders($params);
        }

        if (isset($order_lists['data']) && !empty($order_lists['data'])) {
            $i = $params['start'] + 1;
            foreach ($order_lists['data'] as $order) {
                $nestedData = array();
                $nestedData[] = $i;
                $nestedData[] = $order['file_number'];
                $nestedData[] = $order['full_address'];
                // $nestedData[] = !empty($order['document_created_date']) ? date("m/d/Y", strtotime($order['document_created_date'])) : '';
                $nestedData[] = !empty($order['document_created_date']) ? convertTimezone($order['document_created_date'], 'm/d/Y') : '';
                $order_id = $order['id'];
                if (!empty($order['cpl_document_name'])) {
                    $file_id = $order['file_number'];
                    $documentName = $order['cpl_document_name'];
                    if (env('AWS_ENABLE_FLAG') == 1) {
                        if ($this->order->fileExistOrNotOnS3('cpl_documents/' . $documentName)) {
                            $documentName = $documentName;
                            $documentUrl = env('AWS_PATH') . "cpl_documents/" . $documentName;
                        } else {
                            $documentUrl = env('AWS_PATH') . "documents/" . $documentName;
                        }
                        $nestedData[] = "<div style='display:flex;justify-content: space-around;'><a href='#' onclick='downloadDocumentFromAws(" . '"' . $documentUrl . '"' . ", " . '"cpl"' . ");' title='Download' class='btn btn-success btn-icon-split'><span class='icon text-white-50'><i class='fas fa-download'></i></span><span class='text'>Download</span></a>
						<a onclick='return lender_pop_up(0, $order_id);' href='javascript:void(0);' class='btn btn-primary btn-icon-split'><span class='icon text-white-50'><i class='fas fa-edit'></i></span><span class='text'>Edit</span></a></div>";
                    } else {
                        $documentUrl = FCPATH . 'uploads/documents/' . $documentName;
                        $nestedData[] = "<div style='display:flex;justify-content: space-around;'><a href='$documentUrl' download title='Download' class='btn btn-success btn-icon-split'><span class='icon text-white-50'><i class='fas fa-download'></i></span><span class='text'>Download</span></a>
						<a onclick='return lender_pop_up(0, $order_id);' href='javascript:void(0);' class='btn btn-primary btn-icon-split'><span class='icon text-white-50'><i class='fas fa-edit'></i></span><span class='text'>Edit</span></a></div>";
                    }

                } else if (!empty($order['westcor_file_id'])) {
                    $file_id = $order['file_number'];
                    $westcorFileId = $order['westcor_file_id'];
                    $westcorOrderId = $order['westcor_order_id'];
                    $nestedData[] = "<div style='display:flex;justify-content: space-around;'><a onclick='download_for_pdf($westcorFileId, $westcorOrderId);' href='javascript:void(0);' title='Download' title='Download' class='btn btn-success btn-icon-split'><span class='icon text-white-50'><i class='fas fa-download'></i></span><span class='text'>Download</span></a><a onclick='return lender_pop_up(0, $order_id);' href='javascript:void(0);' class='btn btn-primary btn-icon-split'><span class='icon text-white-50'><i class='fas fa-edit'></i></span><span class='text'>Edit</span></a></div>";
                } else {
                    $file_id = $order['file_number'];
                    $nestedData[] = "<div style='display:flex;justify-content: space-around;'><form onclick='return lender_pop_up(0, $order_id);' action='" . base_url() . "create-cpl/" . $order['id'] . "' method='POST'><a href='javascript:void(0);'  title='Generate' type='submit' class='btn btn-success btn-icon-split'><span class='icon text-white-50'><i class='fas fa-seedling'></i></span><span class='text'>Generate</span></a></form><a onclick='return lender_pop_up(0, $order_id);' href='javascript:void(0);' class='btn btn-primary btn-icon-split'><span class='icon text-white-50'><i class='fas fa-edit'></i></span><span class='text'>Edit</span></a></div>";
                }
                $data[] = $nestedData;
                $i++;
            }
        }

        $json_data['recordsTotal'] = intval($order_lists['recordsTotal']);
        $json_data['recordsFiltered'] = intval($order_lists['recordsFiltered']);
        $json_data['data'] = $data;
        echo json_encode($json_data);
    }

    public function create_cpl()
    {
        $userdata = $this->session->userdata('user');
        $this->load->library('order/westcor');
        $orderId = $this->uri->segment(2);
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        $data = $this->westcor->generateCplDocument($orderId, $orderDetails);
        $this->session->set_userdata($data);
        $this->session->unset_userdata('lender_details');
        if (!empty($userdata['id'])) {
            redirect(base_url() . 'cpl-dashboard');
        } else {
            redirect(base_url() . 'generate-cpl/' . $orderDetails['random_number']);
        }
    }

    public function addLenderOnOrder()
    {
        $this->load->model('order/home_model');
        // $this->load->library('order/resware');
        $userdata = $this->session->userdata('user');
        if (empty($userdata)) {
            $userdata['id'] = 0;
        }
        $file_id = $this->input->post('file_id');
        $order_id = $this->input->post('order_id');
        $LenderId = $this->input->post('LenderId');
        $lenderCompanyId = $this->input->post('LenderCompanyId');
        $loan_number = $this->input->post('loan_number');
        $vesting = $this->input->post('vesting');
        $new_existing_lender = $this->input->post('new_existing_lender');
        $borrowers_vesting = $this->input->post('borrowers_vesting');
        $primaryBorrowerArray = $this->order->splitFullName($borrowers_vesting);
        // $name = explode(" ", $this->input->post('LenderName'));
        $lenderFullName = $this->input->post('LenderName');
        $name = $this->order->splitFullName($lenderFullName);
        $lenderCompanyName = !empty($this->input->post('LenderCompany')) ? $this->input->post('LenderCompany') : "";
        $lenderCompanyLookupCode = !empty($this->input->post('LenderCompanyLookupCode')) ? $this->input->post('LenderCompanyLookupCode') : "";
        $lenderCompanyAddress = !empty($this->input->post('LenderAddress')) ? $this->input->post('LenderAddress') : "";
        $lenderCompanyCity = !empty($this->input->post('LenderCity')) ? $this->input->post('LenderCity') : "";
        $lenderCompanyState = !empty($this->input->post('LenderState')) ? $this->input->post('LenderState') : "";
        $lenderCompanyZipcode = !empty($this->input->post('LenderZipcode')) ? $this->input->post('LenderZipcode') : "";
        $assignmentClause = !empty($this->input->post('assignment_clause')) ? $this->input->post('assignment_clause') : "";
        $editFlag = $this->input->post('editFlag');
        $loan_amount = $this->input->post('loan_amount');
        $sales_amount = $this->input->post('sales_amount');
        $first_name = $name['first_name'];
        $middle_name = $name['middle_name'];
        $last_name = $name['last_name'];
        $params = [
            'order_details.id' => $order_id,
        ];
        $orderDetails = $this->order->get_order_details($params);
        $cplApi = $this->input->post('cpl_api');
        if ($cplApi == 'doma') {
            $errors[] = "Please contact your title team in order to get your CPL processed.";
            $data = array(
                "errors" => $errors,
            );
            $this->session->set_flashdata($data);
            redirect(base_url() . 'cpl-dashboard');
        }
        $lender_details = array(
            'first_name' => $first_name,
            'last_name' => $last_name,
            'lender_fullname' => $lenderFullName,
            'company_name' => $lenderCompanyName,
            'address1' => $lenderCompanyAddress,
            'city' => $lenderCompanyCity,
            'state' => $lenderCompanyState,
            'zip' => $lenderCompanyZipcode,
            'assignment_clause' => $assignmentClause,
        );
        $this->session->set_userdata('lender_details', $lender_details);
        unset($lender_details['lender_fullname']);
        $flookup_code = $this->order->generateNewCompanyLookupCode($lenderCompanyName, $lenderCompanyAddress);
        if ($new_existing_lender == 'add_lender') {
            $lenderCompanyLookupCode = $flookup_code;
            $spResponse = $this->addNewLenderCPL($lenderCompanyName, $flookup_code, $lenderCompanyAddress, $lenderCompanyCity, $lenderCompanyState, $lenderCompanyZipcode, $assignmentClause);
            $lenderCompanyId = $spResponse['id'];
        } else {
            // $condition = array(
            //     'id' => $LenderId,
            // );
            // $this->home_model->update($lender_details, $condition, 'pct_softpro_lookup_table');
            // $spResponse = $this->existingLenderCPL($lenderCompanyName, $lenderCompanyAddress, $lenderCompanyCity, $lenderCompanyState, $lenderCompanyZipcode, $assignmentClause);
            // $companyId = $lenderCompanyId;//$spResponse['id'];
            $updateData = [
                'assignment_clause'  => $assignmentClause
            ];
            $this->home_model->update($updateData, array('id' => $lenderCompanyId), 'sp_company');
        }
        // $lenderUserDetails = $this->home_model->get_user(array('id' => $LenderId));
        
        $propertyDetails = array(
            'cpl_lender_company_id' => $lenderCompanyId,
            'borrowers_vesting' => trim($borrowers_vesting),
            'cpl_proposed_property_address' => $this->input->post('property_address'),
            'cpl_proposed_property_city' => $this->input->post('property_city'),
            'cpl_proposed_property_state' => $this->input->post('property_state'),
            'cpl_proposed_property_zip' => $this->input->post('property_zipcode'),
        );
        
        $this->home_model->update(array('loan_number' => $loan_number, 'loan_amount' => $loan_amount, 'sales_amount' => $sales_amount), array('id' => $orderDetails['transaction_id']), 'transaction_details');
        $this->home_model->update(array('fnf_agent_id' => $this->input->post('branch'), 'is_regenerate_cpl' => $editFlag), array('id' => $orderDetails['order_id']), 'order_details');
        $this->home_model->update($propertyDetails, array('id' => $orderDetails['property_id']), 'property_details');

        if (!empty($loan_number)) {
            $orderReq['orderNumber'] = $orderDetails['file_number'];
            $orderReq['loanNumber'] = $loan_number;
            $orderReq['PrimaryBorrowerFirstName'] = $primaryBorrowerArray['first_name'];
            $orderReq['PrimaryBorrowerMiddleName'] = $primaryBorrowerArray['middle_name'];
            $orderReq['PrimaryBorrowerLastName'] = $primaryBorrowerArray['last_name'];
            $orderReq['userModel'] = [
                'CompanyLookupCode' => $lenderCompanyLookupCode
            ];
            $order_data = json_encode($orderReq);
            $logid = $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'update_order', 'update_order', $order_data, [], 0, 0);
            $response = $this->softpro->make_request('POST', 'update_order', $order_data, $userdata);
            $this->apiLogs->syncLogs($userdata['id'], 'softpro', 'update_order', 'update_order', $order_data, json_encode($response), 0, $logid);
        }

        // $this->home_model->update(array(), array('id' => $orderDetails['order_id']), 'order_details');
        if ($cplApi == 'fnf') {
            redirect(base_url() . "create-cpl-for-fnf/" . $order_id);
        } else if ($cplApi == 'westcor') {
            redirect(base_url() . "create-cpl/" . $order_id);
        } else if ($cplApi == 'doma') {
            redirect(base_url() . "create-cpl-for-doma/" . $order_id);
        } else {
            redirect(base_url() . "create-cpl-for-natic/" . $order_id);
        }
    }

    private function addNewLenderCPL($lenderCompanyName, $flookup_code, $lenderCompanyAddress, $lenderCompanyCity, $lenderCompanyState, $lenderCompanyZipcode, $assignmentClause) {
        $condition = [
            "where" => array('name' => $lenderCompanyName)
        ];
        $checkCompanyExist = $this->home_model->get_sp_company($condition);
        $companyData = [
            'Name'         => $lenderCompanyName,
            'LookupCode'   => $flookup_code,
            'Address1'     => $lenderCompanyAddress,
            'City'         => $lenderCompanyCity,
            'State'        => $lenderCompanyState,
            'Zip'          => $lenderCompanyZipcode,
            'UserType' =>  'Lender'
            // 'Phone'        => $this->input->post('phone'),
            // 'Email'        => $this->input->post('email_address'),
        ];
        $companyTDData = [
            'name'         => $lenderCompanyName,
            'lookup_code'        => $flookup_code,
            'address1'           => $lenderCompanyAddress,
            'city'               => $lenderCompanyCity,
            'state'              => $lenderCompanyState,
            'zip'                => $lenderCompanyZipcode,
            'assignment_clause'  => $assignmentClause,
            'is_escrow_company'  => 0,
            'is_lender'          => 1,
            'is_mortgage_broker' => 0,
            'is_selling_agent'   => 0
        ];
        if (empty($checkCompanyExist)) {
            // echo "<pre> if";
            // print_r($checkCompanyExist);
            // print_r($companyData);
            // print_r($companyTDData);
            // die;
            $response = $this->order->addNewUserToSoftpro($companyData, 'add_company');
            
            if ($response['success']) {
                
                $data['id'] = $this->home_model->insert($companyTDData, 'sp_company');
                /** Save user Activity */
                $activity = 'New company created :- ' . $this->input->post('email_address');
                $this->order->logAdminActivity($activity);
                /** End Save user activity */
            } else {
                $data['error_msg'] = $response['msg'];
            }
        } else if (!empty($checkCompanyExist)) {
            // $companyData['LookupCode'] = $companyTDData['lookup_code'] = $checkCompanyExist[0]['lookup_code'];
            // $response = $this->order->updateNewUserToSoftpro($companyData, 'update_company');

            // if ($response['success']) {
            //     $update = $this->home_model->update($companyTDData, ['lookup_code' => $companyData['LookupCode']], 'sp_company');
            //     /** Save user Activity */
            //     $activity = 'Company update :- ' .$companyLookup;
            //     $this->order->logAdminActivity($activity);
            //     /** End Save user activity */
            // } else {
            //     $data['error_msg'] = $response['msg'];
            // }
            $data['id'] = $checkCompanyExist[0]['id'];
        }
        return $data;
    }

    private function existingLenderCPL($lenderCompanyName, $lenderCompanyAddress, $lenderCompanyCity, $lenderCompanyState, $lenderCompanyZipcode, $assignmentClause) {
        $condition = ['where' => ['name' => $lenderCompanyName]];
        $checkCompanyExist = $this->home_model->get_sp_company($condition);
        // $companyData = [
        //     'Name'         => $lenderCompanyName,
        //     'LookupCode'   => $checkCompanyExist[0]['lookup_code'],
        //     'Address1'     => $lenderCompanyAddress,
        //     'City'         => $lenderCompanyCity,
        //     'State'        => $lenderCompanyState,
        //     'Zip'          => $lenderCompanyZipcode,
        //     'UserType'     =>  'Lender'
        // ];

        // $companyTDData = [
        //     'name'      => $lenderCompanyName,
        //     'address1'  => $lenderCompanyAddress,
        //     'city'      => $lenderCompanyCity,
        //     'state'     => $lenderCompanyState,
        //     'zip'       => $lenderCompanyZipcode,
        //     'assignment_clause' => $assignmentClause
        // ];
        // $response = $this->order->updateNewUserToSoftpro($companyData, 'update_company');

        // if ($response['success']) {
        //     $update = $this->home_model->update($companyTDData, ['lookup_code' => $checkCompanyExist[0]['lookup_code']], 'sp_company');
        //     /** Save user Activity */
        //     $activity = 'Company update :- ' .$companyLookup;
        //     $this->order->logAdminActivity($activity);
        //     /** End Save user activity */
        // } else {
        //     $data['error_msg'] = $response['msg'];
        // }
        $data['id'] = $checkCompanyExist[0]['id'];
        return $data;
    }

    public function getOrderDetailsCpl()
    {
        $this->load->library('order/fnf');
        $this->load->library('order/natic');
        // $this->load->library('order/doma');
        $this->load->model('order/home_model');
        // $this->load->library('order/resware');
        // echo "<pre>";
        $orderId = $this->input->post('orderId');
        $requestFrom = $this->input->post('requestFrom');
        $userdata = $this->session->userdata('user');
        if (empty($userdata)) {
            $userdata['id'] = 0;
        }
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        $isSoftProStatus = $orderDetails['is_softpro_order'];
        // print_r($orderDetails);die;
        // if ($orderDetails['is_softpro_order']) {
            $orderUser = $this->home_model->sp_get_user(array('id' => $orderDetails['customer_id']));
        // } else {
        //     $orderUser = $this->home_model->get_user(array('id' => $orderDetails['customer_id']));
        // }
        if (!empty($orderUser) && $orderUser['is_escrow'] == 1) {
            if (!empty($orderDetails['cpl_lender_company_id'])) {
                $lenderDetails = $this->home_model->get_sp_company(array('id' => $orderDetails['cpl_lender_company_id']));
                // print_r($orderUser);die;
                $orderDetails['lender_company_name'] = $lenderDetails['name'] ? $lenderDetails['name'] : '';
                $orderDetails['lender_company_lookup_code'] = $lenderDetails['lookup_code'] ? $lenderDetails['lookup_code'] : '';
                $orderDetails['lender_company_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
                $orderDetails['lender_address'] = $lenderDetails['address1'] ? $lenderDetails['address1'] : '';
                $orderDetails['lender_city'] = $lenderDetails['city'] ? $lenderDetails['city'] : '';
                $orderDetails['lender_state'] = $lenderDetails['state'] ? $lenderDetails['state'] : '';
                $orderDetails['lender_zipcode'] = $lenderDetails['zip'] ? $lenderDetails['zip'] : '';
                
                // $orderDetails['lender_first_name'] = $lenderDetails['first_name'] ? $lenderDetails['first_name'] : '';
                // $orderDetails['lender_last_name'] = $lenderDetails['last_name'] ? $lenderDetails['last_name'] : '';
                $orderDetails['lender_email'] = $lenderDetails['email_address'] ? $lenderDetails['email_address'] : '';
                $orderDetails['lender_assignment_clause'] = $lenderDetails['assignment_clause'] ? $lenderDetails['assignment_clause'] : '';
                $orderDetails['lender_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
            } else {
                    // $orderDetails['lender_first_name'] = $orderDetails['sp_lender_first_name'] ? $orderDetails['sp_lender_first_name'] : '';
                    // $orderDetails['lender_last_name'] = $orderDetails['sp_lender_last_name'] ? $orderDetails['sp_lender_last_name'] : '';
                    // $orderDetails['lender_email'] = $orderDetails['sp_lender_email'] ? $orderDetails['sp_lender_email'] : '';
                    // $orderDetails['lender_state'] = $orderDetails['sp_lender_state'] ? $orderDetails['sp_lender_state'] : '';
                    // $orderDetails['lender_company_name'] = $orderDetails['sp_lender_company_name'] ? $orderDetails['sp_lender_company_name'] : '';
                    // $orderDetails['lender_address'] = $orderDetails['sp_lender_address'] ? $orderDetails['sp_lender_address'] : '';
                    // $orderDetails['lender_city'] = $orderDetails['sp_lender_city'] ? $orderDetails['sp_lender_city'] : '';
                    // $orderDetails['lender_zipcode'] = $orderDetails['sp_lender_zipcode'] ? $orderDetails['sp_lender_zipcode'] : '';
                    // $orderDetails['lender_assignment_clause'] = $orderDetails['sp_lender_assignment_clause'] ? $orderDetails['sp_lender_assignment_clause'] : '';
                    // $orderDetails['lender_id'] = $orderDetails['sp_lender_id'] ? $orderDetails['sp_lender_id'] : '';
                    $orderDetails['lender_first_name'] = '';
                    $orderDetails['lender_last_name'] = '';
                    $orderDetails['lender_email'] = '';
                    $orderDetails['lender_state'] = '';
                    $orderDetails['lender_company_name'] = '';
                    $orderDetails['lender_company_lookup_code'] = '';
                    $orderDetails['lender_company_id'] = '';
                    $orderDetails['lender_address'] = '';
                    $orderDetails['lender_city'] = '';
                    $orderDetails['lender_zipcode'] = '';
                    $orderDetails['lender_assignment_clause'] = '';
                    $orderDetails['lender_id'] = '';
                
            }
        } else {
            if (!empty($orderDetails['cpl_lender_company_id'])) {
                $lenderDetails = $this->home_model->get_sp_company(array('id' => $orderDetails['cpl_lender_company_id']));
                $orderDetails['lender_company_name'] = $lenderDetails['name'] ? $lenderDetails['name'] : '';
                $orderDetails['lender_company_lookup_code'] = $lenderDetails['lookup_code'] ? $lenderDetails['lookup_code'] : '';
                $orderDetails['lender_company_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
                $orderDetails['lender_address'] = $lenderDetails['address1'] ? $lenderDetails['address1'] : '';
                $orderDetails['lender_city'] = $lenderDetails['city'] ? $lenderDetails['city'] : '';
                $orderDetails['lender_state'] = $lenderDetails['state'] ? $lenderDetails['state'] : '';
                $orderDetails['lender_zipcode'] = $lenderDetails['zip'] ? $lenderDetails['zip'] : '';
                $orderDetails['lender_email'] = $lenderDetails['email_address'] ? $lenderDetails['email_address'] : '';
                $orderDetails['lender_assignment_clause'] = $lenderDetails['assignment_clause'] ? $lenderDetails['assignment_clause'] : '';
                $orderDetails['lender_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
            } else {
                if ($orderDetails['is_softpro_order'] && !empty($orderUser) && $orderUser['is_mortgage_broker'] == 1) {
                    $orderDetails['lender_first_name'] = '';
                    $orderDetails['lender_last_name'] = '';
                    $orderDetails['lender_email'] = '';
                    $orderDetails['lender_state'] = '';
                    $orderDetails['lender_company_name'] = '';
                    $orderDetails['lender_company_lookup_code'] = '';
                    $orderDetails['lender_company_id'] = '';
                    $orderDetails['lender_address'] = '';
                    $orderDetails['lender_city'] = '';
                    $orderDetails['lender_zipcode'] = '';
                    $orderDetails['lender_assignment_clause'] = '';
                    $orderDetails['lender_id'] = '';
                } else {
                    // $orderDetails['lender_first_name'] = $orderUser['first_name'] ? $orderUser['first_name'] : '';
                    // $orderDetails['lender_last_name'] = $orderUser['last_name'] ? $orderUser['last_name'] : '';
                    // $orderDetails['lender_email'] = $orderUser['email_address'] ? $orderUser['email_address'] : '';
                    // $orderDetails['lender_state'] = $orderUser['state'] ? $orderUser['state'] : '';
                    // $orderDetails['lender_company_name'] = $orderUser['company_name'] ? $orderUser['company_name'] : '';
                    // $orderDetails['lender_address'] = $orderUser['street_address'] ? $orderUser['street_address'] : '';
                    // $orderDetails['lender_city'] = $orderUser['city'] ? $orderUser['city'] : '';
                    // $orderDetails['lender_zipcode'] = $orderUser['zip_code'] ? $orderUser['zip_code'] : '';
                    // $orderDetails['lender_assignment_clause'] = $orderUser['assignment_clause'] ? $orderUser['assignment_clause'] : '';
                    // $orderDetails['lender_id'] = $orderUser['id'] ? $orderUser['id'] : '';
                    $orderDetails['lender_first_name'] = '';
                    $orderDetails['lender_last_name'] = '';
                    $orderDetails['lender_email'] = '';
                    $orderDetails['lender_state'] = '';
                    $orderDetails['lender_company_name'] = '';
                    $orderDetails['lender_company_lookup_code'] = '';
                    $orderDetails['lender_company_id'] = '';
                    $orderDetails['lender_address'] = '';
                    $orderDetails['lender_city'] = '';
                    $orderDetails['lender_zipcode'] = '';
                    $orderDetails['lender_assignment_clause'] = '';
                    $orderDetails['lender_id'] = '';
                }
            }
            // $orderUser = $this->home_model->sp_get_user(array('id' => $orderDetails['customer_id']));
        }

        // if ($isSoftProStatus) {
        // if (empty($orderDetails['sp_lender_first_name']) && empty($orderDetails['sp_lender_last_name'])) {
        //     $orderDetails['lender_name'] = '';
        // } else if (empty($orderDetails['sp_lender_first_name']) && !empty($orderDetails['sp_lender_last_name'])) {
        //     $orderDetails['lender_name'] = $orderDetails['lender_last_name'];
        // } else if (!empty($orderDetails['sp_lender_first_name']) && empty($orderDetails['sp_lender_last_name'])) {
        //     $orderDetails['lender_name'] = $orderDetails['sp_lender_first_name'];
        // } else if (!empty($orderDetails['sp_lender_first_name']) && !empty($orderDetails['sp_lender_last_name'])) {
        //     $orderDetails['lender_name'] = $orderDetails['sp_lender_first_name'] . " " . $orderDetails['sp_lender_last_name'];
        // }
        // } else {
            if (empty($orderDetails['lender_first_name']) && empty($orderDetails['lender_last_name'])) {
                $orderDetails['lender_name'] = '';
            } else if (empty($orderDetails['lender_first_name']) && !empty($orderDetails['lender_last_name'])) {
                $orderDetails['lender_name'] = $orderDetails['lender_last_name'];
            } else if (!empty($orderDetails['lender_first_name']) && empty($orderDetails['lender_last_name'])) {
                $orderDetails['lender_name'] = $orderDetails['lender_first_name'];
            } else if (!empty($orderDetails['lender_first_name']) && !empty($orderDetails['lender_last_name'])) {
                $orderDetails['lender_name'] = $orderDetails['lender_first_name'] . " " . $orderDetails['lender_last_name'];
            }
        // }

        if ($orderDetails['sales_amount'] > 0) {
            if (!empty($orderDetails['borrower'])) {
                $orderDetails['primary_owner_name'] = $orderDetails['borrower'];
            } else {
                $orderDetails['primary_owner_name'] = '';
            }

            if (!empty($orderDetails['secondary_borrower'])) {
                $orderDetails['secondary_owner_name'] = $orderDetails['secondary_borrower'];
            } else {
                $orderDetails['secondary_owner_name'] = '';
            }
        } else {
            if (!empty($orderDetails['primary_owner'])) {
                $orderDetails['primary_owner_name'] = $orderDetails['primary_owner'];
            } else {
                $orderDetails['primary_owner_name'] = '';
            }

            if (!empty($orderDetails['secondary_owner'])) {
                $orderDetails['secondary_owner_name'] = $orderDetails['secondary_owner'];
            } else {
                $orderDetails['secondary_owner_name'] = '';
            }
        }

        // if (!$isSoftProStatus) {
            // $endPoint = 'files/' . $fileId . '/partners';
            $user_data = array();
            if (!empty($userdata['id']) && (empty($requestFrom) || $requestFrom != 'generic-form')) {
                if ($userdata['is_title_officer'] == 1 || $userdata['is_master'] == 1) {
                    $user_data['admin_api'] = 1;
                } else {
                    $user_data = array();
                }
            } else {
                $user_data['admin_api'] = 1;
            }
            
            // $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_partners', env('RESWARE_ORDER_API') . $endPoint, $user_data, array(), $orderDetails['order_id'], 0);
            // $resultPartners = $this->resware->make_request('GET', $endPoint, '', $user_data);
            // $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_partners', env('RESWARE_ORDER_API') . $endPoint, array(), $resultPartners, $orderDetails['order_id'], $logid);
            // $resPartners = json_decode($resultPartners, true);
            
            if (strtolower($orderDetails['product_type_name']) == 'full alta') {
                $underWriter = 'commonwealth';
                $orderDetails['cpl_api'] = 'fnf';
                $agentsData = $this->fnf->getAgents();
                if ($agentsData === false) {
                    $orderDetails['email'] = $orderUser['email_address'];
                    $agentsData = $this->fnf->getAgentsFromApi($orderDetails);
                }
                $orderDetails['agents_data'] = $agentsData;
            } else {
                $underWriter = 'westcor';
                $this->load->library('order/westcor');
                $branchesData = $this->westcor->getBranches();
                if ($branchesData === false) {
                    $branchesData = $this->westcor->getBranchesFromApi();
                }
                $orderDetails['agents_data'] = $branchesData;
                $orderDetails['cpl_api'] = 'westcor';
            }
            $underwriter_data = [
                'underwriter' => $underWriter,
            ];
            $update_condition = [
                'id' => $orderId,
            ];
            // echo "<pre>";
            // print_r($orderDetails);die;
            $this->order->update($underwriter_data, $update_condition);
            /*if (!empty($resPartners)) {
                $key = array_search(7, array_column($resPartners['Partners'], 'PartnerTypeID'));
                if (str_contains($resPartners['Partners'][$key]['PartnerName'], 'Doma Title Insurance')) {
                    $cplApi = 'doma';
                    $orderDetails['cpl_api'] = 'doma';
                    $branchesData = $this->natic->getDomaBranches();
                    // $branchesData = false;
                    if ($branchesData === false) {
                        $branchesData = $this->natic->getBranchesFromApi($cplApi);
                    }
                    // echo "<pre>";
                    // print_r($branchesData);die;
                    $orderDetails['agents_data'] = $branchesData;
                    $underWriter = 'north_american';
                } elseif (($resPartners['Partners'][$key]['PartnerName'] == 'North American Title Insurance Company')) {
                    $orderDetails['cpl_api'] = 'natic';
                    $branchesData = $this->natic->getBranches();
                    // $branchesData = false;
                    if ($branchesData === false) {
                        $branchesData = $this->natic->getBranchesFromApi();
                    }
                    $orderDetails['agents_data'] = $branchesData;
                    $underWriter = 'north_american';
                } elseif ($resPartners['Partners'][$key]['PartnerName'] == 'Westcor Land Title Insurance Company') {
                    $orderDetails['cpl_api'] = 'westcor';
                    $this->load->library('order/westcor');
                    $branchesData = $this->westcor->getBranches();
                    if ($branchesData === false) {
                        $branchesData = $this->westcor->getBranchesFromApi();
                    }
                    $orderDetails['agents_data'] = $branchesData;
                    $underWriter = 'westcor';
                } else if ($resPartners['Partners'][$key]['PartnerName'] == 'Commonwealth Land Title Insurance Company') {
                    $orderDetails['cpl_api'] = 'fnf';
                    $agentsData = $this->fnf->getAgents();
                    if ($agentsData === false) {
                        $orderDetails['email'] = $orderUser['email_address'];
                        $agentsData = $this->fnf->getAgentsFromApi($orderDetails);
                    }
                    $orderDetails['agents_data'] = $agentsData;
                    $underWriter = 'commonwealth';
                } else {
                    $orderDetails['cpl_api'] = 'westcor';
                    $this->load->library('order/westcor');
                    $branchesData = $this->westcor->getBranches();
                    if ($branchesData === false) {
                        $branchesData = $this->westcor->getBranchesFromApi();
                    }
                    $orderDetails['agents_data'] = $branchesData;
                }
                $underwriter_data = [
                    'underwriter' => $underWriter,
                ];
                $update_condition = [
                    'id' => $orderId,
                ];
                $this->order->update($underwriter_data, $update_condition);
            }*/
        // }
        if (!empty($orderDetails['borrowers_vesting'])) {
            $orderDetails['borrowers_vesting'] = $orderDetails['borrowers_vesting'];
        } else {
            if (!empty($orderDetails['primary_owner_name'])) {
                $orderDetails['borrowers_vesting'] = $orderDetails['primary_owner_name'];
            }

            if (!empty($orderDetails['secondary_owner_name'])) {
                $orderDetails['borrowers_vesting'] .= " " . $orderDetails['secondary_owner_name'];
            }

            if (!empty($orderDetails['vesting'])) {
                $orderDetails['borrowers_vesting'] .= " " . $orderDetails['vesting'];
            }
        }
        if (!empty($orderDetails['cpl_proposed_property_address'])) {
            $orderDetails['property_address'] = $orderDetails['cpl_proposed_property_address'];
            $orderDetails['property_city'] = $orderDetails['cpl_proposed_property_city'];
            $orderDetails['property_state'] = $orderDetails['cpl_proposed_property_state'];
            $orderDetails['property_zipcode'] = $orderDetails['cpl_proposed_property_zip'];
            $orderDetails['unit_number'] = '';
        } else {
            $orderDetails['property_address'] = $orderDetails['address'];
            $orderDetails['property_city'] = $orderDetails['property_city'];
            $orderDetails['property_state'] = $orderDetails['property_state'];
            $orderDetails['property_zipcode'] = $orderDetails['property_zip'];
        }
        $orderDetails['loan_amount'] = $orderDetails['loan_amount'] ? $orderDetails['loan_amount'] : '';
        $orderDetails['loan_number'] = $orderDetails['loan_number'] ? $orderDetails['loan_number'] : '';
        $response = array('status' => 'success', 'orderDetails' => $orderDetails);
        echo json_encode($response);exit;
    }

    public function createCPlForFnf()
    {
        $this->load->library('order/fnf');
        $this->load->model('order/home_model');
        $this->load->model('order/document');
        $errors = array();
        $success = array();
        $userdata = $this->session->userdata('user');
        if (empty($userdata)) {
            $userdata['id'] = 0;
        }
        $orderId = $this->uri->segment(2);
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        // $fileId = $orderDetails['file_id'];
        $vendorTokenData = $this->fnf->get_vendor_token();
        
        if ($vendorTokenData === false) {
            $vendorTokenData = $this->fnf->generateVendorToken($orderDetails);
        }
        $userTokenData = $this->fnf->get_user_token();
        
        if ($userTokenData === false) {
            $userTokenData = $this->fnf->generateUserToken($orderDetails);
            if (!$userTokenData) {
                $errors[] = "Authentication failed, Please try again.";
                $data = array(
                    "errors" => $errors,
                    "success" => $success,
                );
                $this->session->set_userdata($data);
                redirect(base_url() . 'cpl-dashboard');
            }
        }
        $oldOrderFlag = 0;
        
        if (!empty($orderDetails['created'])) {
            $date = new DateTime($orderDetails['created']);
            $date2 = new DateTime('2021-01-29 00:00:00');
            $diff = $date2->getTimestamp() - $date->getTimestamp();
            if ($diff > 0) {
                $oldOrderFlag = 1;
            }
        }
        
        if (!empty($orderDetails['fnf_document_id']) && $oldOrderFlag == 0) {
            $editCplResponse = $this->fnf->editCpl($orderDetails, $vendorTokenData, $userTokenData);
            if ($editCplResponse['success']) {
                $cplCount = $this->document->countCplDocument($orderDetails['order_id']);
                $document_name = "fnf_" . $cplCount . "_" . $orderId . ".pdf";
                if (!is_dir('uploads/cpl_documents')) {
                    mkdir('./uploads/cpl_documents', 0777, true);
                } else {
                    chmod('./uploads/cpl_documents', 0755);
                }
                file_put_contents('./uploads/cpl_documents/' . $document_name, base64_decode($editCplResponse['response']['a:Content']));
                $this->home_model->update(array('cpl_document_name' => $document_name, 'fnf_document_id' => $editCplResponse['response']['a:DocumentId']), array('id' => $orderId), 'order_details');
                $success[] = "CPL document edited successfully for file number - " . $orderDetails['file_number'];
                $this->order->uploadDocumentOnAwsS3($document_name, 'cpl_documents');
                // if ($orderDetails['is_softpro_order'] == 1) {
                    $this->order->uploadCPLDocumentToSoftpro($document_name, $orderDetails);
                // }
                //  else {
                //     $this->order->uploadCPLDocumentToResware($document_name, $orderDetails, $editCplResponse['response']['a:Content']);
                // }
                if (!empty($userdata) && $userdata['id'] == $orderDetails['title_officer']) {
                    $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['customer_id'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
                } else if (!empty($userdata) && $userdata['id'] == $orderDetails['customer_id']) {
                    $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['title_officer'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                } else {
                    $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['title_officer'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['customer_id'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
                }
            } else {
                $errors[] = $editCplResponse['error'] . "<br> We are aware of the Error generated by our CPL form and that our Customer service team will be contacting them shortly.";
                $cplErrorData = array(
                    'order_id' => $orderDetails['order_id'],
                    'file_number' => $orderDetails['file_number'],
                    'cpl_page' => $userdata['id'] > 0 ? 'Dashboard' : 'Generic Or Mail page',
                    'error' => $editCplResponse['error'],
                    'customer_id' => $orderDetails['customer_id'],
                    'property_address' => $orderDetails['full_address'],
                );
                $this->order->storeCplError($cplErrorData);
            }
            $data = array(
                "errors" => $errors,
                "success" => $success,
            );
        } else {
            $getCPLFormNameResponse = $this->fnf->getCPLForm($orderDetails, $vendorTokenData, $userTokenData);
            if ($getCPLFormNameResponse['success']) {
                $key = array_search('Lender', array_column($getCPLFormNameResponse['response'], 'a:RecipientType'));
                //$orderDetails['formname'] = $getCPLFormNameResponse['response'][$key]['a:FormName'];
                $orderDetails['formname'] = 'Standard CPL_' . $orderDetails['property_state'];
                $generateCplResponse = $this->fnf->generateCpl($orderDetails, $vendorTokenData, $userTokenData);

                if ($generateCplResponse['success']) {
                    $cplCount = $this->document->countCplDocument($orderDetails['order_id']);
                    $document_name = "fnf_". $orderDetails['file_number'] . '_' . $cplCount . ".pdf";
                    if (!is_dir('uploads/cpl_documents')) {
                        mkdir('./uploads/cpl_documents', 0777, true);
                    } else {
                        chmod('./uploads/cpl_documents', 0755);
                    }
                    file_put_contents('./uploads/cpl_documents/' . $document_name, base64_decode($generateCplResponse['response']['a:Content']));
                    $this->home_model->update(array('cpl_document_name' => $document_name, 'fnf_document_id' => $generateCplResponse['response']['a:DocumentId']), array('id' => $orderId), 'order_details');
                    $success[] = "Generated CPL request successfully for file number - " . $orderDetails['file_number'];
                    $this->order->uploadDocumentOnAwsS3($document_name, 'cpl_documents');
                    // $this->order->uploadCPLDocumentToResware($document_name, $orderDetails, $generateCplResponse['response']['a:Content']);
                    $this->order->uploadCPLDocumentToSoftpro($document_name, $orderDetails);
                    if (!empty($userdata) && $userdata['id'] == $orderDetails['title_officer']) {
                        $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                        $notificationData = array(
                            'sent_user_id' => $orderDetails['customer_id'],
                            'message' => $message,
                            'is_admin' => 0,
                            'type' => 'created',
                        );
                        $this->home_model->insert($notificationData, 'pct_order_notifications');
                        $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
                    } else if (!empty($userdata) && $userdata['id'] == $orderDetails['customer_id']) {
                        $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                        $notificationData = array(
                            'sent_user_id' => $orderDetails['title_officer'],
                            'message' => $message,
                            'is_admin' => 0,
                            'type' => 'created',
                        );
                        $this->home_model->insert($notificationData, 'pct_order_notifications');
                        $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                    } else {
                        $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                        $notificationData = array(
                            'sent_user_id' => $orderDetails['title_officer'],
                            'message' => $message,
                            'is_admin' => 0,
                            'type' => 'created',
                        );
                        $this->home_model->insert($notificationData, 'pct_order_notifications');
                        $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                        $notificationData = array(
                            'sent_user_id' => $orderDetails['customer_id'],
                            'message' => $message,
                            'is_admin' => 0,
                            'type' => 'created',
                        );
                        $this->home_model->insert($notificationData, 'pct_order_notifications');
                        $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
                    }
                } else {
                    $errors[] = $generateCplResponse['error'] . "<br> We are aware of the Error generated by our CPL form and that our Customer service team will be contacting them shortly.";
                    $cplErrorData = array(
                        'order_id' => $orderDetails['order_id'],
                        'file_number' => $orderDetails['file_number'],
                        'cpl_page' => $userdata['id'] > 0 ? 'Dashboard' : 'Generic Or Mail page',
                        'error' => $generateCplResponse['error'],
                        'customer_id' => $orderDetails['customer_id'],
                        'property_address' => $orderDetails['full_address'],
                    );
                    $this->order->storeCplError($cplErrorData);
                }
                $data = array(
                    "errors" => $errors,
                    "success" => $success,
                );
            } else {
                $errors[] = $getCPLFormNameResponse['error'] . "<br> We are aware of the Error generated by our CPL form and that our Customer service team will be contacting them shortly.";
                $cplErrorData = array(
                    'order_id' => $orderDetails['order_id'],
                    'file_number' => $orderDetails['file_number'],
                    'cpl_page' => $userdata['id'] > 0 ? 'Dashboard' : 'Generic Or Mail page',
                    'error' => $getCPLFormNameResponse['error'],
                    'customer_id' => $orderDetails['customer_id'],
                    'property_address' => $orderDetails['full_address'],
                );
                $this->order->storeCplError($cplErrorData);
                $data = array(
                    "errors" => $errors,
                    "success" => $success,
                );
            }
        }
        $this->session->unset_userdata('lender_details');
        $this->session->set_userdata($data);
        if (!empty($userdata['id'])) {
            redirect(base_url() . 'cpl-dashboard');
        } else {
            redirect(base_url() . 'generate-cpl/' . $orderDetails['random_number']);
        }
    }

    public function createCPlForNatic()
    {
        $this->load->library('order/natic');
        $this->load->model('order/home_model');
        $this->load->model('order/document');
        $errors = array();
        $success = array();
        $userdata = $this->session->userdata('user');
        if (empty($userdata)) {
            $userdata['id'] = 0;
        }
        $fileId = $this->uri->segment(2);
        $currentRoute = $this->uri->segment(1);
        $cplApi = ($currentRoute === 'create-cpl-for-doma') ? 'doma' : 'natic';

        $orderDetails = $this->order->get_order_details($fileId);
        $responseArr = $this->natic->getDocumentContentForCpl($fileId, $orderDetails, $cplApi);
        if ($responseArr['success']) {
            $cplCount = $this->document->countCplDocument($orderDetails['order_id']);
            $document_name = $cplApi . "_" . $cplCount . "_" . $fileId . ".pdf";
            if (!is_dir('uploads/cpl_documents')) {
                mkdir('./uploads/cpl_documents', 0777, true);
            } else {
                chmod('./uploads/cpl_documents', 0755);
            }
            file_put_contents('./uploads/cpl_documents/' . $document_name, base64_decode($responseArr['content']));
            $this->home_model->update(array('cpl_document_name' => $document_name), array('file_id' => $fileId), 'order_details');
            $success[] = "Generated CPL request successfully for file number - " . $orderDetails['file_number'];
            $this->order->uploadCPLDocumentToResware($document_name, $orderDetails, $responseArr['content']);
            $this->order->uploadDocumentOnAwsS3($document_name, 'cpl_documents');
            if (!empty($userdata) && $userdata['id'] == $orderDetails['title_officer']) {
                $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                $notificationData = array(
                    'sent_user_id' => $orderDetails['customer_id'],
                    'message' => $message,
                    'is_admin' => 0,
                    'type' => 'created',
                );
                $this->home_model->insert($notificationData, 'pct_order_notifications');
                $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
            } else if (!empty($userdata) && $userdata['id'] == $orderDetails['customer_id']) {
                $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                $notificationData = array(
                    'sent_user_id' => $orderDetails['title_officer'],
                    'message' => $message,
                    'is_admin' => 0,
                    'type' => 'created',
                );
                $this->home_model->insert($notificationData, 'pct_order_notifications');
                $this->order->sendNotification($message, 'assigned', $orderDetails['title_officer'], 0);
            } else {
                $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
                $notificationData = array(
                    'sent_user_id' => $orderDetails['title_officer'],
                    'message' => $message,
                    'is_admin' => 0,
                    'type' => 'created',
                );
                $this->home_model->insert($notificationData, 'pct_order_notifications');
                $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                $notificationData = array(
                    'sent_user_id' => $orderDetails['customer_id'],
                    'message' => $message,
                    'is_admin' => 0,
                    'type' => 'created',
                );
                $this->home_model->insert($notificationData, 'pct_order_notifications');
                $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
            }
        } else {
            $errors[] = $responseArr['error'] . "<br> We are aware of the Error generated by our CPL form and that our Customer service team will be contacting them shortly.";
            $cplErrorData = array(
                'order_id' => $orderDetails['order_id'],
                'file_number' => $orderDetails['file_number'],
                'cpl_page' => $userdata['id'] > 0 ? 'Dashboard' : 'Generic Or Mail page',
                'error' => $responseArr['error'],
                'customer_id' => $orderDetails['customer_id'],
                'property_address' => $orderDetails['full_address'],
            );
            $this->order->storeCplError($cplErrorData);
        }
        $data = array(
            "errors" => $errors,
            "success" => $success,
        );
        $this->session->set_userdata($data);
        $this->session->unset_userdata('lender_details');
        if (!empty($userdata['id'])) {
            redirect(base_url() . 'cpl-dashboard');
        } else {
            redirect(base_url() . 'generate-cpl/' . $orderDetails['random_number']);
        }
    }

    /*public function createCPlForDoma()
    {
    $this->load->library('order/doma');
    $this->load->model('order/home_model');
    $this->load->model('order/document');
    $errors = array();
    $success = array();
    $userdata = $this->session->userdata('user');
    if (empty($userdata)) {
    $userdata['id'] = 0;
    }
    $fileId = $this->uri->segment(2);
    $orderDetails = $this->order->get_order_details($fileId);
    $responseArr = $this->doma->getDocumentContentForCpl($fileId, $orderDetails);
    if ($responseArr['success']) {
    $cplCount = $this->document->countCplDocument($orderDetails['order_id']);
    $document_name = "doma_" . $cplCount . "_" . $fileId . ".pdf";
    if (!is_dir('uploads/documents')) {
    mkdir('./uploads/documents', 0777, true);
    }
    file_put_contents('./uploads/documents/' . $document_name, base64_decode($responseArr['content']));
    $this->home_model->update(array('cpl_document_name' => $document_name), array('file_id' => $fileId), 'order_details');
    $success[] = "Generated CPL request successfully for file number - " . $orderDetails['file_number'];
    $this->order->uploadCPLDocumentToResware($document_name, $orderDetails, $responseArr['content']);
    $this->order->uploadDocumentOnAwsS3($document_name, 'documents');
    if (!empty($userdata) && $userdata['id'] == $orderDetails['title_officer']) {
    $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
    $notificationData = array(
    'sent_user_id' => $orderDetails['customer_id'],
    'message' => $message,
    'is_admin' => 0,
    'type' => 'created',
    );
    $this->home_model->insert($notificationData, 'pct_order_notifications');
    $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
    } else if (!empty($userdata) && $userdata['id'] == $orderDetails['customer_id']) {
    $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
    $notificationData = array(
    'sent_user_id' => $orderDetails['title_officer'],
    'message' => $message,
    'is_admin' => 0,
    'type' => 'created',
    );
    $this->home_model->insert($notificationData, 'pct_order_notifications');
    $this->order->sendNotification($message, 'assigned', $orderDetails['title_officer'], 0);
    } else {
    $message = 'CPL document generated for order number #' . $orderDetails['file_number'];
    $notificationData = array(
    'sent_user_id' => $orderDetails['title_officer'],
    'message' => $message,
    'is_admin' => 0,
    'type' => 'created',
    );
    $this->home_model->insert($notificationData, 'pct_order_notifications');
    $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
    $notificationData = array(
    'sent_user_id' => $orderDetails['customer_id'],
    'message' => $message,
    'is_admin' => 0,
    'type' => 'created',
    );
    $this->home_model->insert($notificationData, 'pct_order_notifications');
    $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
    }
    } else {
    $errors[] = $responseArr['error'] . "<br> We are aware of the Error generated by our CPL form and that our Customer service team will be contacting them shortly.";
    $cplErrorData = array(
    'order_id' => $orderDetails['order_id'],
    'file_number' => $orderDetails['file_number'],
    'cpl_page' => $userdata['id'] > 0 ? 'Dashboard' : 'Generic Or Mail page',
    'error' => $responseArr['error'],
    'customer_id' => $orderDetails['customer_id'],
    'property_address' => $orderDetails['full_address'],
    );
    $this->order->storeCplError($cplErrorData);
    }
    $data = array(
    "errors" => $errors,
    "success" => $success,
    );
    $this->session->set_userdata($data);
    $this->session->unset_userdata('lender_details');
    if (!empty($userdata['id'])) {
    redirect(base_url() . 'cpl-dashboard');
    } else {
    redirect(base_url() . 'generate-cpl/' . $orderDetails['random_number']);
    }
    }*/

    public function getDetailsByName()
    {
        $searchTerm = isset($_POST['term']) && !empty($_POST['term']) ? $_POST['term'] : '';
        $is_master_search = isset($_POST['is_master_search']) && !empty($_POST['is_master_search']) ? $_POST['is_master_search'] : 0;
        $condition = array(
            'company_name' => $searchTerm,
        );

        if (isset($_POST['is_escrow'])) {
            $isEscrow = $_POST['is_escrow'];
            $condition['is_escrow'] = $isEscrow;
        }

        $condition['where']['is_sales_rep'] = 0;
        $is_from_order_form = $this->input->post('is_from_order_form');
        $condition['is_from_order_form'] = isset($is_from_order_form) && !empty($is_from_order_form) ? $is_from_order_form : 0;
        $userDetails = $this->home_model->get_sp_customers($condition, $is_master_search);
        // echo "<pre>";
        // print_r($userDetails);die;
        $userInfo = array();

        if (isset($userDetails) && !empty($userDetails)) {
            foreach ($userDetails as $key => $value) {
                $data['id'] = isset($value['id']) && !empty($value['id']) ? $value['id'] : '';
                $data['value'] = isset($value['value']) && !empty($value['value']) ? $value['value'] : '';
                $data['lookup_code'] = isset($value['lookup_code']) && !empty($value['lookup_code']) ? $value['lookup_code'] : '';
                $data['flookup_code'] = isset($value['flookup_code']) && !empty($value['flookup_code']) ? $value['flookup_code'] : '';
                // $data['partner_id'] = isset($value['partner_id']) && !empty($value['partner_id']) ? $value['partner_id'] : '';
                $data['name'] = isset($value['full_name']) && !empty($value['full_name']) ? $value['full_name'] : '';
                $data['fname'] = isset($value['first_name']) && !empty($value['first_name']) ? $value['first_name'] : '';
                $data['lname'] = isset($value['last_name']) && !empty($value['last_name']) ? $value['last_name'] : '';
                $data['email_address'] = isset($value['email_address']) && !empty($value['email_address']) ? $value['email_address'] : '';
                $data['telephone_no'] = isset($value['phone']) && !empty($value['phone']) ? $value['phone'] : '';
                $data['company'] = isset($value['company_name']) && !empty($value['company_name']) ? $value['company_name'] : '';
                $data['address'] = isset($value['address1']) && !empty($value['address1']) ? $value['address1'] : '';
                // $data['address'] = isset($value['street_address']) && !empty($value['street_address']) ? $value['street_address'] : '';
                $data['city'] = isset($value['city']) && !empty($value['city']) ? $value['city'] : '';
                $data['state'] = isset($value['state']) && !empty($value['state']) ? $value['state'] : '';
                $data['zip_code'] = isset($value['zip']) && !empty($value['zip']) ? $value['zip'] : '';
                $data['is_escrow'] = isset($value['is_escrow']) && !empty($value['is_escrow']) ? $value['is_escrow'] : '';
                $data['is_lender'] = isset($value['is_lender']) && !empty($value['is_lender']) ? $value['is_lender'] : '';
                $data['is_selling_agent'] = isset($value['is_selling_agent']) && !empty($value['is_selling_agent']) ? $value['is_selling_agent'] : '';
                $data['is_mortgage_broker'] = isset($value['is_mortgage_broker']) && !empty($value['is_mortgage_broker']) ? $value['is_mortgage_broker'] : '';
                $data['assignment_clause'] = isset($value['assignment_clause']) && !empty($value['assignment_clause']) ? $value['assignment_clause'] : '';
                $data['is_primary_mortgage_user'] = isset($value['is_mortgage_broker']) && !empty($value['is_mortgage_broker']) ? $value['is_mortgage_broker'] : '';
                $data['title_officer_id'] = isset($value['title_officer_id']) && !empty($value['title_officer_id']) ? $value['title_officer_id'] : '';
                $data['sales_rep_id'] = isset($value['sales_rep_id']) && !empty($value['sales_rep_id']) ? $value['sales_rep_id'] : '';
                $data['client_type'] = '';
                $clientTypeOption = '';
                if (!empty($data['is_escrow'])) {
                    $data['client_type'] = 'EscrowCompany';
                    $clientTypeOption .= '<option value="EscrowCompany"> Escrow Company </option>';
                } 
                if (!empty($data['is_lender'])) {
                    $data['client_type'] = 'Lender';
                    $clientTypeOption .= '<option value="Lender"> Lender </option>';
                } 
                if (!empty($data['is_selling_agent'])) {
                    $data['client_type'] = 'ListingAgentBroker';
                    $clientTypeOption .= '<option value="ListingAgentBroker"> Listing Agent Broker </option>';
                }
                if (!empty($data['is_mortgage_broker'])) {
                    $data['client_type'] = 'MortgageBroker';
                    $clientTypeOption .= '<option value="MortgageBroker"> Mortgage Broker </option>';
                }
                $data['client_type_option'] = $clientTypeOption;
                // array_push($userInfo, $data);
                $userInfo[] = $data;
            }
        }
        echo json_encode($userInfo);
    }

    public function getSoftproCompanyByName()
    {
        $searchTerm = isset($_POST['term']) && !empty($_POST['term']) ? $_POST['term'] : '';
        $is_master_search = isset($_POST['is_master_search']) && !empty($_POST['is_master_search']) ? $_POST['is_master_search'] : 0;
        $condition = array(
            'name' => $searchTerm,
        );

        if (isset($_POST['is_escrow_company'])) {
            $isEscrow = $_POST['is_escrow_company'];
            $condition['is_escrow_company'] = $isEscrow;
        }
        if (isset($_POST['is_lender'])) {
            $isEscrow = $_POST['is_lender'];
            $condition['is_lender'] = $isEscrow;
        }

        if (isset($_POST['is_mortgage_broker'])) {
            $isEscrow = $_POST['is_mortgage_broker'];
            $condition['is_mortgage_broker'] = $isEscrow;
        }

        if (isset($_POST['is_selling_agent'])) {
            $isEscrow = $_POST['is_selling_agent'];
            $condition['is_selling_agent'] = $isEscrow;
        }

        $compnayDetails = $this->home_model->get_sp_companies($condition, $is_master_search);
        // echo "<pre>";
        // print_r($compnayDetails);die;
        $userInfo = array();

        if (isset($compnayDetails) && !empty($compnayDetails)) {
            foreach ($compnayDetails as $key => $value) {
                $data['id'] = isset($value['id']) && !empty($value['id']) ? $value['id'] : '';
                $data['value'] = isset($value['value']) && !empty($value['value']) ? $value['value'] : '';
                $data['lookup_code'] = isset($value['lookup_code']) && !empty($value['lookup_code']) ? $value['lookup_code'] : '';
                $data['flookup_code'] = isset($value['flookup_code']) && !empty($value['flookup_code']) ? $value['flookup_code'] : '';
                $data['name'] = isset($value['full_name']) && !empty($value['full_name']) ? $value['full_name'] : '';
                $data['email_address'] = isset($value['email_address']) && !empty($value['email_address']) ? $value['email_address'] : '';
                $data['telephone_no'] = isset($value['phone']) && !empty($value['phone']) ? $value['phone'] : '';
                $data['company'] = isset($value['full_name']) && !empty($value['full_name']) ? $value['full_name'] : '';
                $data['address'] = isset($value['address1']) && !empty($value['address1']) ? $value['address1'] : '';
                // $data['address'] = isset($value['street_address']) && !empty($value['street_address']) ? $value['street_address'] : '';
                $data['city'] = isset($value['city']) && !empty($value['city']) ? $value['city'] : '';
                $data['state'] = isset($value['state']) && !empty($value['state']) ? $value['state'] : '';
                $data['zip_code'] = isset($value['zip']) && !empty($value['zip']) ? $value['zip'] : '';
                $data['is_escrow_company'] = isset($value['is_escrow_company']) && !empty($value['is_escrow_company']) ? $value['is_escrow_company'] : '';
                $data['is_lender'] = isset($value['is_lender']) && !empty($value['is_lender']) ? $value['is_lender'] : '';
                $data['is_selling_agent'] = isset($value['is_selling_agent']) && !empty($value['is_selling_agent']) ? $value['is_selling_agent'] : '';
                $data['is_mortgage_broker'] = isset($value['is_mortgage_broker']) && !empty($value['is_mortgage_broker']) ? $value['is_mortgage_broker'] : '';
                $data['assignment_clause'] = isset($value['assignment_clause']) && !empty($value['assignment_clause']) ? $value['assignment_clause'] : '';
                // $data['title_officer_id'] = isset($value['title_officer_id']) && !empty($value['title_officer_id']) ? $value['title_officer_id'] : '';
                // $data['sales_rep_id'] = isset($value['sales_rep_id']) && !empty($value['sales_rep_id']) ? $value['sales_rep_id'] : '';
                $data['client_type'] = '';
                $clientTypeOption = '';
                if (!empty($data['is_escrow_company'])) {
                    $data['client_type'] = 'EscrowCompany';
                    $clientTypeOption .= '<option value="EscrowCompany"> Escrow Company </option>';
                } 
                if (!empty($data['is_lender'])) {
                    $data['client_type'] = 'Lender';
                    $clientTypeOption .= '<option value="Lender"> Lender </option>';
                } 
                if (!empty($data['is_selling_agent'])) {
                    $data['client_type'] = 'ListingAgentBroker';
                    $clientTypeOption .= '<option value="ListingAgentBroker"> Listing Agent Broker </option>';
                }
                if (!empty($data['is_mortgage_broker'])) {
                    $data['client_type'] = 'MortgageBroker';
                    $clientTypeOption .= '<option value="MortgageBroker"> Mortgage Broker </option>';
                }
                $data['client_type_option'] = $clientTypeOption;
                // array_push($userInfo, $data);
                $userInfo[] = $data;
            }
        }
        echo json_encode($userInfo);
    }

    public function getDetailsFromLookup()
    {
        $searchTerm = isset($_POST['term']) && !empty($_POST['term']) ? $_POST['term'] : '';
        $is_master_search = isset($_POST['is_master_search']) && !empty($_POST['is_master_search']) ? $_POST['is_master_search'] : 0;
        $condition = array(
            'name' => $searchTerm,
        );

        if (isset($_POST['is_escrow']) && $_POST['is_escrow'] == 1) {
            $condition['user_type'] = 'escrow';
        }

        // $condition['where']['is_sales_rep'] = 0;
        $is_from_order_form = $this->input->post('is_from_order_form');
        $condition['is_from_order_form'] = isset($is_from_order_form) && !empty($is_from_order_form) ? $is_from_order_form : 0;
        $userDetails = $this->home_model->get_lookup_customers($condition, $is_master_search);
        $userInfo = array();

        if (isset($userDetails) && !empty($userDetails)) {
            foreach ($userDetails as $key => $value) {
                $data['id'] = isset($value['id']) && !empty($value['id']) ? $value['id'] : '';
                $data['lookup_code'] = isset($value['lookup_code']) && !empty($value['lookup_code']) ? $value['lookup_code'] : '';
                $data['flookup_code'] = isset($value['flookup_code']) && !empty($value['flookup_code']) ? $value['flookup_code'] : '';
                $data['fname'] = isset($value['first_name']) && !empty($value['first_name']) ? $value['first_name'] : '';
                $data['lname'] = isset($value['last_name']) && !empty($value['last_name']) ? $value['last_name'] : '';
                $data['name'] = $data['fname'] . ' ' . $data['lname'];
                $data['email_address'] = isset($value['email_address']) && !empty($value['email_address']) ? $value['email_address'] : '';
                $data['value'] = $data['fname'] . ' ' . $data['lname'];
                if (!empty($data['email_address'])) {
                    $data['value'] = $data['value'] . '-' . $data['email_address'];
                }
                $data['telephone_no'] = isset($value['phone']) && !empty($value['phone']) ? $value['phone'] : '';
                $data['address'] = isset($value['address1']) && !empty($value['address1']) ? $value['address1'] : '';
                $data['city'] = isset($value['city']) && !empty($value['city']) ? $value['city'] : '';
                $data['state'] = isset($value['state']) && !empty($value['state']) ? $value['state'] : '';
                $data['zip'] = isset($value['zip']) && !empty($value['zip']) ? $value['zip'] : '';

                // $data['sales_rep_id'] = isset($value['sales_rep_id']) && !empty($value['sales_rep_id']) ? $value['sales_rep_id'] : '';
                // array_push($userInfo, $data);
                $userInfo[] = $data;
            }
        }
        echo json_encode($userInfo);
    }

    public function downloadAwsDocument()
    {
        $userdata = $this->session->userdata('user');
        $url = $this->input->post('url');
        $user_data['admin_api'] = 1;
        $api_document_id = $this->input->post('api_document_id');
        $binaryData = base64_encode(file_get_contents($url));
        /*$this->load->model('order/document');
        if (empty($binaryData) && !empty($api_document_id)) {
            $endPoint = 'documents/' . $api_document_id . '?format=json';
            $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), array(), 0, 0);
            $resultDocument = $this->resware->make_request('GET', $endPoint, '', $user_data);
            $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_document', env('RESWARE_ORDER_API') . $endPoint, array(), $resultDocument, 0, $logid);
            $resDocument = json_decode($resultDocument, true);
            if (isset($resDocument['Document']) && !empty($resDocument['Document'])) {
                $binaryData = $resDocument['Document']['DocumentBody'];
                $documentContent = base64_decode($resDocument['Document']['DocumentBody'], true);
                $document_name = str_replace(env('AWS_PATH') . "documents/", '', $url);
                if (!is_dir('uploads/documents')) {
                    mkdir('./uploads/documents', 0777, true);
                }
                file_put_contents('./uploads/documents/' . $document_name, $documentContent);
                $this->order->uploadDocumentOnAwsS3($document_name, 'documents');
                $this->document->update(array('is_sync' => 1), array('api_document_id' => $api_document_id));
            }
        }*/
        echo $binaryData;exit;
    }

    public function generate_proposed_insured()
    {
        $orderId = isset($_POST['orderId']) && !empty($_POST['orderId']) ? $_POST['orderId'] : '';
        // $data['fileId'] = $fileId;
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        $orderId = isset($orderDetails['order_id']) && !empty($orderDetails['order_id']) ? $orderDetails['order_id'] : '';
        $data['orderId'] = $orderId;
        $transaction_id = isset($orderDetails['transaction_id']) && !empty($orderDetails['transaction_id']) ? $orderDetails['transaction_id'] : '';
        $data['transaction_id'] = $transaction_id;
        $vesting = isset($orderDetails['vesting']) && !empty($orderDetails['vesting']) ? $orderDetails['vesting'] : '';
        $data['vesting'] = $vesting;
        $property_id = isset($orderDetails['property_id']) && !empty($orderDetails['property_id']) ? $orderDetails['property_id'] : '';
        $data['property_id'] = $property_id;
        $customer_id = isset($orderDetails['customer_id']) && !empty($orderDetails['customer_id']) ? $orderDetails['customer_id'] : '';
        $this->load->model('order/home_model');
        $customer_data = $this->home_model->sp_get_user(array('id' => $customer_id));
        $data['company'] = isset($customer_data['company_name']) && !empty($customer_data['company_name']) ? $customer_data['company_name'] : '';
        $address = array();
        $street_address = isset($customer_data['address1']) && !empty($customer_data['address1']) ? $customer_data['address1'] : '';
        if ($street_address) {
            $address[] = $street_address;
        }
        $city = isset($customer_data['city']) && !empty($customer_data['city']) ? $customer_data['city'] : '';
        if ($city) {
            $address[] = $city;
        }

        $zip_code = isset($customer_data['zip']) && !empty($customer_data['zip']) ? $customer_data['zip'] : '';
        if ($zip_code) {
            $address[] = $zip_code;
        }
        $data['address'] = implode(', ', $address);
        $data['order_number'] = isset($orderDetails['file_number']) && !empty($orderDetails['file_number']) ? $orderDetails['file_number'] : '';
        $data['property_address'] = isset($orderDetails['full_address']) && !empty($orderDetails['full_address']) ? $orderDetails['full_address'] : '';
        $data['sales_amount'] = isset($orderDetails['sales_amount']) && !empty($orderDetails['sales_amount']) ? $orderDetails['sales_amount'] : '';
        $data['loan_amount'] = isset($orderDetails['loan_amount']) && !empty($orderDetails['loan_amount']) ? $orderDetails['loan_amount'] : '';
        $data['loan_number'] = isset($orderDetails['loan_number']) && !empty($orderDetails['loan_number']) ? $orderDetails['loan_number'] : '';
        $data['title_officer'] = isset($orderDetails['title_officer']) && !empty($orderDetails['title_officer']) ? $orderDetails['title_officer'] : '';

        if ($orderDetails['sales_amount'] > 0) {
            if (!empty($orderDetails['borrower'])) {
                $orderDetails['primary_owner_name'] = $orderDetails['borrower'];
            } else {
                $orderDetails['primary_owner_name'] = '';
            }

            if (!empty($orderDetails['secondary_borrower'])) {
                $orderDetails['secondary_owner_name'] = $orderDetails['secondary_borrower'];
            } else {
                $orderDetails['secondary_owner_name'] = '';
            }
        } else {
            if (!empty($orderDetails['primary_owner'])) {
                $orderDetails['primary_owner_name'] = $orderDetails['primary_owner'];
            } else {
                $orderDetails['primary_owner_name'] = '';
            }

            if (!empty($orderDetails['secondary_owner'])) {
                $orderDetails['secondary_owner_name'] = $orderDetails['secondary_owner'];
            } else {
                $orderDetails['secondary_owner_name'] = '';
            }
        }

        if (!empty($orderDetails['borrowers_vesting'])) {
            $orderDetails['borrowers_vesting'] = $orderDetails['borrowers_vesting'];
        } else {
            if (!empty($orderDetails['primary_owner_name'])) {
                $orderDetails['borrowers_vesting'] = $orderDetails['primary_owner_name'];
            }

            if (!empty($orderDetails['secondary_owner_name'])) {
                $orderDetails['borrowers_vesting'] .= " " . $orderDetails['secondary_owner_name'];
            }

            if (!empty($orderDetails['vesting'])) {
                $orderDetails['borrowers_vesting'] .= " " . $orderDetails['vesting'];
            }
        }
        $data['borrowers_vesting'] = $orderDetails['borrowers_vesting'];

        /* property address */
        if (!empty($orderDetails['cpl_proposed_property_address'])) {
            $data['street_address'] = isset($orderDetails['cpl_proposed_property_address']) && !empty($orderDetails['cpl_proposed_property_address']) ? $orderDetails['cpl_proposed_property_address'] : '';
        } else {
            $data['street_address'] = isset($orderDetails['address']) && !empty($orderDetails['address']) ? $orderDetails['address'] : '';
        }

        if (!empty($orderDetails['cpl_proposed_property_city'])) {
            $data['property_city'] = isset($orderDetails['cpl_proposed_property_city']) && !empty($orderDetails['cpl_proposed_property_city']) ? $orderDetails['cpl_proposed_property_city'] : '';
        } else {
            $data['property_city'] = isset($orderDetails['property_city']) && !empty($orderDetails['property_city']) ? $orderDetails['property_city'] : '';
        }

        if (!empty($orderDetails['cpl_proposed_property_state'])) {
            $data['property_state'] = isset($orderDetails['cpl_proposed_property_state']) && !empty($orderDetails['cpl_proposed_property_state']) ? $orderDetails['cpl_proposed_property_state'] : '';
        } else {
            $data['property_state'] = isset($orderDetails['property_state']) && !empty($orderDetails['property_state']) ? $orderDetails['property_state'] : '';
        }

        if (!empty($orderDetails['cpl_proposed_property_zip'])) {
            $data['property_zip'] = isset($orderDetails['cpl_proposed_property_zip']) && !empty($orderDetails['cpl_proposed_property_zip']) ? $orderDetails['cpl_proposed_property_zip'] : '';
        } else {
            $data['property_zip'] = isset($orderDetails['property_zip']) && !empty($orderDetails['property_zip']) ? $orderDetails['property_zip'] : '';
        }
        /* property address */

        if (!empty($orderDetails['supplemental_report_date']) && $orderDetails['supplemental_report_date'] != '0000-00-00') {
            $s_report_date = date("m/d/Y", strtotime($orderDetails['supplemental_report_date']));
        }

        $data['supplemental_report_date'] = isset($s_report_date) && !empty($s_report_date) ? $s_report_date : '';

        if (!empty($orderDetails['preliminary_report_date']) && $orderDetails['preliminary_report_date'] != '0000-00-00') {
            $p_report_date = date("m/d/Y", strtotime($orderDetails['preliminary_report_date']));
        }
        $data['preliminary_report_date'] = isset($p_report_date) && !empty($p_report_date) ? $p_report_date : '';

        $data['is_escrow'] = $customer_data['is_escrow'];
        $data['proposed_branch_id'] = $orderDetails['proposed_branch_id'];

        if ($customer_data['is_escrow'] == 1) {
            if (!empty($orderDetails['cpl_lender_company_id'])) {
                // $lenderDetails = $this->home_model->sp_get_user(array('id' => $orderDetails['cpl_lender_id']));
                $lenderDetails = $this->home_model->get_sp_company(array('id' => $orderDetails['cpl_lender_company_id']));
                // $data['lender_first_name'] = $lenderDetails['first_name'] ? $lenderDetails['first_name'] : '';
                // $data['lender_last_name'] = $lenderDetails['last_name'] ? $lenderDetails['last_name'] : '';
                // $data['lender_email'] = $lenderDetails['email_address'] ? $lenderDetails['email_address'] : '';
                // $data['lender_company_name'] = $lenderDetails['company_name'] ? $lenderDetails['company_name'] : '';
                $data['lender_company_name'] = $lenderDetails['name'] ? $lenderDetails['name'] : '';
                $data['lender_company_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
                $data['lender_company_lookup_code'] = $lenderDetails['lookup_code'] ? $lenderDetails['lookup_code'] : '';
                $data['lender_address'] = $lenderDetails['address1'] ? $lenderDetails['address1'] : '';
                $data['lender_city'] = $lenderDetails['city'] ? $lenderDetails['city'] : '';
                $data['lender_state'] = $lenderDetails['state'] ? $lenderDetails['state'] : '';
                $data['lender_zipcode'] = $lenderDetails['zip'] ? $lenderDetails['zip'] : '';
                $data['lender_assignment_clause'] = $lenderDetails['assignment_clause'] ? $lenderDetails['assignment_clause'] : '';
                $data['cpl_lender_company_id'] = $orderDetails['cpl_lender_company_id'];
                // $data['lender_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
                // $data['escrow_lender_id'] = '';
            } else {
                // $data['escrow_lender_id'] = $orderDetails['escrow_lender_id'] ? $orderDetails['escrow_lender_id'] : '';
                // $data['lender_first_name'] = $orderDetails['sp_lender_first_name'] ? $orderDetails['sp_lender_first_name'] : '';
                // $data['lender_last_name'] = $orderDetails['sp_lender_last_name'] ? $orderDetails['sp_lender_last_name'] : '';
                // $data['lender_email'] = ''; //$orderDetails['sp_lender_email'] ? $orderDetails['sp_lender_email'] : '';
                $data['lender_company_name'] = '';//$orderDetails['sp_lender_company_name'] ? $orderDetails['sp_lender_company_name'] : '';
                $data['lender_address'] = '';// $orderDetails['sp_lender_address'] ? $orderDetails['sp_lender_address'] : '';
                $data['lender_city'] = '';// $orderDetails['sp_lender_city'] ? $orderDetails['sp_lender_city'] : '';
                $data['lender_state'] = '';// $orderDetails['sp_lender_state'] ? $orderDetails['sp_lender_state'] : '';
                $data['lender_zipcode'] = '';// $orderDetails['sp_lender_zipcode'] ? $orderDetails['sp_lender_zipcode'] : '';
                $data['lender_assignment_clause'] = '';// $orderDetails['lender_assignment_clause'] ? $orderDetails['lender_assignment_clause'] : '';
                // $data['lender_id'] = '';// $orderDetails['lender_id'] ? $orderDetails['sp_lender_id'] : '';
                $data['cpl_lender_company_id'] = '';
            }
        } else {
            if (!empty($orderDetails['cpl_lender_company_id'])) {
                // $lenderDetails = $this->home_model->sp_get_user(array('id' => $orderDetails['cpl_lender_id']));
                $lenderDetails = $this->home_model->get_sp_company(array('id' => $orderDetails['cpl_lender_company_id']));

                // $data['lender_first_name'] = $lenderDetails['first_name'] ? $lenderDetails['first_name'] : '';
                // $data['lender_last_name'] = $lenderDetails['last_name'] ? $lenderDetails['last_name'] : '';
                // $data['lender_email'] = $lenderDetails['email_address'] ? $lenderDetails['email_address'] : '';
                $data['lender_company_name'] = $lenderDetails['name'] ? $lenderDetails['name'] : '';
                $data['lender_company_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
                $data['lender_company_lookup_code'] = $lenderDetails['lookup_code'] ? $lenderDetails['lookup_code'] : '';
                $data['lender_address'] = $lenderDetails['address1'] ? $lenderDetails['address1'] : '';
                $data['lender_state'] = $lenderDetails['state'] ? $lenderDetails['state'] : '';
                $data['lender_city'] = $lenderDetails['city'] ? $lenderDetails['city'] : '';
                $data['lender_zipcode'] = $lenderDetails['zip'] ? $lenderDetails['zip'] : '';
                $data['lender_assignment_clause'] = $lenderDetails['assignment_clause'] ? $lenderDetails['assignment_clause'] : '';
                // $data['lender_id'] = $lenderDetails['id'] ? $lenderDetails['id'] : '';
                $data['cpl_lender_company_id'] = $orderDetails['cpl_lender_company_id'];
                
            } else {
                // $data['cpl_lender_id'] = $customer_data['id'];
                // $data['lender_first_name'] = $customer_data['first_name'] ? $customer_data['first_name'] : '';
                // $data['lender_last_name'] = $customer_data['last_name'] ? $customer_data['last_name'] : '';
                // $data['lender_email'] = '';// $customer_data['email_address'] ? $customer_data['email_address'] : '';
                $data['lender_company_name'] = '';// $customer_data['company_name'] ? $customer_data['company_name'] : '';
                $data['lender_company_id'] = '';
                $data['lender_company_lookup_code'] = '';
                $data['lender_address'] = '';// $customer_data['address1'] ? $customer_data['address1'] : '';
                $data['lender_city'] = '';// $customer_data['city'] ? $customer_data['city'] : '';
                $data['lender_state'] = '';// $customer_data['state'] ? $customer_data['state'] : '';
                $data['lender_zipcode'] = '';// $customer_data['zip'] ? $customer_data['zip'] : '';
                $data['lender_assignment_clause'] = '';// $customer_data['assignment_clause'] ? $customer_data['assignment_clause'] : '';
                // $data['lender_id'] = '';// $customer_data['id'] ? $customer_data['id'] : '';
                $data['lender_company_id'] = '';
            }
            $orderUser = $this->home_model->sp_get_user(array('id' => $orderDetails['customer_id']));
        }

        // if (empty($data['lender_first_name']) && empty($data['lender_last_name'])) {
        //     $data['lender_name'] = '';
        // } else if (empty($data['lender_first_name']) && !empty($data['lender_last_name'])) {
        //     $data['lender_name'] = $data['lender_last_name'];
        // } else if (!empty($data['lender_first_name']) && empty($data['lender_last_name'])) {
        //     $data['lender_name'] = $data['lender_first_name'];
        // } else if (!empty($data['lender_first_name']) && !empty($data['lender_last_name'])) {
        //     $data['lender_name'] = $data['lender_first_name'] . " " . $data['lender_last_name'];
        // }

        $response = array('status' => 'success', 'orderDetails' => $data);
        echo json_encode($response);exit;
    }

    public function add_order_details()
    {
        $userdata = $this->session->userdata('user');
        if (empty($userdata)) {
            $userdata['id'] = 0;
        }
        $orderId = $this->input->post('orderId');
        // $this->load->library('order/resware');

        if ($orderId) {
            $this->load->model('order/home_model');
            $titleOfficer = $this->input->post('titleOfficer');
            $loan_amount = $this->input->post('loan_amount');
            $loan_number = $this->input->post('loan_number');
            // $name = explode(" ", $this->input->post('LenderName'));
            $new_existing_lender = $this->input->post('new_existing_lender');
            $LenderId = $this->input->post('LenderId');
            $transaction_id = $this->input->post('transaction_id');
            $property_id = $this->input->post('property_id');
            $property_address = $this->input->post('property_address');
            $property_city = $this->input->post('property_city');
            $property_state = $this->input->post('property_state');
            $property_zipcode = $this->input->post('property_zipcode');
            $borrowers_vesting = $this->input->post('borrowers_vesting');
            $branch = $this->input->post('branch');
            $lenderCompanyId = $this->input->post('LenderCompanyId');
            $lenderCompanyName = !empty($this->input->post('LenderCompany')) ? $this->input->post('LenderCompany') : "";
            $lenderCompanyLookupCode = !empty($this->input->post('LenderCompanyLookupCode')) ? $this->input->post('LenderCompanyLookupCode') : "";
            $lenderCompanyAddress = !empty($this->input->post('LenderAddress')) ? $this->input->post('LenderAddress') : "";
            $lenderCompanyCity = !empty($this->input->post('LenderCity')) ? $this->input->post('LenderCity') : "";
            $lenderCompanyState = !empty($this->input->post('LenderState')) ? $this->input->post('LenderState') : "";
            $lenderCompanyZipcode = !empty($this->input->post('LenderZipcode')) ? $this->input->post('LenderZipcode') : "";
            $assignmentClause = !empty($this->input->post('assignment_clause')) ? $this->input->post('assignment_clause') : "";
            // $fileId = $this->input->post('fileId');
            $s_report_date = $this->input->post('s_report_date');
            $p_report_date = $this->input->post('p_report_date');
            $s_report_date = date("Y-m-d", strtotime($s_report_date));
            $p_report_date = date("Y-m-d", strtotime($p_report_date));
            $params = [
                'order_details.id' => $orderId,
            ];
            $orderDetails = $this->order->get_order_details($params);
            // if ($orderDetails['is_softpro_order'] != 1) {
            $lender_details = array(
                // 'first_name' => $name[0],
                // 'last_name' => !empty($name[1]) ? $name[1] : '',
                // 'email_address' => !empty($this->input->post('LenderEmailAddress')) ? $this->input->post('LenderEmailAddress') : "",
                'company_name' => $lenderCompanyName,
                'address1' => $lenderCompanyAddress,
                'city' => $lenderCompanyCity,
                'state' => $lenderCompanyState,
                'zip' => $lenderCompanyZipcode,
                'assignment_clause' => $assignmentClause,
            );

            $flookup_code = $this->order->generateNewCompanyLookupCode($lenderCompanyName, $lenderCompanyAddress);
            if ($new_existing_lender == 'add_lender') {
                $lenderCompanyLookupCode = $flookup_code;
                $spResponse = $this->addNewLenderCPL($lenderCompanyName, $flookup_code, $lenderCompanyAddress, $lenderCompanyCity, $lenderCompanyState, $lenderCompanyZipcode, $assignmentClause);
                $lenderCompanyId = $spResponse['id'];
            } else {
                $updateData = [
                    'assignment_clause'  => $assignmentClause
                ];
                $this->home_model->update($updateData, array('id' => $lenderCompanyId), 'sp_company');
            }
            $this->home_model->update(array('proposed_branch_id' => $branch), array('id' => $orderId), 'order_details');

            // if (empty($lender_details['first_name']) && empty($lender_details['lender_last_name'])) {
            //     $lender_details['lender_name'] = '';
            // } else if (empty($lender_details['first_name']) && !empty($lender_details['last_name'])) {
            //     $lender_details['lender_name'] = $lender_details['last_name'];
            // } else if (!empty($lender_details['first_name']) && empty($lender_details['last_name'])) {
            //     $lender_details['lender_name'] = $lender_details['first_name'];
            // } else if (!empty($lender_details['first_name']) && !empty($lender_details['last_name'])) {
            //     $lender_details['lender_name'] = $lender_details['first_name'] . " " . $lender_details['last_name'];
            // }
            $lender_address = array();
            // $street_address = $this->input->post('LenderAddress');
            // $city = $this->input->post('LenderCity');
            // $lendeUser = $this->home_model->sp_get_user(array('id' => $LenderId));
            // $state = isset($lendeUser['state']) && !empty($lendeUser['state']) ? $lendeUser['state'] : '';
            // $zip_code = $this->input->post('LenderZipcode');

            if ($lenderCompanyAddress) {
                $lender_address[] = $lenderCompanyAddress;
            }

            if ($lenderCompanyCity) {
                $lender_address[] = $lenderCompanyCity;
            }

            if ($lenderCompanyState) {
                $lender_address[] = $lenderCompanyState;
            }

            if ($lenderCompanyZipcode) {
                $lender_address[] = $lenderCompanyZipcode;
            }
            $pdfData['lender'] = array(
                // 'lender_name' => $lender_details['lender_name'],
                'address' => implode(', ', $lender_address),
                'company_name' => $lenderCompanyName, //!empty($this->input->post('LenderCompany')) ? $this->input->post('LenderCompany') : "",//$lender_details['company_name'],
                'assignment_clause' => $assignmentClause //!empty($this->input->post('assignment_clause')) ? $this->input->post('assignment_clause') : "" //$lender_details['assignment_clause'],
            );
            $orderUser = $this->home_model->sp_get_user(array('id' => $orderDetails['customer_id']));
            $propertyDetails = [
                'cpl_lender_company_id' => $lenderCompanyId, 
                'cpl_proposed_property_address' => trim($property_address), 
                'cpl_proposed_property_city' => trim($property_city), 
                'cpl_proposed_property_state' => trim($property_state), 
                'cpl_proposed_property_zip' => trim($property_zipcode), 
                'borrowers_vesting' => trim($borrowers_vesting)
            ];
            $property_update_flag = $this->home_model->update($propertyDetails, array('id' => $orderDetails['property_id']), 'property_details');
            $transactionDetails = [
                'loan_amount' => $loan_amount,
                'loan_number' => $loan_number,
                'title_officer' => $titleOfficer,
                'preliminary_report_date' => $p_report_date,
                'supplemental_report_date' => $s_report_date
            ];
            $transaction_update_flag = $this->home_model->update($transactionDetails, array('id' => $orderDetails['transaction_id']), 'transaction_details');
            // echo "<pre>";print_r($transactionDetails);exit;

            if ($property_update_flag || $transaction_update_flag) {
                $params = [
                    'order_details.id' => $orderId,
                ];
                $orderDetails = $this->order->get_order_details($params);
                // $orderDetails = $this->order->get_order_details($fileId);
                $pdfData['company'] = isset($orderUser['company_name']) && !empty($orderUser['company_name']) ? $orderUser['company_name'] : '';
                $address = array();
                $street_address = isset($orderUser['address1']) && !empty($orderUser['address1']) ? $orderUser['address1'] : '';

                if ($street_address) {
                    $address[] = $street_address;
                }
                $city = isset($orderUser['city']) && !empty($orderUser['city']) ? $orderUser['city'] : '';
                $state = isset($orderUser['state']) && !empty($orderUser['state']) ? $orderUser['state'] : '';
                $zip_code = isset($orderUser['zip']) && !empty($orderUser['zip']) ? $orderUser['zip'] : '';

                if ($city) {
                    $address[] = $city;
                }
                if ($state) {
                    $address[] = $state;
                }

                if ($zip_code) {
                    $address[] = $zip_code;
                }
                $pdfData['address'] = implode(', ', $address);
                $pdfData['order_number'] = isset($orderDetails['file_number']) && !empty($orderDetails['file_number']) ? $orderDetails['file_number'] : '';
                $new_property_address = array();

                if (isset($property_address) && !empty($property_address)) {
                    $new_property_address[] = $property_address;
                }

                if (isset($property_city) && !empty($property_city)) {
                    $new_property_address[] = $property_city;
                }

                if (isset($property_state) && !empty($property_state)) {
                    $new_property_address[] = $property_state;
                }

                if (isset($property_zipcode) && !empty($property_zipcode)) {
                    $new_property_address[] = $property_zipcode;
                }
                $pdfData['property_address'] = implode(', ', $new_property_address);
                $pdfData['sales_amount'] = isset($orderDetails['sales_amount']) && !empty($orderDetails['sales_amount']) ? $orderDetails['sales_amount'] : '';
                $pdfData['loan_amount'] = $loan_amount; //isset($orderDetails['loan_amount']) && !empty($orderDetails['loan_amount']) ? $orderDetails['loan_amount'] : '';
                $pdfData['loan_number'] = $loan_number; //isset($orderDetails['loan_number']) && !empty($orderDetails['loan_number']) ? $orderDetails['loan_number'] : '';

                if (isset($orderDetails['title_officer']) && !empty($orderDetails['title_officer'])) {
                    if (preg_match('/\\d/', $orderDetails['title_officer']) > 0) {
                        $condition = array(
                            'id' => $orderDetails['title_officer'],
                            'status' => 1,
                        );
                        // $titleOfficerDetails = $this->titleOfficer->getTitleOfficerDetails($condition);
                        $titleOfficerDetails = $this->order->getTitleOfficerLookupDetails($condition);
                        
                    }
                    $pdfData['title_officer'] = isset($titleOfficerDetails['name']) && !empty($titleOfficerDetails['name']) ? $titleOfficerDetails['name'] : '';
                    $pdfData['title_officer_email'] = isset($titleOfficerDetails['email_address']) && !empty($titleOfficerDetails['email_address']) ? $titleOfficerDetails['email_address'] : '';
                    $pdfData['title_officer_phone'] = isset($titleOfficerDetails['telephone_no']) && !empty($titleOfficerDetails['telephone_no']) ? $titleOfficerDetails['telephone_no'] : '';
                    $pdfData['closer_examiner'] = isset($titleOfficerDetails['closer_examiner']) && !empty($titleOfficerDetails['closer_examiner']) ? $titleOfficerDetails['closer_examiner'] : '';
                }
                $pdfData['vesting'] = isset($borrowers_vesting) && !empty($borrowers_vesting) ? $borrowers_vesting : '';
                $pdfData['supplemental_report_date'] = isset($orderDetails['supplemental_report_date']) && !empty($orderDetails['supplemental_report_date']) ? date("m/d/Y h:i:s A", strtotime($orderDetails['supplemental_report_date'])) : '';
                $pdfData['preliminary_report_date'] = isset($orderDetails['preliminary_report_date']) && !empty($orderDetails['preliminary_report_date']) ? date("m/d/Y h:i:s A", strtotime($orderDetails['preliminary_report_date'])) : '';
                $pdfData['underwriter'] = '';
                $pdfData['underwriter'] = 'Westcor Land Title Insurance Company';
                if (strtolower($orderDetails['product_type_name']) == 'full alta') {
                    $pdfData['underwriter'] = 'Commonwealth Land Title Insurance Company';
                }
                // echo "<pre>";
                // print_r($pdfData);die;
                // if ($orderDetails['is_softpro_order'] != 1) {
                //     $endPoint = 'files/' . $fileId . '/partners';
                //     $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_partners', env('RESWARE_ORDER_API') . $endPoint, array(), array(), $orderDetails['order_id'], 0);

                    // if (!empty($userdata['id'])) {
                    //     if ($userdata['is_title_officer'] == 1 || $userdata['is_master'] == 1) {
                    //         $user_data['admin_api'] = 1;
                    //     } else {
                    //         $user_data = array();
                    //     }
                    // } else {
                    //     $user_data['admin_api'] = 1;
                    // }

                    // $resultPartners = $this->resware->make_request('GET', $endPoint, '', $user_data);
                    // $this->apiLogs->syncLogs($userdata['id'], 'resware', 'get_partners', env('RESWARE_ORDER_API') . $endPoint, array(), $resultPartners, $orderDetails['order_id'], $logid);
                    // $resPartners = json_decode($resultPartners, true);

                    // if (!empty($resPartners)) {
                    //     $key = array_search(7, array_column($resPartners['Partners'], 'PartnerTypeID'));
                    //     if (str_contains($resPartners['Partners'][$key]['PartnerName'], 'Doma Title Insurance') || $resPartners['Partners'][$key]['PartnerName'] == 'North American Title Insurance Company' || $resPartners['Partners'][$key]['PartnerName'] == 'Westcor Land Title Insurance Company' || $resPartners['Partners'][$key]['PartnerName'] == 'Commonwealth Land Title Insurance Company') {
                    //         $pdfData['underwriter'] = $resPartners['Partners'][$key]['PartnerName'];
                    //     } else {
                    //         $pdfData['underwriter'] = 'Westcor Land Title Insurance Company';
                    //     }
                    // }
                // } else {
                //     $pdfData['underwriter'] = 'Westcor Land Title Insurance Company';
                // }
                $pdfData['proposed_branch_id'] = $orderDetails['proposed_branch_id'];

                if (!empty($orderDetails['proposed_branch_id'])) {
                    $branchDetails = $this->order->getProposedBranchDetail($orderDetails['proposed_branch_id']);
                    $pdfData['branch_address'] = $branchDetails['address'];
                    $pdfData['branch_city'] = $branchDetails['city'];
                    $pdfData['branch_state'] = $branchDetails['state'];
                    $pdfData['branch_zip'] = $branchDetails['zip'];
                }
                $html = $this->load->view('order/proposed_insured_pdf', $pdfData, true);
                $this->load->library('m_pdf');
                $this->m_pdf->pdf->WriteHTML($html);
                $this->load->model('order/document');
                $proposedDocumentCount = $this->document->countProposedInsuredDocument($orderDetails['order_id']);
                $document_name = "proposed_" . $proposedDocumentCount . "_" . $orderDetails['file_number'] . ".pdf";
                
                if (!is_dir('uploads/proposed-insured')) {
                    mkdir('./uploads/proposed-insured', 0777, true);
                }
                
                $pdfFilePath = './uploads/proposed-insured/' . $document_name;
                $this->m_pdf->pdf->Output($pdfFilePath, 'F');
                $contents = file_get_contents($pdfFilePath);
                $binaryData = base64_encode($contents);
                $this->home_model->update(array('proposed_insured_document_name' => $document_name), array('id' => $orderId), 'order_details');
                
                $this->order->uploadDocumentOnAwsS3($document_name, 'proposed-insured');
                // if ($orderDetails['is_softpro_order'] == 1) {
                $this->order->uploadProposedDocumentToSoftpro($document_name, $orderDetails);
                // } else {
                //     $this->order->uploadProposedDocumentToResWare($document_name, $orderDetails, $binaryData);
                // }
                if (!empty($userdata) && $userdata['id'] == $orderDetails['title_officer']) {
                    $message = 'Proposed Insured document generated for order number #' . $orderDetails['file_number'];
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['customer_id'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
                } else if (!empty($userdata) && $userdata['id'] == $orderDetails['customer_id']) {
                    $message = 'Proposed Insured document generated for order number #' . $orderDetails['file_number'];
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['title_officer'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                } else {
                    $message = 'Proposed Insured document generated for order number #' . $orderDetails['file_number'];
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['title_officer'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['title_officer'], 0);
                    $notificationData = array(
                        'sent_user_id' => $orderDetails['customer_id'],
                        'message' => $message,
                        'is_admin' => 0,
                        'type' => 'created',
                    );
                    $this->home_model->insert($notificationData, 'pct_order_notifications');
                    $this->order->sendNotification($message, 'created', $orderDetails['customer_id'], 0);
                }
                /*$fileSize = filesize('./uploads/proposed-insured/'.$document_name);
                $documentData = array(
                'document_name' => $document_name,
                'original_document_name' => $document_name,
                'document_type_id' => 1031,
                'document_size' => $fileSize,
                'user_id' => $userdata['id'],
                'order_id' => $orderDetails['order_id'],
                'description' => 'Proposed Insured Document',
                'is_sync' => 0,
                'is_prelim_document' => 0,
                'is_proposed_insured_doc' => 1
                );
                $documentId = $this->document->insert($documentData);*/
                $data = array('status' => 'success', 'data' => $binaryData);
            } else {
                $data = array('status' => 'error');
            }
        } else {
            $data = array('status' => 'error');
        }
        echo json_encode($data);exit;
    }

    public function proposed_insured()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $condition = array(
            'where' => array(
                'status' => 1,
            ),
        );

        // $data['titleOfficer'] = $this->titleOfficer->getTitleOfficerDetails($condition);
        $data['titleOfficer'] = $this->order->getTitleOfficerLookupDetails([]);
        $data['proposedBranches'] = $this->order->getProposedBranches();
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        // $this->template->addJS( base_url('assets/frontend/js/order/proposed.js?v='.$this->js_version));
        // $this->template->show("order", "proposed_insured", $data);
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/proposed.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order", "proposed_insured", $data);
    }

    public function get_proposed_orders()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $params = array();
        $data = array();
        if (isset($_POST['draw']) && !empty($_POST['draw'])) {
            $params['draw'] = isset($_POST['draw']) && !empty($_POST['draw']) ? $_POST['draw'] : 10;
            $params['length'] = isset($_POST['length']) && !empty($_POST['length']) ? $_POST['length'] : 2;
            $params['start'] = isset($_POST['start']) && !empty($_POST['start']) ? $_POST['start'] : 0;
            $params['orderColumn'] = isset($_POST['order'][0]['column']) && !empty($_POST['order'][0]['column']) ? $_POST['order'][0]['column'] : 0;
            $params['orderDir'] = isset($_POST['order'][0]['dir']) && !empty($_POST['order'][0]['dir']) ? $_POST['order'][0]['dir'] : 0;
            $params['searchvalue'] = isset($_POST['search']['value']) && !empty($_POST['search']['value']) ? $_POST['search']['value'] : '';
            $pageno = ($params['start'] / $params['length']) + 1;
            $order_lists = $this->order->get_orders($params);
            $json_data['draw'] = intval($params['draw']);
        } else {
            $params['searchvalue'] = isset($_POST['keyword']) && !empty($_POST['keyword']) ? $_POST['keyword'] : '';
            $order_lists = $this->order->get_orders($params);
        }

        if (isset($order_lists['data']) && !empty($order_lists['data'])) {
            $i = $params['start'] + 1;
            foreach ($order_lists['data'] as $order) {
                $nestedData = array();
                $nestedData[] = $i;
                $nestedData[] = $order['file_number'];
                $nestedData[] = $order['full_address'];
                // $nestedData[] = !empty($order['proposed_document_created_date']) ? date("m/d/Y", strtotime($order['proposed_document_created_date'])) : '';
                $nestedData[] = !empty($order['proposed_document_created_date']) ? convertTimezone($order['proposed_document_created_date'], 'm/d/Y') : '';
                if (!empty($order['proposed_insured_document_name'])) {
                    $orderId = $order['id'];
                    $documentName = $order['proposed_insured_document_name'];
                    if (env('AWS_ENABLE_FLAG') == 1) {
                        $documentUrl = env('AWS_PATH') . "proposed-insured/" . $documentName;
                        $action = "<a href='#' onclick='downloadDocumentFromAws(" . '"' . $documentUrl . '"' . ", " . '"proposed_insured"' . ");'><i class='fas fa-download' aria-hidden='true'></i></a>";
                        $action = '<div style="display:flex;justify-content: space-around;" ><a href="' . $documentUrl . '" onclick="downloadDocumentFromAws(' . $documentUrl . ',' . 'proposed_insured' . ');" type="button" title="Download" class="btn btn-success btn-icon-split"><span class="icon text-white-50"><i class="fas fa-download"></i></span><span class="text">Download</span></a>';
                    } else {
                        $documentUrl = FCPATH . 'uploads/proposed-insured/' . $documentName;
                        // $action = '<a href="'.$documentUrl.'" download><i class="fas fa-download" aria-hidden="true"></i></a>';
                        $action = '<div style="display:flex;justify-content: space-around;" ><a href="' . $documentUrl . '" download type="button" title="Download" class="btn btn-success btn-icon-split"><span class="icon text-white-50"><i class="fas fa-download"></i></span><span class="text">Download</span></a>';
                    }
                } else {
                    $action = '<div style="display:flex;justify-content: space-around;" ><a href="javascript:void(0);" onclick="generateProposedInsured(' . $order['id'] . ');" type="button" title="Generate" class="btn btn-success btn-icon-split"><span class="icon text-white-50"><i class="fas fa-seedling"></i></span><span class="text">Generate</span></a>';
                }
                $action .= '<a href="javascript:void(0);" onclick="editInformation(' . $order['id'] . ');" class="btn btn-primary btn-icon-split" ><span class="icon text-white-50"><i class="fas fa-edit"></i></span><span class="text">Edit</span></a></div>';

                $nestedData[] = $action;

                $data[] = $nestedData;
                $i++;
            }
        }

        $json_data['recordsTotal'] = intval($order_lists['recordsTotal']);
        $json_data['recordsFiltered'] = intval($order_lists['recordsFiltered']);
        $json_data['data'] = $data;
        echo json_encode($json_data);
    }

    public function get_orders_prelim()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $params = array();
        $data = array();

        if (isset($_POST['draw']) && !empty($_POST['draw'])) {
            $params['draw'] = isset($_POST['draw']) && !empty($_POST['draw']) ? $_POST['draw'] : 10;
            $params['length'] = isset($_POST['length']) && !empty($_POST['length']) ? $_POST['length'] : 2;
            $params['start'] = isset($_POST['start']) && !empty($_POST['start']) ? $_POST['start'] : 0;
            $params['orderColumn'] = isset($_POST['order'][0]['column']) && !empty($_POST['order'][0]['column']) ? $_POST['order'][0]['column'] : 0;
            $params['orderDir'] = isset($_POST['order'][0]['dir']) && !empty($_POST['order'][0]['dir']) ? $_POST['order'][0]['dir'] : 0;
            $params['searchvalue'] = isset($_POST['search']['value']) && !empty($_POST['search']['value']) ? $_POST['search']['value'] : '';
            $pageno = ($params['start'] / $params['length']) + 1;
            $order_lists = $this->order->get_orders($params);
            $json_data['draw'] = intval($params['draw']);
        } else {
            $params['searchvalue'] = isset($_POST['keyword']) && !empty($_POST['keyword']) ? $_POST['keyword'] : '';
            $order_lists = $this->order->get_orders($params);
        }

        if (isset($order_lists['data']) && !empty($order_lists['data'])) {
            $i = $params['start'] + 1;
            foreach ($order_lists['data'] as $order) {

                $nestedData = array();
                $nestedData[] = $i;
                $nestedData[] = $order['file_number'];
                $nestedData[] = $order['full_address'];

                if ($order['prelim_summary_id'] != 0) {
                    // $class = isset($order['is_visited']) && !empty($order['is_visited']) ? 'secondary' : 'success';
                    $class = isset($order['is_doc_updated']) && !empty($order['is_doc_updated']) ? 'updated-prelim-btn' : 'btn-success';
                    $nestedData[] = "<div style='display: flex;justify-content: space-between;'><a href='" . base_url() . "review-file/" . $order['id'] . "'>
							<button type='submit' class='btn $class btn-icon-split'>
								<span class='icon text-white-50'>
									<i class='fas fa-file'></i>
								</span>
								<span class='text'>Review File</span>
							</button>
						</a>
                        <a href='javascript:void(0)' onclick=updatePrelimAction('".$order['id']."');>
						<button type='button' class='btn btn-secondary update-prelim-btn btn-icon-split'>
							<span class='icon text-white-50'>
								<i class='fas fa-refresh'></i>
							</span>
							<span class='text'>Update Prelim</span>
						</button></a>
                    </div>";
                } else {
                    $nestedData[] = "<div style='display: flex;justify-content: space-between;'>
                    <a href='javascript:void(0)'>
						<button type='submit' class='btn btn-info btn-icon-split'>
							<span class='icon text-white-50'>
								<i class='fas fa-tasks'></i>
							</span>
							<span class='text'>Not Ready</span>
						</button></a>
                    <a href='javascript:void(0)' onclick=fetchPrelimDocument('".$order['file_number']."');>
						<button type='button' class='btn btn-primary btn-icon-split'>
							<span class='icon text-white-50'>
								<i class='fas fa-refresh'></i>
							</span>
							<span class='text'>Get Prelim Doc</span>
						</button></a>
                    </div>";
                }

                $data[] = $nestedData;
                $i++;
            }
        }

        $json_data['recordsTotal'] = intval($order_lists['recordsTotal']);
        $json_data['recordsFiltered'] = intval($order_lists['recordsFiltered']);
        $json_data['data'] = $data;
        echo json_encode($json_data);
    }

    public function markAsRead()
    {
        $userdata = $this->session->userdata('user');
        $condition = array(
            'sent_user_id' => $userdata['id'],
        );
        $data = array(
            'is_read' => 1,
        );
        $this->home_model->update($data, $condition, 'pct_order_notifications');
        $response = array(
            'success' => 'true',
            'message' => 'Notifcation marked as read.',
        );
        echo json_encode($response);
    }

    public function get_notes($orderId)
    {
        //echo $fileId;exit;
        $userdata = $this->session->userdata('user');
        $this->load->model('admin/escrow/tasks_model');
        $data['errors'] = array();
        $data['success'] = array();
        if ($this->session->userdata('errors')) {
            $data['errors'] = $this->session->userdata('errors');
            $this->session->unset_userdata('errors');
        }
        if ($this->session->userdata('success')) {
            $data['success'] = $this->session->userdata('success');
            $this->session->unset_userdata('success');
        }
        $data['title'] = 'Smart Dashboard | Pacific Coast Title Company';
        $params = [
            'order_details.id' => $orderId,
        ];
        $orderDetails = $this->order->get_order_details($params);
        $orderId = isset($orderDetails['order_id']) && !empty($orderDetails['order_id']) ? $orderDetails['order_id'] : '';
        $data['orderDetails'] = $orderDetails;
        $prod_type = $orderDetails['prod_type'];

        if ($userdata['is_escrow_officer'] == 1 || $userdata['is_escrow_assistant'] == 1) {
            $data['tasks'] = $this->tasks_model->get_many_by("(status = 1 and parent_task_id = 0 and (prod_type = 'both' or prod_type = '$prod_type') )");
            $data['notes'] = $this->order->get_order_notes($orderId, $userdata['id']);
        } else {
            $data['tasks'] = array();
            $data['notes'] = $this->order->get_order_notes($orderId);
        }
        // echo "<pre>";
        // print_r($data);die;
        // $this->template->addJS( base_url('assets/frontend/js/order/notes_js.js?v='.$this->js_version) );
        $this->escrowdashboardtemplate->addJS(base_url('assets/frontend/js/order/notes_js.js?v=' . $this->js_version));
        $this->escrowdashboardtemplate->show("order/common", "get_notes", $data);
        // $this->template->show("order/common", "get_notes", $data);
    }

    public function create_note()
    {
        $orderId = isset($_POST['orderId']) && !empty($_POST['orderId']) ? $_POST['orderId'] : '';
        $errors = array();
        $success = array();
        $this->load->model('order/note');
        if (isset($orderId) && !empty($orderId)) {
            $userdata = $this->session->userdata('user');
            $subject = isset($_POST['subject']) && !empty($_POST['subject']) ? $_POST['subject'] : '';
            $body = isset($_POST['body']) && !empty($_POST['body']) ? $_POST['body'] : '';
            $params = [
                'order_details.id' => $orderId,
            ];
            $orderDetails = $this->order->get_order_details($params);
            // $orderId = isset($orderDetails['order_id']) && !empty($orderDetails['order_id']) ? $orderDetails['order_id'] : '';
            // $this->load->library('order/resware');
            $request = array();
            // $endPoint = 'files/' . $fileId . '/notes';
            $endPoint = 'add_note';
            // $notes['Subject'] = $subject;
            $notes['Text'] = $body;
            $notes['OrderNumber'] = $orderDetails['file_number'];
            $notesReq[] = $notes;
            $reqData = json_encode($notesReq);
            $user_data = array();

            // print_r($reqData);die;
            // if ($userdata['is_title_officer'] == 1 || $userdata['is_master'] == 1 || $userdata['is_escrow_officer'] == 1 || $userdata['is_escrow_assistant'] == 1) {
            //     $user_data['admin_api'] = 1;
            // }

            // $logid = $this->apiLogs->syncLogs($userdata['id'], 'resware', 'create_note', env('RESWARE_ORDER_API') . $endPoint, $notes_data, array(), $orderId, 0);
            // $result = $this->resware->make_request('POST', $endPoint, $notes_data, $user_data);
            // $this->apiLogs->syncLogs($userdata['id'], 'resware', 'create_note', env('RESWARE_ORDER_API') . $endPoint, $notes_data, $result, $orderId, $logid);
            
            $logid = $this->apiLogs->syncLogs($userdata['id'], 'softpro', $endPoint, env('SOFT_PRO_API') . $endPoint, $reqData, array(), $orderId, 0);
            $result = $this->softpro->make_request('POST', $endPoint, $reqData);
            $this->apiLogs->syncLogs($userdata['id'], 'softpro', $endPoint, env('SOFT_PRO_API') . $endPoint, $reqData, $result, $orderId, $logid);
            $response      = json_decode($result, true);
            /* Start add softpro api logs */
            $softproLog = [
                'request_type' => 'add_note_in_softpro',
                'request_url'  => 'add_note',
                'request'      => $reqData,
                'response'     => $result,
                'status'       => 'error',
                'created_at'   => date("Y-m-d H:i:s"),
            ];

            $this->db->insert('pct_resware_log', $softproLog);
            /* End add softpro api logs */
            // echo "<pre>";
            // print_r($response);die;
            if (isset($response) && !empty($response)) {
                // $response = $result, true);
                foreach ($response as $key => $res) {
                    if ($res['Status'] != 200) {
                        $message = isset($response['Message']) && !empty($response['Message']) ? $response['Message'] : '';
                        $errors[] = $message;
                    } else {
                        $notesData = array(
                            'is_softpro_notes' => 1,
                            'is_sync' => !empty($res['FileUploadedStatus']) ? $res['FileUploadedStatus'] : 0,
                            'subject' => $subject,
                            'note' => $body,
                            'user_id' => $userdata['id'],
                            'order_id' => $orderId,
                            'task_id' => isset($_POST['task_id']) ? $_POST['task_id'] : 0,
                        );
                        $id = $this->note->insert($notesData);
                        if ($id) {
                            $success[] = 'Note created successfully.';
                        } else {
                            $errors[] = 'Something went wrong. Please try again.';
                        }
                    }
                }
            }
            
            
            
            // if (isset($result) && !empty($result)) {
            //     $response = json_decode($result, true);

            //     if (isset($response['ResponseStatus']) && !empty($response['ResponseStatus'])) {
            //         $message = isset($response['ResponseStatus']['Message']) && !empty($response['ResponseStatus']['Message']) ? $response['ResponseStatus']['Message'] : '';
            //         $errors[] = $message;
            //     } else {
            //         $noteId = isset($response['Note']['NoteID']) && !empty($response['Note']['NoteID']) ? $response['Note']['NoteID'] : '';
            //         $notesData = array(
            //             'resware_note_id' => $noteId,
            //             'subject' => $subject,
            //             'note' => $body,
            //             'user_id' => $userdata['id'],
            //             'order_id' => $orderId,
            //             'task_id' => isset($_POST['task_id']) ? $_POST['task_id'] : 0,
            //         );
            //         $id = $this->note->insert($notesData);
            //         if ($noteId && $id) {
            //             $success[] = 'Note created successfully.';
            //         } else {
            //             $errors[] = 'Something went wrong. Please try again.';
            //         }
            //     }
            // }

            $data = array(
                "errors" => $errors,
                "success" => $success,
            );
            $this->session->set_userdata($data);
            redirect(base_url() . 'get-notes/' . $orderId);
        }
    }

    public function update_commisssion_calculation()
    {
        //Get SalesRep whose order close on current month

        $for_month = date('m');
        $for_year = date('Y');
        $table = 'transaction_details';
        $this->db->select('sales_representative');
        $this->db->from($table);
        $this->db->join('order_details', 'order_details.transaction_id = transaction_details.id');
        $this->db->join('pct_softpro_lookup_table', 'pct_softpro_lookup_table.id = transaction_details.sales_representative');
        $this->db->where('MONTH(sent_to_accounting_date)', $for_month);
        $this->db->where('YEAR(sent_to_accounting_date)', $for_year);
        $this->db->group_by('sales_representative');
        $query = $this->db->get();
        $result = $query->result();

        $this->load->model('admin/order/customer_basic_details_model');

        foreach ($result as $record) {
            $sales_rep_id = $record->sales_representative;
            $stored_pocedure = "CALL calculate_commission(?)";
            $this->customer_basic_details_model->call_sp($stored_pocedure, array('id' => $sales_rep_id));
        }

    }

    public function update_commisssion_calculation_dup($for_month = 0, $for_year = 0)
    {
        //Get SalesRep whose order close on current month
        if (!($for_month >= 1 && $for_month <= 12)) {
            $for_month = date('m');
        } elseif (!($for_month >= 2022)) {
            $for_year = date('Y');
        }
        $table = 'transaction_details';
        $this->db->select('sales_representative');
        $this->db->from($table);
        $this->db->join('order_details', 'order_details.transaction_id = transaction_details.id');
        $this->db->join('pct_softpro_lookup_table', 'pct_softpro_lookup_table.id = transaction_details.sales_representative');
        $this->db->where('MONTH(sent_to_accounting_date)', $for_month);
        $this->db->where('YEAR(sent_to_accounting_date)', $for_year);
        $this->db->group_by('sales_representative');
        $query = $this->db->get();
        $result = $query->result();

        $this->load->model('admin/order/customer_basic_details_model');

        foreach ($result as $record) {
            $sales_rep_id = $record->sales_representative;
            $stored_pocedure = 'CALL calculate_commission_common(?,?,?)';
            $this->customer_basic_details_model->call_sp($stored_pocedure, array('id' => $sales_rep_id, 'for_year' => $for_year, 'for_month' => $for_month));
        }

    }

    public function getRevenueData()
    {
        date_default_timezone_set('America/Los_Angeles');
        $user_id = $this->input->post('user_id');
        $user_type = $this->input->post('user_type') ?? 'sales_rep';
        $year = $this->input->post('year') ?? date('Y');
        $revenueData = $this->order->getRevenueData($this->input->post('month') ? $this->input->post('month') : date('m'), $user_id, $user_type, $year);
        $data = "<table class='table table-bordered' id='tbl-lp-orders-listing' width='100%' cellspacing='0'>
            <thead>
                <tr>
                    <th>Sr No</th>
                    <th>File Number</th>
                    <th>Address</th>
                    <th>Prod Type</th>
                    <th>Revenue</th>
                </tr>
            </thead>
        <tbody>";

        $i = 1;
        if (!empty($revenueData)) {
            foreach ($revenueData as $revenue) {
                $file_number = $revenue['file_number'];
                $full_address = $revenue['full_address'];
                $prod_type = $revenue['prod_type'];
                $revenue = '$' . number_format($revenue['premium']);
                $data .= "<tr>
                                <td width='12%'>$i</td>
                                <td width='12%'>$file_number</td>
                                <td width='52%'>$full_address</td>
                                <td width='12%'>$prod_type</td>
                                <td width='12%'>$revenue</td>
                            </tr>";
                $i++;
            }
        } else {
            $data .= "<tr class='norecord'><td colspan='5'>No records found.</td></tr>";
        }
        $data .= '</tbody></table>';
        if (!empty($data)) {
            $result = array('status' => 'success', 'data' => $data);
        } else {
            $result = array('status' => 'error', 'data' => $data);
        }
        echo json_encode($result);
        exit;
    }

    public function getOpenOrderData()
    {
        date_default_timezone_set('America/Los_Angeles');
        $user_id = $this->input->post('user_id');
        $user_type = $this->input->post('user_type') ?? 'sales_rep';
        $year = $this->input->post('year') ?? date('Y');
        $openOrderData = $this->order->getOpenedOrderData($this->input->post('month') ? $this->input->post('month') : date('m'), $user_id, $user_type, $year);
        $data = "<table class='table table-bordered' id='tbl-open-orders-listing' width='100%' cellspacing='0'>
            <thead>
                <tr>
                    <th>Sr No</th>
                    <th>File Number</th>
                    <th>Address</th>
                    <th>Prod Type</th>
                    <th>Status</th>
                    <th>Created Date</th>
                </tr>
            </thead>
        <tbody>";

        $i = 1;
        if (!empty($openOrderData)) {
            foreach ($openOrderData as $order) {
                $file_number = $order['file_number'];
                $full_address = $order['full_address'];
                $prod_type = $order['prod_type'];
                $status = ucfirst($order['softpro_status']);
                $created_date = !empty($order['created_at']) ? date('m/d/Y', strtotime($order['created_at'])) : '-';
                $data .= "<tr>
                                <td width='8%'>$i</td>
                                <td width='12%'>$file_number</td>
                                <td width='40%'>$full_address</td>
                                <td width='12%'>$prod_type</td>
                                <td width='12%'>$status</td>
                                <td width='16%'>$created_date</td>
                            </tr>";
                $i++;
            }
        } else {
            $data .= "<tr class='norecord'><td colspan='6'>No records found.</td></tr>";
        }
        $data .= '</tbody></table>';
        if (!empty($data)) {
            $result = array('status' => 'success', 'data' => $data);
        } else {
            $result = array('status' => 'error', 'data' => $data);
        }
        echo json_encode($result);
        exit;
    }

    public function surveysResult()
    {
        if (empty($this->session->userdata('user'))) {
            redirect(base_url() . 'order');
        }
        $survey = [];
        $survey['title'] = 'PCT Order: Surveys';
        $this->common_lib->is_sales_user();
        $this->load->library('order/survey');
        $this->load->model('order/apiLogs');
        $endPoint = 'surveys';
        $userdata = $this->session->userdata('user');
        // $userdata['email'] = $userdata['email_address'];
        $logid = $this->apiLogs->syncLogs($userdata['id'], 'survey', 'get_survey', env('SURVEYMONKEY_API_URL') . $endPoint, array(), array(), 0, 0);
        $result = $this->survey->make_request('GET', $endPoint, '');
        // print_r($result);die;
        $this->apiLogs->syncLogs($userdata['id'], 'survey', 'get_survey', env('SURVEYMONKEY_API_URL') . $endPoint, array(), $result, 0, $logid);
        $titleOfficerList = [];

        // if (isset($result) && !empty($result)) {
        if ($result && is_string($result)) {
            $response = json_decode($result, true);
            // echo "<pre>";
            // print_r($response);die;
            if (isset($response['data']) && !empty($response['data'])) {
                foreach ($response['data'] as $key => $value) {
                    $arr = [];
                    $arr['id'] = $value['id'];
                    $arr['title'] = $value['title'];
                    $arr['nickname'] = $value['nickname'];
                    $arr['href'] = $value['href'];
                    $titleOfficerList[] = $arr;
                    // break;
                }
            } else {
                // Handle empty or invalid JSON response
                $survey['error'] = 'No survey data available';
                $survey['title_officer_list'] = [];
            }
        } else {
            // Handle API request failure
            $survey['error'] = 'Failed to fetch survey data';
            $survey['title_officer_list'] = [];
        }
        $ratingData = [];
        if (!empty($titleOfficerList)) {
            // $titleOffSurveyId = "417131721"; 
            $titleOffSurveyId = $titleOfficerList['0']['id']; 
            $endPoint = 'surveys/' . $titleOffSurveyId . '/responses/bulk';
            $result = $this->survey->make_request('GET', $endPoint, '', $userdata);

            // if (isset($result) && !empty($result)) {
            if ($result && is_string($result)) {
                // echo "<pre>";
                $response = json_decode($result, true);

                if (isset($response['data'])) {

                    // Process the response data
                    $questionAverages = [];
                    $textComment = [];
                    $ratingArray = [];

                    foreach ($response['data'] as $res) {
                        $ratingArr = [];
                        $ratingArr['sales_rep'] = '-';
                        if (isset($res['custom_variables']) && !empty($res['custom_variables'])) {
                            $orderId = $res['custom_variables']['order_id'];
                            $salesRepDetails = $this->order->getSalesRepForOrder($orderId);
                            // echo "<pre>";
                            // print_r($salesRepDetails);die;
                            $ratingArr['sales_rep'] = $salesRepDetails['first_name'] . ' ' . $salesRepDetails['last_name'];
                        }
                        $ratingData['titleOfficer'] = $titleOfficerList['0']['title'];
                        foreach ($res['pages'] as $page) {
                            foreach ($page['questions'] as $key => $question) {
                                $questionId = $question['id'];
                                foreach ($question['answers'] as $answer) {
                                    if (isset($answer['choice_metadata']['weight'])) {
                                        $ratingArr[$questionId] = (int)$answer['choice_metadata']['weight'];
                                        // $ratingArr['Q'.($key+1)] = (int)$answer['choice_metadata']['weight'];
                                        $questionAverages[$questionId][] = (int)$answer['choice_metadata']['weight'];
                                    }
                                    if (isset($answer['text']) && !empty($answer['text'])) {
                                        $ratingArr['comment'] = $answer['text'];
                                        $textComment[] = $answer['text'];
                                    }
                                }
                            }
                        }
                        $ratingArray[] = $ratingArr;
                    }
                    // Calculate average for each question
                    $finalAverages = [];
                    $i = 1;
                    foreach ($questionAverages as $questionId => $weights) {
                        $finalAverages['Q'.$i] = number_format(array_sum($weights) / count($weights), 2);
                        $i++;
                    }
                    $ratingData['rating'] = $ratingArray;
                    // print_r($page);die;
                    $ratingData['avg'] = $finalAverages;
                    $ratingData['textComment'] = $textComment;
                    $survey['survey_cards'] = $this->surveyReportCards($ratingData);
                    $survey['survey_rating_details'] = $this->surveyReportRating($ratingData);
                } else {
                    // Handle empty response data
                    $survey['error'] = 'No survey response data available';
                    $survey['survey_cards'] = [];
                    $survey['survey_rating_details'] = [];
                }
            } else {
                // Handle API failure for responses
                $survey['error'] = 'Failed to fetch survey responses';
                $survey['survey_cards'] = [];
                $survey['survey_rating_details'] = [];
            }
        } else {
            // Handle failure to get title officer list
            $survey['error'] = 'Failed to fetch survey data';
            $survey['survey_cards'] = [];
            $survey['survey_rating_details'] = [];
            $survey['title_officer_list'] = [];
        }
        $survey['title_officer_list'] = $titleOfficerList;
        
        // echo "<pre>";
        // // print_r($ratingData);
        // print_r($survey);die;
        // $data['survey'] = $survey;
        $this->salesdashboardtemplate->addCSS(base_url('assets/frontend/css/smart-forms.css?v=' . $this->js_version));
        $this->salesdashboardtemplate->addCss(base_url('assets/frontend/css/sales-dashboard.css?v=' . $this->js_version));
        $this->salesdashboardtemplate->addJS(base_url('assets/frontend/js/order/sales_dashboard.js?v=' . $this->js_version));
        $this->salesdashboardtemplate->show("order/common", "survey_result", $survey);
    }

    public function getSurveyDetails() {
        if (empty($this->session->userdata('user')) && empty($this->session->userdata('admin'))) {
            $res = array('status' => 'error', 'msg' => "Authentication required.");
            echo json_encode($res);exit;
        }
        $titleOffSurveyId = $this->input->post('title_officer_survey_id');
        $titleOffSurveyName = $this->input->post('title_officer_survey_name');
        if (!empty($titleOffSurveyId)) {
            $this->load->library('order/survey');
            $this->load->model('order/apiLogs');
            $endPoint = 'surveys/' . $titleOffSurveyId . '/responses/bulk';
            $result = $this->survey->make_request('GET', $endPoint);
            // if (isset($result) && !empty($result)) {
            if ($result && is_string($result)) {
                $response = json_decode($result, true);

                if (isset($response['data'])) {

                    $questionAverages = [];
                    $textComment = [];
                    $ratingArray = [];

                    foreach ($response['data'] as $res) {
                        $ratingArr = [];
                        $ratingArr['sales_rep'] = '-';
                        $ratingArr['survey_date'] = date('m-d-Y H:i:s', strtotime($res['date_modified']));
                        if (isset($res['custom_variables']) && !empty($res['custom_variables'])) {
                            $orderId = $res['custom_variables']['order_id'];
                            $salesRepDetails = $this->order->getSalesRepForOrder($orderId);
                            $ratingArr['recipient_name'] = '-';
                            if (isset($res['custom_variables']['uid'])) {
                                $userId = $res['custom_variables']['uid'];
                                // print_r($userId);die;
                                $userDetails = $this->order->get_row(['id' => $userId], 'pct_softpro_lookup_table');
                                // print_r($userDetails);die;
                                if (!empty($userDetails)) {
                                    $ratingArr['recipient_name'] = $userDetails['first_name'] . ' ' . $userDetails['last_name'] . ' - ' . $userDetails['company_name'];
                                }
                            }
                            // echo "<pre>";
                            // print_r($salesRepDetails);die;
                            // $ratingArr['sales_rep'] = $salesRepDetails['first_name'] . ' ' . $salesRepDetails['last_name'];
                            $ratingArr['file_number'] = $salesRepDetails['file_number'];
                        }
                        $ratingData['titleOfficer'] = $titleOffSurveyName;
                        foreach ($res['pages'] as $page) {
                            foreach ($page['questions'] as $key => $question) {
                                $questionId = $question['id'];
                                foreach ($question['answers'] as $answer) {
                                    if (isset($answer['choice_metadata']['weight'])) {
                                        // $ratingArr['Q'.($key+1)] = (int)$answer['choice_metadata']['weight'];
                                        $ratingArr[$questionId] = (int)$answer['choice_metadata']['weight'];
                                        $questionAverages[$questionId][] = (int)$answer['choice_metadata']['weight'];
                                    }
                                    if (isset($answer['text']) && !empty($answer['text'])) {
                                        $ratingArr['comment'] = $answer['text'];
                                        $textComment[] = $answer['text'];
                                    }
                                }
                            }
                        }
                        $ratingArray[] = $ratingArr;
                    }
                    // Calculate average for each question
                    $finalAverages = [];
                    $i = 1;
                    foreach ($questionAverages as $questionId => $weights) {
                        $finalAverages['Q'.$i] = number_format(array_sum($weights) / count($weights), 2);
                        $i++;
                    }
                    $ratingData['rating'] = array_reverse($ratingArray);
                    // print_r($page);die;
                    $ratingData['avg'] = $finalAverages;
                    $ratingData['textComment'] = $textComment;
                    $survey['survey_cards'] = $this->surveyReportCards($ratingData);
                    $survey['survey_rating_details'] = $this->surveyReportRating($ratingData);
                    // $survey['title_officer_list'] = $titleOfficerList;
                } else {
                    // Handle empty response data
                    $survey['error'] = 'No survey response data available';
                    $survey['survey_cards'] = [];
                    $survey['survey_rating_details'] = [];
                }
            } else {
                // Handle API failure for responses
                $survey['error'] = 'Failed to fetch survey responses';
                $survey['survey_cards'] = [];
                $survey['survey_rating_details'] = [];
            }
        } else {
            // Handle failure to get title officer list
            $survey['error'] = 'Failed to get title officer list';
            $survey['survey_cards'] = [];
            $survey['survey_rating_details'] = [];
        }
        if (!empty($survey)){
            $res = array('status' => 'success', 'survey' => $survey);
        } else {
            $res = array('status' => 'error', 'msg' => "Please select file.");
        }
        echo json_encode($res);exit;
    }

    public function surveyReportCards($data) {
        // echo "<pre>";
        // print_r($this->salesdashboardtemplate->show("order/common/survey", "survey_report_cards", ['value' => $data]));die;
        // $results = $this->load->view('order/review_file_summary', $data, true);
        return $this->load->view('order/common/survey/survey_report_cards', $data, true);
        // echo $this->salesdashboardtemplate->show("order/common/survey", "survey_report_cards", ['value' => $data]);
    }

    public function surveyReportRating($data) {
        return $this->load->view('order/common/survey/survey_report_rating_details', $data, true);
    }
}
