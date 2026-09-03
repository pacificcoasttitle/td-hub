# title-production/upload hands SoftPro a presigned S3 URL

**Status: live in code, zero exposure. Not a document gap.** Measured 2026-09-02
against `vendor_api_logs` and `title_production_uploads`, read-only.

## The defect

`src/app/api/title-production/upload/route.ts:170` presigns the object and
passes the result straight to `AddDocuments` as `FileURL`:

```ts
const signedUrlResult = await getSignedUrl(storageKey, 24 * 60 * 60);
// …
const softproFileUrl = signedUrlResult.data!;
```

Every other push path goes through
`cleanSoftProFileUrl(buildSoftProFetchUrl(...))`, which mints a short
`/api/softpro/fetch-doc/...` URL whose last segment is a legal filename. This
route never got that fix.

## What the vendor actually complains about

Not the illegal-character theory. The recorded failure is **MAX_PATH**:

> `Status: 400` — "The specified path, file name, or both are too long. The
> fully qualified file name must be less than 260 characters, and the directory
> name must be less than 248 characters." `FileUploadedStatus: false`

A presigned URL is ~440 characters. SoftPro rejects it on length before the
`?`-in-filename problem can bite. Both are consequences of sending a presigned
URL; length is the one the vendor reports, so that is the string to search for.

## Exposure

`AddDocuments` calls carrying `X-Amz-Signature`, all time — three days only:

| Day | Calls | Vendor result | Notes |
|---|---|---|---|
| 2026-03-31 | 9 | scored success | Empty `{}` body read as success. The `20015761-GLT` false-sync population in `TITLE_DOCS_FALSE_SYNC.md`. |
| 2026-04-02 | 3 | scored success | This route. Empty `{}` body. |
| 2026-06-08 | 8 | **400 MAX_PATH**, all 8 | Once the array-envelope evaluator landed, signed URLs failed 100%. |

Nothing since 2026-06-08. No signed URL has reached `AddDocuments` in three
months, because the documents path was fixed and this route has not been used.

`title_production_uploads` holds **3 rows, total, ever**:

| id | order | document_name | is_synced |
|---|---|---|---|
| 1 | 20015761-GLT | Test Title Production Upload | true |
| 2 | 20015761-GLT | Deed of Trust Test | true |
| 3 | 20015761-GLT | deed | true |

All three on 2026-04-02, all against one order, all obviously test material
(`test-upload.pdf`, `DeedOfTrust.pdf`). `20015761-GLT` is the same order that
`TITLE_DOCS_FALSE_SYNC.md` already records as having received nothing from
signed URLs on 2026-03-31.

So: **no real operator document has been lost on this path.** The three
`is_synced = true` rows are false claims, but they are test rows.

## Why it has not been noticed

It cannot fail loudly because nobody uses it. And the failure it *did* have in
April was silent: SoftPro returned `{}`, which the code of the day scored as
success. Today the same call would return 400 MAX_PATH and the evaluator would
mark the row `is_synced = false` with a `sync_reason` — so the next person to
use this route gets a visible failure with a confusing vendor message, not
silent loss.

## What to do

1. Replace the presign with
   `cleanSoftProFileUrl(buildSoftProFetchUrl(documentId, documentName))`, the
   same call every other push path uses. The route already builds a permanent
   `/api/title-production/uploads/{id}/file` URL and stores it as
   `public_url` — but that is not what it sends.
2. Correct the three `is_synced = true` rows, or delete them as test data.
   Do not re-post: they are test documents on a real file, and SoftPro has no
   delete on this path.
3. Do not treat the empty `{}` responses from March/April as evidence either
   way. Per `TITLE_DOCS_FALSE_SYNC.md`, an empty listing is not proof of
   absence, and a `{}` write body is not proof of presence.

## Acceptance

- No `AddDocuments` request meta on any path contains `X-Amz-Signature`.
- A grep for `getSignedUrl` finds no call whose result reaches `FileURL`.
- The three test rows no longer claim a sync that was never confirmed.
