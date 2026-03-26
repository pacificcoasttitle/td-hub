<?php
if (!defined('BASEPATH')) {
    exit('No direct script access allowed');
}

class Fnf
{
    public $CI;

    public function __construct($params = array())
    {
        $this->CI = &get_instance();
        $this->CI->load->database();
        $this->CI->load->library('email');
        $this->CI->load->library('session');
        // self::$CI = $this->CI;
    }

    public function make_request($httpMethod, $endPoint, $urlType, $bodyParams = '', $bearerToken = '', $action = '')
    {
        if ($urlType == 'vendor') {
            $url = getenv('FNF_VENDOR_URL');
            $headers = array(
                'Content-Type: application/json',
                'Content-Length: ' . strlen($bodyParams),
                "Connection: close",
            );
        } else if ($urlType == 'user') {
            $url = getenv('FNF_USER_URL');
            $headers = array(
                'Content-Type: application/json',
                'Authorization: Bearer ' . $bearerToken,
                'Content-Length: ' . strlen($bodyParams),
                "Connection: close",
            );
        } else {
            $url = getenv('FNF_CPL_URL');
            $headers = array(
                "Content-type: text/xml",
                'Authorization: Bearer ' . $bearerToken,
                "Content-length: " . strlen($bodyParams),
                "SOAPAction: " . $action,
                "ClientID: " . getenv('FNF_CLIENT_ID'),
                "Connection: close",
            );
        }
        $ch = curl_init($url . $endPoint);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $httpMethod);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyParams);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 500);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $error_msg = curl_error($ch);
        $result = curl_exec($ch);
        if (curl_errno($ch)) {
            echo $error_msg = curl_error($ch);exit;
        }
        return $result;
    }

    public function generateVendorToken($orderDetails)
    {
        if (!empty($this->CI->session->userdata('user'))) {
            $userdata = $this->CI->session->userdata('user');
        } else if (!empty($this->CI->session->userdata('admin'))) {
            $userdata = $this->CI->session->userdata('admin');
        } else {
            $userdata = array();
            $userdata['id'] = 0;
        }

        $this->CI->load->model('order/apiLogs');
        $postData = json_encode(array(
            'clientId' => getenv('FNF_CLIENT_ID'),
            'secretKey' => getenv('FNF_SECRET_KEY'),
        ));

        $endPoint = 'api/FnfAuthIdentityProvider/GetToken';

        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'generate_vendor_token', getenv('FNF_VENDOR_URL') . $endPoint, $postData, array(), $orderDetails['order_id'], 0);
        $resultVendorToken = $this->make_request('POST', $endPoint, 'vendor', $postData);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'generate_vendor_token', getenv('FNF_VENDOR_URL') . $endPoint, $postData, $resultVendorToken, $orderDetails['order_id'], $logid);
        $resToken = json_decode($resultVendorToken, true);
        $tokenData = array(
            'token' => $resToken['jwtToken'],
            'create_token_time' => date('Y-m-d H:i:s'),
            'expires_at' => $resToken['expiresAt'],
            'expires_in' => 28800,
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        );
        $this->CI->db->replace('pct_order_fnf_token', $tokenData);
        return $tokenData;
    }

    public function generateUserToken($orderDetails)
    {
        if (!empty($this->CI->session->userdata('user'))) {
            $userdata = $this->CI->session->userdata('user');
        } else if (!empty($this->CI->session->userdata('admin'))) {
            $userdata = $this->CI->session->userdata('admin');
        } else {
            $userdata = array();
            $userdata['id'] = 0;
            $userdata['is_master'] = 1;
        }

        $vendorTokenData = $this->get_vendor_token();
        if ($vendorTokenData === false) {
            $vendorTokenData = $this->generateVendorToken($orderDetails);
        }

        $this->CI->load->model('order/apiLogs');
        $postData = json_encode(array(
            'accessToken' => $vendorTokenData['token'],
            'onBehalfOfUser' => getenv('FNF_ON_BEHALF_OF_USER'),
        ));
        $endPoint = 'userToken';

        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'generate_user_token', getenv('FNF_USER_URL') . $endPoint, $postData, array(), $orderDetails['order_id'], 0);
        $resultUserToken = $this->make_request('POST', $endPoint, 'user', $postData, $vendorTokenData['token']);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'generate_user_token', getenv('FNF_USER_URL') . $endPoint, $postData, $resultUserToken, $orderDetails['order_id'], $logid);
        $resToken = json_decode($resultUserToken, true);
        if (empty($resToken)) {
            return false;
        }
        $tokenData = array(
            'token' => $resToken['user_token'],
            'username' => $resToken['username'],
            'user_id' => $userdata['is_master'] == 1 ? $orderDetails['customer_id'] : $userdata['id'],
            'expires_in' => $resToken['expires_in'],
            'create_token_time' => date('Y-m-d H:i:s'),
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        );
        $this->CI->db->replace('pct_order_fnf_user_token', $tokenData);
        return $tokenData;

    }

    public function get_vendor_token()
    {
        $this->CI->db->select('*');
        $this->CI->db->from('pct_order_fnf_token');
        $query = $this->CI->db->get();
        $result = $query->row_array();
        if (!empty($result)) {
            $expires = strtotime($result['expires_at']);
            $date = new DateTime(date("Y-m-d H:i:s", $expires));
            $date2 = new DateTime(date('Y-m-d H:i:s'));
            $diff = $date2->getTimestamp() - $date->getTimestamp();
            if ($diff < 0) {
                return $result;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    public function get_user_token()
    {
        $this->CI->db->select('*');
        $this->CI->db->from('pct_order_fnf_user_token');
        $query = $this->CI->db->get();
        $result = $query->row_array();
        if (!empty($result)) {
            $date = new DateTime($result['create_token_time']);
            $date2 = new DateTime(date('Y-m-d H:i:s'));
            $diff = $date2->getTimestamp() - $date->getTimestamp();
            if ($diff < 0) {
                return $result;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    public function getAgents($id = 0)
    {
        $this->CI->db->select('*');
        $this->CI->db->from('pct_order_fnf_agents');
        if (!empty($id)) {
            $this->CI->db->where('id', $id);
        }
        $query = $this->CI->db->get();
        if ($id == 0) {
            $result = $query->result_array();
        } else {
            $result = $query->row_array();
        }

        if (!empty($result)) {
            return $result;
        } else {
            return false;
        }
    }

    public function getAgentsFromApi($orderDetails)
    {
        if (!empty($this->CI->session->userdata('user'))) {
            $userdata = $this->CI->session->userdata('user');
        } else if (!empty($this->CI->session->userdata('admin'))) {
            $userdata = $this->CI->session->userdata('admin');
        } else {
            $userdata = array();
            $userdata['id'] = 0;
        }

        $userTokenData = $this->get_user_token();
        if ($userTokenData === false) {
            $userTokenData = $this->generateUserToken($orderDetails);
        }
        $endPoint = 'agents/CPL/CA';
        $postData = array();
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'get_agent_list', getenv('FNF_USER_URL') . $endPoint, $postData, array(), $orderDetails['order_id'], 0);
        $resultAgentList = $this->make_request('GET', $endPoint, 'user', '', $userTokenData['token']);
        $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'get_agent_list', getenv('FNF_USER_URL') . $endPoint, $postData, $resultAgentList, $orderDetails['order_id'], $logid);
        $agents = json_decode($resultAgentList, true);
        foreach ($agents as $agent) {
            $this->CI->db->select('*');
            $this->CI->db->from('pct_order_fnf_agents');
            $this->CI->db->like('location_city', $agent['locationCity']);
            $query = $this->CI->db->get();
            $result = $query->row_array();
            if (!empty($result)) {
                $condition = array(
                    'location_city' => $agent['locationCity'],
                );
                $agentData = array(
                    'agent_number' => $agent['agentNumber'],
                    'agent_status' => $agent['agentStatus'],
                    'agent_account_type' => $agent['agentAccountType'],
                    'is_dba_name' => $agent['isDbaName'] ? 1 : 0,
                    'underwriter_code' => $agent['underwriterCode'],
                    'underwriter' => $agent['underwriter'],
                    'address' => $agent['locationAddress1'],
                    'state' => $agent['locationStateCode'],
                    'zip' => $agent['locationZipCode'],
                    'phone_number' => $agent['locationPhoneNumber'],
                    'created_at' => date('Y-m-d H:i:s'),
                    'updated_at' => date('Y-m-d H:i:s'),
                );
                $this->CI->db->update('pct_order_fnf_agents', $agentData, $condition);
                $agentData['location_city'] = $agent['locationCity'];
            } else {
                $agentData = array(
                    'agent_number' => $agent['agentNumber'],
                    'agent_status' => $agent['agentStatus'],
                    'agent_account_type' => $agent['agentAccountType'],
                    'is_dba_name' => $agent['isDbaName'] ? 1 : 0,
                    'location_city' => $agent['locationCity'],
                    'underwriter_code' => $agent['underwriterCode'],
                    'underwriter' => $agent['underwriter'],
                    'address' => $agent['locationAddress1'],
                    'state' => $agent['locationStateCode'],
                    'zip' => $agent['locationZipCode'],
                    'phone_number' => $agent['locationPhoneNumber'],
                    'created_at' => date('Y-m-d H:i:s'),
                    'updated_at' => date('Y-m-d H:i:s'),
                );
                $this->CI->db->insert('pct_order_fnf_agents', $agentData);
            }
            $agentsData[] = $agentData;
        }
        return $agentsData;
    }

    public function getCPLForm($orderDetails, $vendorTokenData, $userTokenData)
    {
        $this->CI->load->library('order/natic');
        if (!empty($this->CI->session->userdata('user'))) {
            $userdata = $this->CI->session->userdata('user');
        } else if (!empty($this->CI->session->userdata('admin'))) {
            $userdata = $this->CI->session->userdata('admin');
        } else {
            $userdata = array();
            $userdata['id'] = 0;
        }
        $propertyDetail = explode(",", $orderDetails['full_address']);
        $state = $orderDetails['property_state'] ? $orderDetails['property_state'] : trim($propertyDetail[3]);
        $endPoint = 'v3/CPLManagement.svc';
        $postData = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cpl="http://cpl.fnf.com/services/v3/cplmanagement/">
                        <soapenv:Header/>
                        <soapenv:Body>
                            <cpl:GetCPLListRequest>
                                <cpl:CLUP>' . $orderDetails['agent_number'] . '</cpl:CLUP>
                                <cpl:OnBehalfOfUser>' . getenv('FNF_ON_BEHALF_OF_USER') . '</cpl:OnBehalfOfUser>
                                <cpl:OrderNumber>' . $orderDetails['file_number'] . '</cpl:OrderNumber>
                                <cpl:StateAbbreviation>' . $state . '</cpl:StateAbbreviation>
                                <cpl:UnderwriterShortName>' . $orderDetails['underwriter_code'] . '</cpl:UnderwriterShortName>
                            </cpl:GetCPLListRequest>
                        </soapenv:Body>
                    </soapenv:Envelope>';
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'get_cpl_list', getenv('FNF_CPL_URL') . $endPoint, $postData, array(), $orderDetails['order_id'], 0);
        $resultCplList = $this->make_request('POST', $endPoint, 'cpl', $postData, $vendorTokenData['token'], 'GetCPLList');
        $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'get_cpl_list', getenv('FNF_CPL_URL') . $endPoint, $postData, $resultCplList, $orderDetails['order_id'], $logid);
        $responseData = $this->CI->natic->xml2array($resultCplList, 0);

        if (!empty($responseData['s:Envelope']['s:Body']['GetCPLListResponse']['UnderwriterStateCPLs']['a:UnderwriterStateCPL'])) {
            return array('success' => true, 'response' => $responseData['s:Envelope']['s:Body']['GetCPLListResponse']['UnderwriterStateCPLs']['a:UnderwriterStateCPL']);
        } else {
            return array('success' => false, 'error' => 'Something Went Wrong during generate CPL request.');
        }
    }

    public function generateCpl($orderDetails, $vendorTokenData, $userTokenData)
    {
        $this->CI->load->library('order/natic');
        if (!empty($this->CI->session->userdata('user'))) {
            $userdata = $this->CI->session->userdata('user');
        } else if (!empty($this->CI->session->userdata('admin'))) {
            $userdata = $this->CI->session->userdata('admin');
        } else {
            $userdata = array();
            $userdata['id'] = 0;
        }
        $propertyDetail = explode(",", $orderDetails['full_address']);
        $agentsInfo = $this->getAgents($orderDetails['fnf_agent_id']);
        $propery = array(
            'address' => $orderDetails['cpl_proposed_property_address'],
            'city' => $orderDetails['cpl_proposed_property_city'],
            'state' => $orderDetails['cpl_proposed_property_state'],
            'zip' => $orderDetails['cpl_proposed_property_zip'],
        );
        $borrower = $orderDetails['borrowers_vesting'];

        $loanNumberField = '';
        if (!empty($orderDetails['loan_number'])) {
            $loanNumberField = '<a:NameValue>
                                    <a:Name>[Loan Number]</a:Name>
                                    <a:Value>' . $orderDetails['loan_number'] . '</a:Value>
                                </a:NameValue>';
        }
        $agentPhoneField = '';
        if (!empty($$agentsInfo['phone_number'])) {
            $agentPhoneField = '<a:NameValue>
                                    <a:Name>[Agent/Company Telephone]</a:Name>
                                    <a:Value>' . $agentsInfo['phone_number'] . '</a:Value>
                                </a:NameValue>';
        }

        $this->CI->load->model('order/home_model');
        $orderUser = $this->CI->home_model->get_user(array('id' => $orderDetails['customer_id']));
        $lenderName = $orderDetails['lender_company_name'];
        $lenderAttnName = $orderDetails['lender_first_name'] . " " . $orderDetails['lender_last_name'];

        if (!empty($orderDetails['cpl_lender_company_id'])) {
            // echo "In if <pre>";
            $lenderDetails = $this->CI->home_model->get_sp_company(array('id' => $orderDetails['cpl_lender_company_id']));
            $lenderFormData = $this->CI->session->has_userdata('lender_details') ? $this->CI->session->userdata('lender_details') : [];
            // print_r($lenderFormData);die;
            $orderDetails['lender_assignment_clause'] = (!empty($lenderFormData) ? $lenderFormData['assignment_clause'] : ($lenderDetails['assignment_clause'] ? $lenderDetails['assignment_clause'] : ''));
            $orderDetails['lender_address'] = !empty($lenderFormData) ? $lenderFormData['address1'] : $lenderDetails['address1'];
            $orderDetails['lender_city'] = !empty($lenderFormData) ? $lenderFormData['city'] : $lenderDetails['city'];
            $orderDetails['lender_state'] = !empty($lenderFormData) ? $lenderFormData['state'] : $lenderDetails['state'];
            $orderDetails['lender_zipcode'] = !empty($lenderFormData) ? $lenderFormData['zip'] : $lenderDetails['zip'];
            $lenderName = !empty($lenderFormData) ? $lenderFormData['company_name'] : $lenderDetails['name'];
            $lenderAttnName = !empty($lenderFormData) ? $lenderFormData['lender_fullname'] : $lenderDetails['first_name'] . " " . $lenderDetails['last_name'];
        }
        // echo "Outside if";die;
        $endPoint = 'v3/CPLManagement.svc';

        $postData = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
                        <s:Body>
                            <GenerateCPLRequest xmlns="http://cpl.fnf.com/services/v3/cplmanagement/">
                                <CPLInformation xmlns:a="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.V3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                                    <a:CLUP>' . $orderDetails['agent_number'] . '</a:CLUP>
                                    <a:DBAsIndicator>false</a:DBAsIndicator>
                                    <a:FormName>' . $orderDetails['formname'] . '</a:FormName>
                                    <a:LegalNameIndicator>true</a:LegalNameIndicator>
                                    <a:OrderNumber>' . $orderDetails['file_number'] . '</a:OrderNumber>
                                    <a:RecipientTypes xmlns:b="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.Enums">
                                        <b:RecipientType>Lender</b:RecipientType>
                                    </a:RecipientTypes>
                                    <a:StateAbbreviation>' . $propery['state'] . '</a:StateAbbreviation>
                                    <a:UnderwriterShortName>' . $orderDetails['underwriter_code'] . '</a:UnderwriterShortName>
                                </CPLInformation>
                                <ContextUser s:nil="true"/>
                                <FormFields xmlns:a="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.V3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                                    <a:NameValue>
                                        <a:Name>[Buyer/Borrower Name]</a:Name>
                                        <a:Value>' . htmlspecialchars($borrower, ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Name]</a:Name>
                                        <a:Value>' . htmlspecialchars($lenderName, ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Clause]</a:Name>
                                        <a:Value>' . $orderDetails['lender_assignment_clause'] . '</a:Value>
                                    </a:NameValue>

                                    <a:NameValue>
                                        <a:Name>[Lender Address 1]</a:Name>
                                        <a:Value>' . $orderDetails['lender_address'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender City]</a:Name>
                                        <a:Value>' . $orderDetails['lender_city'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender State]</a:Name>
                                        <a:Value>' . $orderDetails['lender_state'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Zip Code]</a:Name>
                                        <a:Value>' . $orderDetails['lender_zipcode'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Attention]</a:Name>
                                        <a:Value>' . htmlspecialchars($lenderAttnName, ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    ' . $loanNumberField . '
                                    <a:NameValue>
                                        <a:Name>[Underwriter]</a:Name>
                                        <a:Value>' . $orderDetails['underwriter_code'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property Street Address]</a:Name>
                                        <a:Value>' . $propery['address'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property City]</a:Name>
                                        <a:Value>' . $propery['city'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property County]</a:Name>
                                        <a:Value>' . $orderDetails['county'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property State]</a:Name>
                                        <a:Value>' . $propery['state'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property Zip Code]</a:Name>
                                        <a:Value>' . $propery['zip'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Date]</a:Name>
                                        <a:Value>' . date('m/d/Y') . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[File Number]</a:Name>
                                        <a:Value>' . $orderDetails['file_number'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company City]</a:Name>
                                        <a:Value>' . $agentsInfo['location_city'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company Name]</a:Name>
                                        <a:Value>Pacific Coast Title Company</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company State]</a:Name>
                                        <a:Value>CA</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company Street Address]</a:Name>
                                        <a:Value>' . $agentsInfo['address'] . '</a:Value>
                                    </a:NameValue>
                                    ' . $agentPhoneField . '
                                    <a:NameValue>
                                        <a:Name>[Agent/Company Zip Code]</a:Name>
                                        <a:Value>' . $agentsInfo['zip'] . '</a:Value>
                                    </a:NameValue>
                                </FormFields>
                                <OnBehalfOfUser>' . getenv('FNF_ON_BEHALF_OF_USER') . '</OnBehalfOfUser>
                                <TraxToken>' . $userTokenData['token'] . '</TraxToken>
                            </GenerateCPLRequest>
                        </s:Body>
                    </s:Envelope>';
        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'generate_cpl', getenv('FNF_CPL_URL') . $endPoint, $postData, array(), $orderDetails['order_id'], 0);
        $resultForCPL = $this->make_request('POST', $endPoint, 'cpl', $postData, $vendorTokenData['token'], 'CreateCPL');
        $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'generate_cpl', getenv('FNF_CPL_URL') . $endPoint, $postData, $resultForCPL, $orderDetails['order_id'], $logid);
        $responseData = $this->CI->natic->xml2array($resultForCPL, 0);

        if (!empty($responseData['s:Envelope']['s:Body']['GenerateCPLResponse']['CPLLetters']['a:CPLLetter'])) {
            return array('success' => true, 'response' => $responseData['s:Envelope']['s:Body']['GenerateCPLResponse']['CPLLetters']['a:CPLLetter']);
        } else {
            return array('success' => false, 'error' => 'Something Went Wrong during generate CPL request.');
        }
    }

    public function editCpl($orderDetails, $vendorTokenData, $userTokenData)
    {
        $this->CI->load->library('order/natic');
        if (!empty($this->CI->session->userdata('user'))) {
            $userdata = $this->CI->session->userdata('user');
        } else if (!empty($this->CI->session->userdata('admin'))) {
            $userdata = $this->CI->session->userdata('admin');
        } else {
            $userdata = array();
            $userdata['id'] = 0;
        }
        $propertyDetail = explode(",", $orderDetails['full_address']);
        $agentsInfo = $this->getAgents($orderDetails['fnf_agent_id']);
        $propery = array(
            'address' => $orderDetails['cpl_proposed_property_address'],
            'city' => $orderDetails['cpl_proposed_property_city'],
            'state' => $orderDetails['cpl_proposed_property_state'],
            'zip' => $orderDetails['cpl_proposed_property_zip'],
        );
        $borrower = $orderDetails['borrowers_vesting'];

        $loanNumberField = '';
        if (!empty($orderDetails['loan_number'])) {
            $loanNumberField = '<a:NameValue>
                                    <a:Name>[Loan Number]</a:Name>
                                    <a:Value>' . $orderDetails['loan_number'] . '</a:Value>
                                </a:NameValue>';
        }
        $agentPhoneField = '';
        if (!empty($agentsInfo['phone_number'])) {
            $agentPhoneField = '<a:NameValue>
                                    <a:Name>[Agent/Company Telephone]</a:Name>
                                    <a:Value>' . $agentsInfo['phone_number'] . '</a:Value>
                                </a:NameValue>';
        }
        $this->CI->load->model('order/home_model');
        $orderUser = $this->CI->home_model->get_user(array('id' => $orderDetails['customer_id']));
        $lenderName = $orderDetails['lender_company_name'];
        $lenderAttnName = $orderDetails['sp_lender_first_name'] . " " . $orderDetails['sp_lender_last_name'];
        if (!empty($orderDetails['cpl_lender_company_id'])) {
            $lenderDetails = $this->CI->home_model->get_sp_company(array('id' => $orderDetails['cpl_lender_company_id']));
            $lenderFormData = $this->CI->session->has_userdata('lender_details') ? $this->CI->session->userdata('lender_details') : [];
            $orderDetails['lender_assignment_clause'] = $lenderDetails['assignment_clause'] ? $lenderDetails['assignment_clause'] : '';
            $orderDetails['lender_address'] = $lenderDetails['address1'];
            $orderDetails['lender_city'] = $lenderDetails['city'];
            $orderDetails['lender_state'] = $lenderDetails['state'];
            $orderDetails['lender_zipcode'] = $lenderDetails['zip'];
            $lenderName = $lenderDetails['name'];
            // $lenderAttnName = $lenderDetails['first_name'] . " " . $lenderDetails['last_name'];
            $lenderAttnName = !empty($lenderFormData) ? $lenderFormData['lender_fullname'] : $lenderDetails['first_name'] . " " . $lenderDetails['last_name'];
        }

        $endPoint = 'v3/CPLManagement.svc';
        $postData = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
                        <s:Body>
                            <GenerateCPLRequest xmlns="http://cpl.fnf.com/services/v3/cplmanagement/">
                                <CPLInformation xmlns:a="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.V3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                                    <a:CLUP>' . $orderDetails['agent_number'] . '</a:CLUP>
                                    <a:DBAsIndicator>false</a:DBAsIndicator>
                                    <a:DocumentId>' . $orderDetails['fnf_document_id'] . '</a:DocumentId>
                                    <a:LegalNameIndicator>true</a:LegalNameIndicator>
                                    <a:OrderNumber>' . $orderDetails['file_number'] . '</a:OrderNumber>
                                    <a:RecipientTypes xmlns:b="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.Enums">
                                        <b:RecipientType>Lender</b:RecipientType>
                                    </a:RecipientTypes>
                                    <a:StateAbbreviation>' . $propery['state'] . '</a:StateAbbreviation>
                                    <a:UnderwriterShortName>' . $orderDetails['underwriter_code'] . '</a:UnderwriterShortName>
                                </CPLInformation>
                                <ContextUser s:nil="true"/>
                                <FormFields xmlns:a="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.V3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
                                    <a:NameValue>
                                        <a:Name>[Buyer/Borrower Name]</a:Name>
                                        <a:Value>' . htmlspecialchars($borrower, ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Name]</a:Name>
                                        <a:Value>' . htmlspecialchars($lenderName, ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Clause]</a:Name>
                                        <a:Value>' . htmlspecialchars($orderDetails['lender_assignment_clause'], ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Address 1]</a:Name>
                                        <a:Value>' . $orderDetails['lender_address'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender City]</a:Name>
                                        <a:Value>' . $orderDetails['lender_city'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender State]</a:Name>
                                        <a:Value>' . $orderDetails['lender_state'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Zip Code]</a:Name>
                                        <a:Value>' . $orderDetails['lender_zipcode'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Lender Attention]</a:Name>
                                        <a:Value>' . htmlspecialchars($lenderAttnName, ENT_XML1) . '</a:Value>
                                    </a:NameValue>
                                    ' . $loanNumberField . '
                                    <a:NameValue>
                                        <a:Name>[Underwriter]</a:Name>
                                        <a:Value>' . $orderDetails['underwriter_code'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property Street Address]</a:Name>
                                        <a:Value>' . $propery['address'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property City]</a:Name>
                                        <a:Value>' . $propery['city'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property County]</a:Name>
                                        <a:Value>' . $orderDetails['county'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property State]</a:Name>
                                        <a:Value>' . $propery['state'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Property Zip Code]</a:Name>
                                        <a:Value>' . $propery['zip'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Date]</a:Name>
                                        <a:Value>' . date('m/d/Y') . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[File Number]</a:Name>
                                        <a:Value>' . $orderDetails['file_number'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company City]</a:Name>
                                        <a:Value>' . $agentsInfo['location_city'] . '</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company Name]</a:Name>
                                        <a:Value>Pacific Coast Title Company</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company State]</a:Name>
                                        <a:Value>CA</a:Value>
                                    </a:NameValue>
                                    <a:NameValue>
                                        <a:Name>[Agent/Company Street Address]</a:Name>
                                        <a:Value>' . $agentsInfo['address'] . '</a:Value>
                                    </a:NameValue>
                                    ' . $agentPhoneField . '
                                    <a:NameValue>
                                        <a:Name>[Agent/Company Zip Code]</a:Name>
                                        <a:Value>' . $agentsInfo['zip'] . '</a:Value>
                                    </a:NameValue>
                                </FormFields>
                                <OnBehalfOfUser>' . getenv('FNF_ON_BEHALF_OF_USER') . '</OnBehalfOfUser>
                                <TraxToken>' . $userTokenData['token'] . '</TraxToken>
                            </GenerateCPLRequest>
                        </s:Body>
                    </s:Envelope>';

        $logid = $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'edit_cpl', getenv('FNF_CPL_URL') . $endPoint, $postData, array(), $orderDetails['order_id'], 0);
        $resultForCPL = $this->make_request('POST', $endPoint, 'cpl', $postData, $vendorTokenData['token'], 'EditCPL');
        $this->CI->apiLogs->syncLogs($userdata['id'], 'fnf', 'edit_cpl', getenv('FNF_CPL_URL') . $endPoint, $postData, $resultForCPL, $orderDetails['order_id'], $logid);
        $responseData = $this->CI->natic->xml2array($resultForCPL, 0);

        if (!empty($responseData['s:Envelope']['s:Body']['GenerateCPLResponse']['CPLLetters']['a:CPLLetter'])) {
            return array('success' => true, 'response' => $responseData['s:Envelope']['s:Body']['GenerateCPLResponse']['CPLLetters']['a:CPLLetter']);
        } else {
            if (empty($responseData['s:Envelope']['s:Body']['GenerateCPLResponse']['CPLLetters'])) {
                $this->generateCpl($orderDetails, $vendorTokenData, $userTokenData);
            } else {
                return array('success' => false, 'error' => 'Something Went Wrong during generate CPL request.');
            }
        }
    }
}
