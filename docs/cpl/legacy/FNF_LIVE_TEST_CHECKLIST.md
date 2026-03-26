# FNF / Commonwealth CPL — Live Validation Test Checklist

> **Scope**: Controlled live tests against the FNF production SOAP service  
> **Rule**: Use ONLY fresh test orders. Never re-use existing production orders.  
> **Commit under test**: `52bb97e` — strict port from legacy PHP

---

## Prerequisites

Before any test, verify these exist:

### 1. Environment variables (Vercel / .env.local)

```
FNF_VENDOR_URL=https://...fnf.com/           # Must end with /
FNF_USER_URL=https://...fnf.com/              # Must end with /
FNF_CPL_URL=https://...fnf.com/               # Must end with /
FNF_CLIENT_ID=<your-client-id>
FNF_SECRET_KEY=<your-secret-key>
FNF_ON_BEHALF_OF_USER=<user-email>
AWS_PATH=https://<bucket>.s3.<region>.amazonaws.com/   # Required for SoftPro
```

Verify:

```sql
-- Confirm env vars are reaching the runtime
-- If vendor token request fails with NETWORK_ERROR, the URL is wrong
```

### 2. FNF branches seeded in `cpl_branches`

```sql
SELECT id, branch_code, branch_name, underwriter_code, address, city, state, zip, phone
FROM cpl_branches
WHERE underwriter = 'fnf' AND is_active = true;
```

**Required fields per row**: `branch_code` (CLUP), `underwriter_code`, `address`, `city`, `state`, `zip`, `phone`.

If zero rows: seed at least one branch before proceeding.

### 3. Fresh test order

Create or identify a fresh order with:
- A valid `file_number`
- A property with `address`, `city`, `state` = `CA`, `zip`, `county`
- At least one buyer party (for `borrowers_vesting`)
- Optionally a lender party

```sql
SELECT o.id, o.file_number, op.address, op.city, op.state, op.zip, op.county
FROM orders o
JOIN order_properties op ON op.order_id = o.id
WHERE o.file_number = '<YOUR_TEST_FILE_NUMBER>';
```

### 4. Confirm no existing `fnf_document_id` for CreateCPL test

```sql
SELECT * FROM order_external_refs
WHERE order_id = <TEST_ORDER_ID> AND system = 'fnf' AND ref_type = 'fnf_document_id';
-- Should return 0 rows for Test 1 (CreateCPL path)
```

---

## Test 1: CreateCPL on Fresh Order (No `fnf_document_id`)

**Goal**: Validate the full happy path — auth, GetCPLList, form selection, CreateCPL, PDF extraction, save-back.

### Steps

1. Open the CPL modal for the fresh test order in the td-hub UI
2. Select underwriter: **FNF** (Commonwealth)
3. Select an FNF branch from the dropdown (note the `branch_id`)
4. Fill in lender information (name, address, city, state, zip)
5. Optionally fill borrower names override, loan number, assignment clause
6. Click **Generate CPL**

**Alternative — direct API call**:

```bash
curl -X POST https://<your-domain>/api/vendor-actions/cpl \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{
    "orderId": <TEST_ORDER_ID>,
    "underwriter": "fnf",
    "branchId": <BRANCH_ID>,
    "lenderCompany": "Test Lender Corp",
    "lenderContact": "John Doe",
    "lenderAddress": "123 Main St",
    "lenderCity": "Los Angeles",
    "lenderState": "CA",
    "lenderZip": "90001",
    "assignmentClause": "Test assignment clause",
    "loanNumber": "LN-123456",
    "borrowerNames": "Jane Smith; John Smith"
  }'
```

### Expected API Response

```json
{
  "success": true,
  "documentId": <integer>,
  "warnings": undefined
}
```

### Expected `vendor_api_logs` Rows

Query after test:

```sql
SELECT operation, success, error_category, request_meta
FROM vendor_api_logs
WHERE vendor = 'fnf' AND request_id LIKE 'fnf-%'
ORDER BY started_at DESC
LIMIT 10;
```

| # | operation | success | error_category | request_meta (key fields) |
|---|-----------|---------|----------------|---------------------------|
| 1 | `get_vendor_token` | true | null | (httpStatus: 200) |
| 2 | `get_user_token` | true | null | (httpStatus: 200) |
| 3 | `get_agents` | true | null | `{ agentNumber, underwriterCode }` |
| 4 | `get_cpl_list` | true | null | `{ formCount, forms: [...] }` |
| 5 | `create_cpl` | true | null | `{ formName: "Standard CPL_CA", documentId, cplId, isEdit: false }` |
| 6 | `parse_pdf` | true | null | `{ pdfSizeBytes, documentId }` |

**Note**: `get_vendor_token` and `get_user_token` logs are in `auth.ts`. They may not appear if tokens were already cached in `vendor_tokens` table. To force fresh token logs, delete cached tokens first:

```sql
DELETE FROM vendor_tokens WHERE vendor = 'fnf';
```

### Expected Database State After Success

**`order_external_refs`** — new rows:

```sql
SELECT ref_type, ref_value FROM order_external_refs
WHERE order_id = <TEST_ORDER_ID> AND system = 'fnf';
```

| ref_type | ref_value |
|----------|-----------|
| `fnf_document_id` | (FNF-returned DocumentId) |
| `fnf_cpl_id` | (FNF-returned CPLLetterID) |
| `fnf_cpl_number` | (FNF-returned CPLNumber or generated) |
| `fnf_form_name` | `Standard CPL_CA` |
| `cpl_branch_id` | (the branchId you selected) |
| `cpl_lender_address` | `123 Main St` |
| `cpl_lender_city` | `Los Angeles` |
| `cpl_lender_state` | `CA` |
| `cpl_lender_zip` | `90001` |
| `cpl_assignment_clause` | `Test assignment clause` |
| `cpl_loan_number` | `LN-123456` |
| `cpl_lender_contact` | `John Doe` |

**`documents`** — new row:

```sql
SELECT id, filename, category, storage_provider, storage_key, status, is_synced_to_softpro
FROM documents
WHERE order_id = <TEST_ORDER_ID> AND category = 'cpl'
ORDER BY created_at DESC LIMIT 1;
```

| Column | Expected |
|--------|----------|
| filename | `fnf_<file_number>_1.pdf` |
| category | `cpl` |
| storage_provider | `s3` |
| storage_key | `cpl/fnf_<file_number>_1.pdf` |
| status | `active` |
| is_synced_to_softpro | `true` (if SoftPro is configured) |

**`vendor_tokens`** — cached tokens:

```sql
SELECT vendor, token_type, expires_at FROM vendor_tokens WHERE vendor = 'fnf';
```

Should show `vendor_jwt` and `user_jwt` rows with future `expires_at`.

### Verify PDF

Download the document from S3 or via the td-hub document viewer. Confirm:
- It opens as a valid PDF
- It contains the correct order details (property address, lender name, borrower names, file number)

---

## Test 2: EditCPL on Order with Existing `fnf_document_id`

**Goal**: Validate that an order with a saved `fnf_document_id` triggers EditCPL instead of CreateCPL.

### Precondition

Test 1 must have completed successfully. The test order now has `fnf_document_id` in `order_external_refs`.

```sql
SELECT ref_value FROM order_external_refs
WHERE order_id = <TEST_ORDER_ID> AND system = 'fnf' AND ref_type = 'fnf_document_id';
-- Must return exactly 1 row with a non-empty ref_value
```

### Steps

1. Re-open the CPL modal for the **same** test order
2. Modify one field (e.g., change the lender contact name)
3. Click **Generate CPL** again

### Expected `vendor_api_logs` Rows

| # | operation | success | error_category | request_meta (key fields) |
|---|-----------|---------|----------------|---------------------------|
| 1 | `get_agents` | true | null | `{ agentNumber, underwriterCode }` |
| 2 | `get_cpl_list` | true | null | `{ formCount, forms }` |
| 3 | `edit_cpl` | true | null | `{ formName: "Standard CPL_CA", documentId, cplId, isEdit: true }` |
| 4 | `parse_pdf` | true | null | `{ pdfSizeBytes, documentId }` |

**Key verification**: Row 3 must show `edit_cpl`, NOT `create_cpl`. The `isEdit` flag must be `true`.

### Expected Database State

- `fnf_document_id` in `order_external_refs` should be **updated** (same ref_type, possibly new ref_value if FNF returns a new DocumentId)
- A **second** document row should appear in `documents` table with `filename` ending in `_2.pdf`

---

## Test 3: EditCPL Empty CPLLetters → Fallback to CreateCPL

**Goal**: Validate that when EditCPL returns an empty `CPLLetters` node, the system falls back to CreateCPL.

### Precondition

This scenario requires FNF to return an empty `CPLLetters` for an EditCPL call. This can happen when:
- The `fnf_document_id` is stale or refers to a deleted document on FNF's side
- The document was archived

**To simulate**: Manually insert a fake `fnf_document_id` that FNF won't recognize:

```sql
INSERT INTO order_external_refs (order_id, system, ref_type, ref_value)
VALUES (<TEST_ORDER_ID_2>, 'fnf', 'fnf_document_id', 'FAKE-DOC-ID-99999')
ON CONFLICT (order_id, system, ref_type) DO UPDATE SET ref_value = 'FAKE-DOC-ID-99999';
```

Use a **different fresh order** (`TEST_ORDER_ID_2`) from the order used in Tests 1-2.

### Steps

1. Open CPL modal for `TEST_ORDER_ID_2`
2. Select FNF, select a branch, fill required fields
3. Click **Generate CPL**

### Expected `vendor_api_logs` Rows

| # | operation | success | error_category | request_meta (key fields) |
|---|-----------|---------|----------------|---------------------------|
| 1 | `get_agents` | true | null | — |
| 2 | `get_cpl_list` | true | null | — |
| 3 | `edit_cpl` | **false** | `EDIT_EMPTY` | `{ fallbackToCreate: true }` |
| 4 | `create_cpl` | true | null | `{ fallbackFromEdit: true }` |
| 5 | `parse_pdf` | true | null | — |

**Key verification**:
- Row 3: `edit_cpl` with `success = false`, `error_category = 'EDIT_EMPTY'`
- Row 4: `create_cpl` with `success = true`, `fallbackFromEdit: true` in meta
- Final result should still be `{ success: true }`

### Important Note

If FNF returns a SOAP fault or HTTP error (not just empty CPLLetters), the fallback will NOT trigger. The error will propagate as a `generate_cpl` failure instead. The fallback ONLY happens when:
- The response is HTTP 200
- `GenerateCPLResponse` exists
- `CPLLetters` node is **missing entirely** (not present-but-empty)

If this test produces a different FNF error, note the exact error message and HTTP status. The fake DocumentId may cause a SOAP fault instead of an empty response — both outcomes are valid data for debugging.

---

## Test 4: GetCPLList Returns Forms + Hardcoded Form Selection

**Goal**: Confirm that `GetCPLList` returns a non-empty list and that the code selects `Standard CPL_CA`.

### Steps

This is verified as part of Test 1. Check the `get_cpl_list` log row:

```sql
SELECT request_meta FROM vendor_api_logs
WHERE vendor = 'fnf' AND operation = 'get_cpl_list'
ORDER BY started_at DESC LIMIT 1;
```

### Expected `request_meta`

```json
{
  "formCount": <number >= 1>,
  "forms": ["Standard CPL_CA", ...]
}
```

### Verification

- `formCount` must be >= 1
- The `forms` array must contain `Standard CPL_CA` (or `Standard CPL_<state>` for the order's state)
- The subsequent `create_cpl` / `edit_cpl` log must show `formName: "Standard CPL_CA"` in its `request_meta`

### If `Standard CPL_CA` Is Not in the List

The form name is hardcoded. If FNF does not return a form with this exact name, the CreateCPL SOAP call will likely return a SOAP fault. In that case:

1. Record the exact form names returned by `GetCPLList`
2. Determine which form name should be used
3. This may require a code change to the form selection logic

---

## Test 5: PDF Extraction from `a:Content`

**Goal**: Confirm the base64 PDF content is correctly extracted and produces a valid PDF file.

### Verified In

Test 1 — the `parse_pdf` log confirms extraction.

### Additional Verification

```sql
-- Check parse_pdf log for size
SELECT request_meta->'pdfSizeBytes' AS pdf_size
FROM vendor_api_logs
WHERE vendor = 'fnf' AND operation = 'parse_pdf'
ORDER BY started_at DESC LIMIT 1;
```

- `pdfSizeBytes` should be > 0 (typical CPL PDFs are 10,000–200,000 bytes in base64)
- Download the document from the td-hub documents list and open it
- It must be a valid PDF (not corrupted, not HTML, not an error page)

---

## Test 6: `fnf_document_id` Save-Back to `order_external_refs`

**Goal**: Confirm `fnf_document_id` is persisted after CreateCPL and updated after EditCPL.

### After Test 1 (CreateCPL)

```sql
SELECT ref_type, ref_value, created_at FROM order_external_refs
WHERE order_id = <TEST_ORDER_ID> AND system = 'fnf' AND ref_type = 'fnf_document_id';
```

- Must return exactly 1 row
- `ref_value` must be a non-empty string (the FNF DocumentId)

### After Test 2 (EditCPL)

Run the same query. The `ref_value` may have changed if FNF returned a new DocumentId.

### Additional Vendor Refs

```sql
SELECT ref_type, ref_value FROM order_external_refs
WHERE order_id = <TEST_ORDER_ID> AND system = 'fnf'
ORDER BY ref_type;
```

Must include: `fnf_cpl_id`, `fnf_cpl_number`, `fnf_document_id`, `fnf_form_name`.

---

## Test 7: Document Upload Path (S3)

**Goal**: Confirm the PDF is uploaded to S3 and recorded in `documents`.

### After Test 1

```sql
SELECT id, filename, storage_key, size_bytes, status
FROM documents
WHERE order_id = <TEST_ORDER_ID> AND category = 'cpl'
ORDER BY created_at DESC LIMIT 1;
```

| Column | Expected |
|--------|----------|
| filename | `fnf_<file_number>_1.pdf` |
| storage_key | `cpl/fnf_<file_number>_1.pdf` |
| size_bytes | > 0 |
| status | `active` |

### Verify S3 Object Exists

```bash
aws s3 ls s3://<BUCKET>/cpl/fnf_<file_number>_1.pdf
```

Or check via the AWS S3 console. The object should exist and match `size_bytes`.

### Verify `document_audit` Trail

```sql
SELECT action, meta FROM document_audit
WHERE document_id = <DOCUMENT_ID>
ORDER BY created_at;
```

Must show at least one `uploaded` action with `{ filename, contentType, sizeBytes, storageKey }`.

---

## Test 8: SoftPro Attachment Path

**Goal**: Confirm the CPL document is attached to SoftPro.

### After Test 1

```sql
SELECT is_synced_to_softpro, softpro_synced_at, softpro_sync_error
FROM documents
WHERE id = <DOCUMENT_ID>;
```

| Column | Expected (Success) | Expected (Config Missing) |
|--------|--------------------|---------------------------|
| is_synced_to_softpro | `true` | `false` |
| softpro_synced_at | non-null timestamp | null |
| softpro_sync_error | null | error message |

### Verify `document_audit` for SoftPro

```sql
SELECT action, meta FROM document_audit
WHERE document_id = <DOCUMENT_ID> AND action IN ('attached_to_softpro', 'attach_failed');
```

- On success: `attached_to_softpro` with `{ fileNumber, fileUrl, requestId }`
- On failure: `attach_failed` with `{ fileNumber, error, requestId }`

### If SoftPro Is Not Configured

SoftPro attachment is best-effort. If `AWS_PATH` is not set or SoftPro credentials are missing, the CPL generation still succeeds but the API response will include a `warnings` array with the SoftPro error.

---

## Test 9: Failure Logging at Each Step

**Goal**: Confirm that each failure point produces the correct `vendor_api_logs` entry.

### 9a. `get_vendor_token` Failure

**Simulate**: Set `FNF_VENDOR_URL` to an invalid URL, or set `FNF_SECRET_KEY` to a wrong value.

```sql
DELETE FROM vendor_tokens WHERE vendor = 'fnf'; -- Force fresh token
```

Trigger CPL generation. Expected:

```sql
SELECT operation, success, error_category, http_status, request_meta
FROM vendor_api_logs
WHERE vendor = 'fnf' AND operation = 'get_vendor_token' AND success = false
ORDER BY started_at DESC LIMIT 1;
```

| Field | Expected |
|-------|----------|
| success | false |
| error_category | `NETWORK_ERROR` (bad URL) or `AUTH_ERROR` (wrong creds, HTTP 401/403) |
| http_status | null (network) or 401/403 (auth) |

API response: `{ "error": "CPL generation failed", "details": ["FNF vendor token ..."] }`

### 9b. `get_user_token` Failure

**Simulate**: Set `FNF_USER_URL` to an invalid URL, or set `FNF_ON_BEHALF_OF_USER` to an invalid user.

```sql
DELETE FROM vendor_tokens WHERE vendor = 'fnf' AND token_type = 'user_jwt';
```

Expected log:

| Field | Expected |
|-------|----------|
| operation | `get_user_token` |
| success | false |
| error_category | `NETWORK_ERROR` or `AUTH_ERROR` |

### 9c. `get_agents` Failure

**Simulate**: Use a `branchId` that does not exist in `cpl_branches`.

Expected: The error is thrown by `loadBranch()` before any SOAP call. The outer catch logs:

| Field | Expected |
|-------|----------|
| operation | `generate_cpl` |
| success | false |
| error_category | `CPL_ERROR` |
| request_meta | `{ "error": "FNF branch <id> not found or inactive" }` |

Additionally, a `cpl_error_logs` row is created.

### 9d. `get_cpl_list` Failure

**Simulate**: Temporarily corrupt the SOAP envelope (requires code change) or use an invalid CLUP/agent number.

If GetCPLList returns HTTP error:

| Field | Expected |
|-------|----------|
| operation | `generate_cpl` |
| success | false |
| error_category | `CPL_ERROR` |
| request_meta | `{ "error": "FNF GetCPLList failed: HTTP <status> — <body>" }` |

### 9e. `create_cpl` / `edit_cpl` Failure

**Simulate**: Use a form name that FNF doesn't recognize, or send invalid field data.

If CreateCPL/EditCPL returns HTTP error or SOAP fault:

| Field | Expected |
|-------|----------|
| operation | `generate_cpl` |
| success | false |
| error_category | `CPL_ERROR` |
| request_meta | `{ "error": "FNF CreateCPL failed: HTTP <status>..." }` or `{ "error": "FNF CreateCPL: no CPLLetter in response" }` |

### 9f. `parse_pdf` Failure

**Simulate**: If `a:Content` is empty in the response (unlikely in production).

| Field | Expected |
|-------|----------|
| operation | `generate_cpl` |
| success | false |
| error_category | `CPL_ERROR` |
| request_meta | `{ "error": "FNF CreateCPL: empty PDF content" }` |

---

## Rollback / Debug Steps

### If Any Test Fails

1. **Check `vendor_api_logs` first**:
   ```sql
   SELECT id, operation, success, error_category, http_status, request_meta, started_at
   FROM vendor_api_logs
   WHERE vendor = 'fnf'
   ORDER BY started_at DESC LIMIT 20;
   ```
   This tells you exactly which step failed.

2. **Check `cpl_error_logs`**:
   ```sql
   SELECT * FROM cpl_error_logs
   WHERE order_id = <TEST_ORDER_ID>
   ORDER BY created_at DESC LIMIT 5;
   ```

3. **Check Vercel function logs** for the full stack trace (the API route catches and returns 500 on unhandled errors).

4. **Check cached tokens** — stale tokens can cause auth failures:
   ```sql
   SELECT id, token_type, expires_at FROM vendor_tokens WHERE vendor = 'fnf';
   -- If expires_at is in the past but row exists, the cache check should skip it
   -- If the token is corrupt, delete it:
   DELETE FROM vendor_tokens WHERE vendor = 'fnf';
   ```

5. **Verify FNF service availability** — check if the SOAP endpoint is reachable:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://<FNF_CPL_URL>v3/CPLManagement.svc
   ```

### Rolling Back the Test Data

To clean up after testing and restore the order to a pre-test state:

```sql
-- 1. Remove FNF vendor refs
DELETE FROM order_external_refs
WHERE order_id = <TEST_ORDER_ID> AND system = 'fnf';

-- 2. Soft-delete test CPL documents
UPDATE documents SET status = 'deleted'
WHERE order_id = <TEST_ORDER_ID> AND category = 'cpl';

-- 3. Clear cached tokens (optional)
DELETE FROM vendor_tokens WHERE vendor = 'fnf';

-- 4. Clear test logs (optional, for clean slate)
DELETE FROM vendor_api_logs
WHERE vendor = 'fnf' AND order_id = <TEST_ORDER_ID>;

DELETE FROM cpl_error_logs
WHERE order_id = <TEST_ORDER_ID>;
```

### If FNF Returns a SOAP Fault

SOAP faults are returned as HTTP 200 with XML body containing `<s:Fault>`. The current parser will throw "no SOAP body" or "no GenerateCPLResponse" errors. If this happens:

1. Check the raw XML in Vercel logs
2. Common causes: expired token, invalid CLUP, invalid form name, missing required fields
3. Compare the SOAP envelope being sent against the legacy PHP envelope in `docs/cpl/legacy/Fnf.php`

### If Token Caching Causes Issues

Tokens are cached in `vendor_tokens` and reused until `expires_at`. If FNF revokes tokens mid-session:

```sql
DELETE FROM vendor_tokens WHERE vendor = 'fnf';
```

Then retry. The next call will fetch fresh tokens.

---

## Success Criteria Summary

All 9 tests pass when:

| # | Test | Pass Criteria |
|---|------|---------------|
| 1 | CreateCPL | API returns `{ success: true }`, PDF downloads correctly, 6 log rows (or 4 if tokens cached) |
| 2 | EditCPL | API returns `{ success: true }`, `edit_cpl` operation logged with `isEdit: true` |
| 3 | EditCPL fallback | `edit_cpl` logged as failed with `EDIT_EMPTY`, followed by successful `create_cpl` |
| 4 | GetCPLList | `get_cpl_list` log shows `formCount >= 1`, forms array contains `Standard CPL_CA` |
| 5 | PDF extraction | `parse_pdf` log shows `pdfSizeBytes > 0`, downloaded PDF is valid |
| 6 | fnf_document_id | `order_external_refs` contains `fnf_document_id` after create, updated after edit |
| 7 | S3 upload | `documents` row has `storage_key`, `document_audit` shows `uploaded`, S3 object exists |
| 8 | SoftPro attach | `is_synced_to_softpro = true` or clear error in `softpro_sync_error` |
| 9 | Failure logging | Each simulated failure produces the correct `vendor_api_logs` row with appropriate `error_category` |
