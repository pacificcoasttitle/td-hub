# CPL Underwriter Integrations

## Supported Underwriters

| Underwriter | Library | Transport | Auth |
|-------------|---------|-----------|------|
| Westcor | `Westcor.php` | REST/JSON | OAuth2 Resource Owner Password |
| FNF/Commonwealth | `Fnf.php` | REST + SOAP | Two-tier JWT |
| NATIC | `Natic.php` | XML/HTTP | Plaintext in XML body |
| Doma | `Natic.php` (variant) | XML/HTTP | Plaintext in XML body |

## Westcor
- **Auth:** OAuth2 grant -> Bearer token, stored in `pct_order_westcore_token`
- **Endpoints:** Token, VendorApi/Order/Update, VendorApi/Order/{id}, VendorApi/ClosingLetters/PrepareAddCPL
- **Form Selection:** `selectCplForm()` with single/multiple transaction modes
- **Config:** `WESTCORE_URL`, `WESTCORE_USERNAME`, `WESTCORE_PASSWORD`, `WESTCORE_GRANT_TYPE`, `WESTCORE_INTEGRATION_PARTNER`

## FNF/Commonwealth
- **Auth:** Vendor JWT token -> User token (on-behalf-of), SOAP with Bearer header
- **SOAP Namespace:** `http://cpl.fnf.com/services/v3/cplmanagement/`
- **Operations:** GetCPLList, CreateCPL, EditCPL
- **Config:** `FNF_VENDOR_URL`, `FNF_USER_URL`, `FNF_CPL_URL`, `FNF_CLIENT_ID`, `FNF_SECRET_KEY`, `FNF_ON_BEHALF_OF_USER`

## NATIC / Doma
- **Auth:** Username + password in XML request body (NATIC password has `#` appended)
- **Endpoints:** Authorize, GetDocuments
- **Config (NATIC):** `NATIC_USERNAME`, `NATIC_PASSWORD`, `NATIC_COMPANY`, `NATIC_URL`, `NATIC_DOCUMENT_ID`
- **Config (Doma):** `DOMA_USERNAME`, `DOMA_PASSWORD`, `DOMA_COMPANY`, `DOMA_URL`, `DOMA_DOCUMENT_ID`

## CPL Lifecycle
1. Branch/agent selection (admin CPL controller)
2. Order data enrichment (buyer/seller/lender/property from DB)
3. API call to underwriter
4. PDF saved to `uploads/cpl_documents/`
5. Upload to AWS S3
6. Push to SoftPro via `uploadCPLDocumentToSoftpro()`
7. Notification sent on success, error logged on failure
8. `order_details.cpl_document_name` updated

## Admin Routes
- `order/admin/north-american-branches` (NATIC)
- `order/admin/doma-branches` (Doma)
- `order/admin/westcor-branches` (Westcor)
- `order/admin/commonwealth-branches` (FNF)
