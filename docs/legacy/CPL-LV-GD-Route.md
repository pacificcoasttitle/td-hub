This is from TransactionDeskClone on production-softpro. The SoftPro .NET AddDocuments implementation is not in this repo, so the PHP payload is exact; what SoftPro does with FolderName after that hop is not visible here.

1. Where LV, tax, and grant deed go in SoftPro
On order open, TitlePoint generates the PDFs, they are stored on S3, then PHP posts them to SoftPro ordercreation/AddDocuments.

Endpoint mapping:


constants.php
Ln 117–117
'upload_document' => 'ordercreation/AddDocuments',
The call from the create-order path (Home.php) after SoftPro returns an OrderNumber:


Home.php
Ln 1064–1177
if ((empty($titlePointShutOff) || $titlePointShutOff == 0) && $this->order->fileExistOrNotOnS3('legal-vesting/' . $lvfilename)) {
    ...
    $uploadFileToSoftPro[] = [
        "FolderName" => 'legal-vesting',
        "FileURL"    => env('AWS_PATH') . "legal-vesting/" . $lvfilename,
    ];
    ...
}
if (... && $this->order->fileExistOrNotOnS3('grant-deed/' . $deedfilename)) {
    $uploadFileToSoftPro[] = [
        "FolderName" => 'grant-deed',
        "FileURL"    => env('AWS_PATH') . "grant-deed/" . $deedfilename,
    ];
    ...
}
if (... && $this->order->fileExistOrNotOnS3('tax/' . $taxfilename)) {
    $uploadFileToSoftPro[] = [
        "FolderName" => 'tax',
        "FileURL"    => env('AWS_PATH') . "tax/" . $taxfilename,
    ];
    ...
}
...
    $fileData = [
        "Id" => $fileUploadLogId,
        "OrderNumber"  => $orderNumber,
        "DocumentName" => $orderNumber,
        "FileList"     => $uploadFileToSoftPro,
    ];
    ...
    $result = $this->softpro->make_request('POST', 'upload_document', $reqData);
What is sent:

Doc	S3 object	SoftPro FolderName	Attached to
Legal & vesting
{AWS_PATH}legal-vesting/{OrderNumber}.pdf
'legal-vesting'
SoftPro order OrderNumber
Grant deed
{AWS_PATH}grant-deed/{OrderNumber}.pdf
'grant-deed'
same
Tax
{AWS_PATH}tax/{OrderNumber}.pdf
'tax'
same
The request is an array of { Id, OrderNumber, DocumentName, FileList: [{ FolderName, FileURL }] }. SoftPro is told the order number and a folder name string. There is no document-type ID, no cabinet ID, and no delete/replace flag on this call.

PHP also writes a pct_order_documents row with is_lv_doc / is_grant_doc / is_tax_doc = 1, and a sp_file_upload_logs row. Failed uploads (is_synced = 0) are retried by Cron::spSyncFailedDocument against the same AddDocuments endpoint.

If TitlePoint is still generating at submit time, the S3 fileExistOrNotOnS3 check fails and that file is not in the first SoftPro post. Cron generateLVDocument / generateTaxDocument only write S3; they do not call SoftPro. A later SoftPro upload only happens if something else queues sp_file_upload_logs.

Fees PDF is also posted with FolderName => 'tax' (same folder string as the tax bill).

2. Admin — yes
Admin Documents (sidebar, newsidebar.php 407–417):

Page	Route	Source
Legal & Vesting
order/admin/lv-documents
pct_order_documents where is_lv_doc = 1
Grant Deed
order/admin/grant-deed-documents
grant-deed S3 + document list
Tax
order/admin/tax-documents
is_tax_doc = 1
CPL
order/admin/cpl-documents
cpl_document_name
Each list has a download that points at S3 (legal-vesting/, grant-deed/, tax/, cpl_documents/).

Admin Logs also has Legal Vesting, Grant Deed, Tax Document, Tax Data, CPL Error.

These are company-wide document inventories, not a per-file viewer.

3. Sales-rep dashboards — partial
Sales dashboard file list (SalesRep.php): the live action is Review Prelim (S3 documents/{prelim}). The old REVIEW FILE link is commented out.

Prelim Files (/prelim-files → Common::prelimFiles → get_orders_prelim): Review File goes to /review-file/{orderId}.

That page (view_review_file.php) is the per-file document viewer. Doc Links:

Summary, Prelim
Linked Docs (prelim-linked)
Legal Vesting — dedicated tab, S3 legal-vesting/{file_number}.pdf (Common::legal_vesting)
Plat Map
Uploaded Docs — only rows where is_grant_doc, is_cpl_doc, or is_proposed_insured_doc is 1:

Order.php
Ln 1830–1834
$this->CI->db->group_start()
    ->where('pct_order_documents.is_grant_doc', 1)
    ->or_where('pct_order_documents.is_cpl_doc', 1)
    ->or_where('pct_order_documents.is_proposed_insured_doc', 1)
    ->group_end();
So on the file viewer:

Doc	On sales-rep file view?
Legal vesting
Yes — dedicated “Legal Vesting” link
Grant deed
Yes — under Uploaded Docs, if the row was written at open
Tax
No — not in that query, no tax tab
CPL
Yes — Uploaded Docs, after a CPL is generated
CPL also has its own sales-rep page: /cpl-dashboard (Common::cpl / get_orders_cpl) with Download / Edit / Generate.

load_doc for grant deed reads S3 grant-deed/. For everything else that is not grant/proposed-insured it reads S3 documents/ — so LV opened via Uploaded Docs would be the wrong bucket; LV is meant to go through legal_vesting().

4. New CPL superseding an old one
There is no delete, replace, or SoftPro “supersede” call. A new CPL is added; the pointer on the order moves.

Filename is incremented, not overwritten:


Document.php
Ln 64–75
public function countCplDocument($orderId)
{
    ...
    $this->db->where('is_cpl_doc', 1);
    $this->db->where('order_id', $orderId);
    ...
        return $query->num_rows()+1;
    } else {
        return 1;
    }
Westcor example: westcor_{file_number}_{count}.pdf. FNF: fnf_{file_number}_{count}.pdf.

Local pointer order_details.cpl_document_name is overwritten to the new name. The previous PDF stays on S3 and the previous pct_order_documents row stays (is_cpl_doc = 1). Admin CPL list and Review File Uploaded Docs can show more than one. The dashboard Download button uses the current cpl_document_name only.

SoftPro: every generate calls uploadCPLDocumentToSoftpro, which adds another document:


Order.php
Ln 3354–3377
$fileList[] = [
    "FolderName" => 'CPL',
    "FileURL"    => env('AWS_PATH') . "cpl_documents/" . $documentName,
];
...
$result   = $this->CI->softpro->make_request('POST', 'upload_document', $reqData);
No code removes the prior SoftPro CPL. SoftPro can accumulate multiple files in folder 'CPL'.

Underwriter side:

Westcor: CPLID = -1 and PrepareAddCPL — another CPL is added on the Westcor order. westcor_cpl_id / westcor_file_id are updated to the newest.
FNF: if fnf_document_id already exists (and the order is not older than 2021-01-29), editCpl is used (same FNF document id). Otherwise generateCpl creates a new one. Either way PHP still writes a new local/S3 filename and still AddDocuments to SoftPro.
is_regenerate_cpl: addLenderOnOrder writes $_POST['editFlag'] into that column. There is no editFlag field in cpl.php or cpl.js, so that post is empty unless something else sends it. Nothing later reads is_regenerate_cpl to delete or hide the old CPL.

Notifications fire again (“CPL document generated for order number #…”).

Short answers: SoftPro gets them via AddDocuments on that order, filed under folder strings 'legal-vesting', 'grant-deed', 'tax'. Admin has dedicated document lists for all three. Sales reps get LV and grant deed on Review File (/prelim-files → /review-file/{id}), not tax; the main sales dashboard only surfaces prelim. A new CPL does not replace the old one in SoftPro or on disk — it adds another file and moves the order’s current-name pointer.