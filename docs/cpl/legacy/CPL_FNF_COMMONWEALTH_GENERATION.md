# FNF / Commonwealth CPL Generation — Technical Reference

> **Status**: Rewritten to match legacy PHP exactly (Fnf.php + Common.php)
> **Last updated**: March 2026

## Overview

The FNF/Commonwealth CPL integration generates Closing Protection Letters via FNF's SOAP-based CPLManagement service. This document describes the exact flow as ported from the legacy PHP implementation.

## Source of Truth

1. `docs/cpl/legacy/Fnf.php` — FNF library (auth, SOAP calls, response parsing)
2. `docs/cpl/legacy/Common.php` — Controller (create/edit routing, post-processing)
3. `docs/cpl/legacy/FNF-Commonwealth CPL Legacy Handoff.md` — Handoff guide

## Environment Variables

| Variable | Purpose |
|---|---|
| `FNF_VENDOR_URL` | Base URL for vendor auth (e.g. `https://...fnf.com/`) |
| `FNF_USER_URL` | Base URL for user auth + agents API |
| `FNF_CPL_URL` | Base URL for SOAP CPLManagement service |
| `FNF_CLIENT_ID` | FNF client identifier |
| `FNF_SECRET_KEY` | FNF secret key |
| `FNF_ON_BEHALF_OF_USER` | User identity for SOAP requests |

## File Map

| File | Purpose |
|---|---|
| `src/lib/integrations/cpl/fnf/auth.ts` | Vendor + user token acquisition (JWT) |
| `src/lib/integrations/cpl/fnf/soap.ts` | SOAP envelope builders + HTTP calls + response parsing |
| `src/lib/integrations/cpl/fnf/client.ts` | CplAdapter implementation — orchestrates the full flow |

## Flow

### Step 1: Authenticate

Two-tier JWT authentication matching legacy `generateVendorToken` + `generateUserToken`:

**Vendor Token**:
- `POST {FNF_VENDOR_URL}api/FnfAuthIdentityProvider/GetToken`
- Body: `{ clientId, secretKey }`
- Headers: `Content-Type: application/json`
- Response field: `jwtToken` (no fallbacks)
- Cached in `vendor_tokens` table, keyed by `expiresAt` from response

**User Token**:
- `POST {FNF_USER_URL}userToken`
- Body: `{ accessToken: vendorToken, onBehalfOfUser }`
- Headers: `Content-Type: application/json`, `Authorization: Bearer {vendorToken}`
- Response field: `user_token` (no fallbacks)
- Cached in `vendor_tokens` table

### Step 2: Load Agent (CLUP)

Matching legacy `getAgents($id)` — reads from `cpl_branches` table (td-hub equivalent of `pct_order_fnf_agents`).

Fields used: `branch_code` (CLUP/agent_number), `underwriter_code`, `address`, `city`, `state`, `zip`, `phone`.

### Step 3: GetCPLList

Matching legacy `getCPLForm()`:

- Endpoint: `{FNF_CPL_URL}v3/CPLManagement.svc`
- SOAPAction: `GetCPLList`
- Authorization: `Bearer {vendorToken}` (NOT userToken)
- ClientID header: `{FNF_CLIENT_ID}`

Envelope namespace: `xmlns:cpl="http://cpl.fnf.com/services/v3/cplmanagement/"`

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cpl="http://cpl.fnf.com/services/v3/cplmanagement/">
  <soapenv:Header/>
  <soapenv:Body>
    <cpl:GetCPLListRequest>
      <cpl:CLUP>{agent_number}</cpl:CLUP>
      <cpl:OnBehalfOfUser>{FNF_ON_BEHALF_OF_USER}</cpl:OnBehalfOfUser>
      <cpl:OrderNumber>{file_number}</cpl:OrderNumber>
      <cpl:StateAbbreviation>{state}</cpl:StateAbbreviation>
      <cpl:UnderwriterShortName>{underwriter_code}</cpl:UnderwriterShortName>
    </cpl:GetCPLListRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

Response path: `s:Envelope → s:Body → GetCPLListResponse → UnderwriterStateCPLs → a:UnderwriterStateCPL`

### Step 4: Select Form

Legacy hardcodes: `'Standard CPL_' + property_state` (Common.php line 2327).

### Step 5: Create vs Edit Decision

From legacy Common.php line 2247:

```
IF fnf_document_id exists → EditCPL
  IF EditCPL returns empty CPLLetters → fallback to CreateCPL
ELSE → CreateCPL
```

In td-hub, `fnf_document_id` is stored in `order_external_refs` (system='fnf', refType='fnf_document_id').

### Step 6: GenerateCPL (Create or Edit)

- Endpoint: `{FNF_CPL_URL}v3/CPLManagement.svc`
- SOAPAction: `CreateCPL` or `EditCPL`
- Authorization: `Bearer {vendorToken}` (NOT userToken)
- ClientID header: `{FNF_CLIENT_ID}`

Root namespace: `xmlns="http://cpl.fnf.com/services/v3/cplmanagement/"`

**Create** — includes `<a:FormName>`, no `<a:DocumentId>`:

```xml
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GenerateCPLRequest xmlns="http://cpl.fnf.com/services/v3/cplmanagement/">
      <CPLInformation xmlns:a="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.V3"
                      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <a:CLUP>{agent_number}</a:CLUP>
        <a:DBAsIndicator>false</a:DBAsIndicator>
        <a:FormName>{formName}</a:FormName>
        <a:LegalNameIndicator>true</a:LegalNameIndicator>
        <a:OrderNumber>{file_number}</a:OrderNumber>
        <a:RecipientTypes xmlns:b="http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.Enums">
          <b:RecipientType>Lender</b:RecipientType>
        </a:RecipientTypes>
        <a:StateAbbreviation>{state}</a:StateAbbreviation>
        <a:UnderwriterShortName>{underwriter_code}</a:UnderwriterShortName>
      </CPLInformation>
      <ContextUser s:nil="true"/>
      <FormFields xmlns:a="..." xmlns:xsi="...">
        <!-- 23 NameValue pairs — see FormFields section -->
      </FormFields>
      <OnBehalfOfUser>{FNF_ON_BEHALF_OF_USER}</OnBehalfOfUser>
      <TraxToken>{user_token}</TraxToken>
    </GenerateCPLRequest>
  </s:Body>
</s:Envelope>
```

**Edit** — includes `<a:DocumentId>`, no `<a:FormName>`:

Same structure but CPLInformation contains `<a:DocumentId>` instead of `<a:FormName>`.

### FormFields (NameValue Pairs)

All fields use `<a:NameValue><a:Name>...</a:Name><a:Value>...</a:Value></a:NameValue>` format.

| # | Name | Source | Notes |
|---|---|---|---|
| 1 | `[Buyer/Borrower Name]` | borrower vesting | XML-escaped |
| 2 | `[Lender Name]` | lender company name | XML-escaped |
| 3 | `[Lender Clause]` | assignment clause | |
| 4 | `[Lender Address 1]` | lender address | |
| 5 | `[Lender City]` | lender city | |
| 6 | `[Lender State]` | lender state | |
| 7 | `[Lender Zip Code]` | lender zip | |
| 8 | `[Lender Attention]` | lender contact name | XML-escaped |
| 9 | `[Loan Number]` | loan number | **Conditional** — only if non-empty |
| 10 | `[Underwriter]` | underwriter_code | From agent/branch |
| 11 | `[Property Street Address]` | property address | User override or order |
| 12 | `[Property City]` | property city | User override or order |
| 13 | `[Property County]` | county | |
| 14 | `[Property State]` | property state | User override or order |
| 15 | `[Property Zip Code]` | property zip | User override or order |
| 16 | `[Date]` | current date | Format: `MM/DD/YYYY` |
| 17 | `[File Number]` | file number | |
| 18 | `[Agent/Company City]` | agent city | From cpl_branches |
| 19 | `[Agent/Company Name]` | **hardcoded** | `Pacific Coast Title Company` |
| 20 | `[Agent/Company State]` | **hardcoded** | `CA` |
| 21 | `[Agent/Company Street Address]` | agent address | From cpl_branches |
| 22 | `[Agent/Company Telephone]` | agent phone | **Conditional** — only if non-empty |
| 23 | `[Agent/Company Zip Code]` | agent zip | From cpl_branches |

### Step 7: Response Parsing

Path: `s:Envelope → s:Body → GenerateCPLResponse → CPLLetters → a:CPLLetter`

| Field | XML Path | Usage |
|---|---|---|
| PDF content | `a:Content` | Base64-encoded PDF |
| Document ID | `a:DocumentId` | Stored for future Edit calls |

### Step 8: Post-Processing

After successful CPL generation:
1. Base64-decode PDF → upload to S3
2. Store `fnf_document_id` in `order_external_refs` (for future Edit)
3. Store `fnf_cpl_id`, `fnf_cpl_number`, `fnf_form_name` as vendor refs
4. Persist user-entered data back to order (via `persistCplInputToOrder`)

## Hardcoded Values

| Value | Location | Notes |
|---|---|---|
| `Pacific Coast Title Company` | FormField `[Agent/Company Name]` | Legacy hardcoded |
| `CA` | FormField `[Agent/Company State]` | Legacy hardcoded |
| `Standard CPL_` + state | Form name selection | Legacy hardcoded in Common.php |

## Logging

Each step logs to `vendor_api_logs`:

| Operation | When |
|---|---|
| `get_vendor_token` | Auth step 1 |
| `get_user_token` | Auth step 2 |
| `get_agents` | Branch/agent loaded |
| `get_cpl_list` | GetCPLList SOAP call |
| `create_cpl` | CreateCPL SOAP call |
| `edit_cpl` | EditCPL SOAP call |
| `parse_pdf` | PDF extraction |
| `generate_cpl` | On error (catch-all) |

## Prerequisites

1. FNF environment variables must be set (see above)
2. FNF branches must be seeded in `cpl_branches` table with `underwriter = 'fnf'`
3. Branch must have: `branch_code` (CLUP), `underwriter_code`, `address`, `city`, `state`, `zip`, `phone`
