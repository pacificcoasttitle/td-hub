# 06 — Document Pipeline

## Purpose
Centralize all order-related documents. Upload, store, classify, preview, download, attach to SoftPro, and audit every action.

## Storage

| Setting | Value |
|---------|-------|
| Provider | AWS S3 (existing PCT bucket) |
| Bucket | `AWS_BUCKET` env var |
| Region | `AWS_REGION` env var |
| Access | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |

### S3 Key Structure (matching legacy)
```
cpl_documents/{filename}        # CPL PDFs
legal-vesting/{filename}        # Legal vesting PDFs from TitlePoint
grant-deeds/{filename}          # Grant deed images from TitlePoint
tax/{filename}                  # Tax documents from TitlePoint
prelim/{filename}               # Prelim reports from SoftPro
policy/{filename}               # Policy documents from SoftPro
uploads/{order_id}/{filename}   # General user uploads
```

### Naming Conventions
| Category | Pattern | Example |
|----------|---------|---------|
| CPL | `{underwriter}_{fileNumber}_{count}.pdf` | `westcor_24050001GLT_1.pdf` |
| Legal Vesting | `{fileNumber}.pdf` | `24050001GLT.pdf` |
| Grant Deed | `{instrumentNumber}_{fileNumber}.pdf` | `20240501-001234_24050001GLT.pdf` |
| User Upload | `{originalFilename}` | `appraisal_report.pdf` |

## Document Service API

```typescript
// lib/domain/documents/service.ts

interface DocumentService {
  upload(input: UploadInput): Promise<Document>;
  download(documentId: number): Promise<{ buffer: Buffer; filename: string; contentType: string }>;
  getByOrder(orderId: number, category?: DocCategory): Promise<Document[]>;
  softDelete(documentId: number, userId: string): Promise<void>;
  countByCategory(orderId: number, category: DocCategory): Promise<number>;
  attachToSoftPro(documentId: number): Promise<void>;
}
```

## Attach to SoftPro Flow

```
1. Get document record (filename, S3 key)
2. Construct S3 URL: AWS_PATH + storage_key
3. Build SoftPro payload:
   {
     Id: uploadLogId,
     OrderNumber: fileNumber,
     DocumentName: filename,
     FileList: [{ FolderName: category, FileURL: s3Url }]
   }
4. POST to SoftPro AddDocuments endpoint
5. On success: set isSyncedToSoftpro = true, softproSyncedAt = now
6. On failure: set softproSyncError, mark for retry
7. Log to vendor_api_logs
8. Write document_audit entry
```

## Audit Trail
Every document action writes to `document_audit`:
- `uploaded` — who uploaded, from where
- `downloaded` — who downloaded
- `viewed` — who viewed (preview)
- `deleted` — who deleted (soft delete)
- `attached_to_softpro` — when pushed to SoftPro
- `attach_failed` — when SoftPro push failed
- `generated` — when system generated (CPL, TitlePoint result)

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/documents/upload` | POST | Upload file to order (multipart) |
| `GET /api/documents/[id]` | GET | Download file |
| `DELETE /api/documents/[id]` | DELETE | Soft delete |
| `GET /api/orders/[id]/documents` | GET | List documents for order |
| `POST /api/documents/[id]/attach` | POST | Trigger SoftPro attach |

## Canon References
- `td-source-extraction.md` §5 — Order.php S3 methods (uploadDocumentOnAwsS3, uploadCPLDocumentToSoftpro)
- `softpro-route-extraction.md` §4 — Flow 4: Document Upload to SoftPro
- `lean_transaction_desk_hub_plan.md` §5.2
