# Other Vendor Integrations

## Twilio (SMS)
- **Library:** `Twilio.php` (~50 lines)
- **Transport:** Twilio PHP SDK (`Twilio\Rest\Client`)
- **Purpose:** Send SMS messages (with optional MMS)
- **Config:** `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` (some commented out)
- **Status:** Partially active, some notification paths commented out

## Adobe Sign (eSignature)
- **Library:** `Adobe.php` (~80 lines)
- **Transport:** REST/JSON via cURL
- **API Base:** `https://api.na3.adobesign.com/` (v6)
- **Auth:** Static bearer token (`ADOBE_SIGN_TOKEN`)
- **Purpose:** Send documents for electronic signature

## OpenAI/ChatGPT (Document Classification)
- **Library:** `ChatGPT.php` (~200 lines)
- **Transport:** REST/JSON via cURL
- **Auth:** Bearer API key (`CHAT_GPT_API_KEY`)
- **Model:** `o4-mini` (constructor) / `gpt-4o-mini` (retry method)
- **Purpose:** Classify real estate closing packages, extract lender details, identify document boundaries
- **Retry:** Exponential backoff (3 attempts, 2s/4s/8s delays)
- **Note:** Env var has typo: `CHAT_GPT_MODAL` (should be MODEL)

## Tessa (AI Prelim Analysis)
- **Library:** `Tessa.php` (~300 lines)
- **Transport:** REST/JSON via cURL
- **Endpoint:** `https://tessa-proxy.onrender.com/api/ask-tessa` (hardcoded, no auth)
- **Purpose:** AI-powered preliminary title report analysis with "Realtor Cheat Sheet"
- **PDF parsing:** Smalot PdfParser, text truncated to 15,000 chars
- **Security risk:** Open proxy endpoint with no authentication

## SimplyRETS (MLS/Property Data)
- **Library:** `Rets.php` (~100 lines)
- **Transport:** REST/JSON with HTTP Basic Auth
- **Endpoints:** `properties`, `agents`
- **Config:** `RETS_API_USERNAME`, `RETS_API_PASSWORD`, `RETS_API_ENDPOINT`
- **Bug:** Contains `print_r($endpoint)` debug output in production code
- **Note:** Commented-out PHRETS direct RETS integration to CRMLS

## OCR Service (Local)
- **Library:** `OcrService.php` (~150 lines)
- **Tools:** Tesseract, Poppler (pdftoppm), ImageMagick
- **Purpose:** PDF-to-text via OCR with rotation detection
- **Windows paths:** `C:\tools\poppler\`, `C:\Program Files\Tesseract-OCR\`

## AWS S3 (Document Storage)
- **Library:** Part of `Order.php` (lines ~2107-2252)
- **Transport:** AWS PHP SDK (`Aws\S3\S3Client`)
- **Operations:** putObject, deleteObject, doesObjectExist
- **Folders:** legal-vesting/, tax/, grant-deed/, cpl_documents/, pre-listing-doc/, lp-xml/, documents/, fees-pdf/, csv/
- **Config:** `AWS_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_PATH`

## Pusher (Real-time Notifications)
- **Library:** Part of `Order.php` (line ~3814)
- **Transport:** Pusher PHP SDK
- **Status:** DISABLED -- `$pusher->trigger()` is commented out
- **Config:** `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_APP_ID`, `PUSHER_CLUSTER`

## HomeDocs (Property Data)
- **Helper:** `homedocsapi_helper.php`
- **Transport:** REST/JSON via cURL
- **Auth:** Bearer token (`HOMEDOCS_TOKEN`)
- **Endpoints:** `/api/users`, `/api/store-property-detail`

## SendGrid (Email)
- **Helper:** `sendemail_helper.php`
- **Transport:** SMTP (port 587)
- **Config:** `SENDGRID_API_KEY`
- **Note:** Also configured in `email.php` with hardcoded password

## Resware (Legacy)
- **Library:** `Resware.php` (~200 lines)
- **Transport:** REST/JSON with HTTP Basic Auth
- **Status:** Being replaced by SoftPro. Some code paths still active.
- **Security issue:** Hardcoded passwords in TitlePoint controller
