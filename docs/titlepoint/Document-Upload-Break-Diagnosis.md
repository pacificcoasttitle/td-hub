# Document Upload Break — Diagnosis & Fix Package
**Issue:** LV, Grant Deed, and Taxes documents produced at order-open are not appearing in the SoftPro file.
**Source basis:** staging branch @ `512c73490bee` — `AddDocuments` (`DownloadFileAsync`, line ~2175) and `UploadFiles` (line ~1790). Line refs from this commit.

---

> ## CORRECTION — 2026-09-03
>
> **Defect A below originally named the wrong vendor error.** It described a filename-parsing failure on illegal characters (`?`, `&`) from a signed URL. That is not what SoftPro reports.
>
> The actual error, confirmed across eight `AddDocuments` calls on 2026-06-08 (`Status: 400`, `FileUploadedStatus: false`):
>
> > "The specified path, file name, or both are too long. The fully qualified file name must be less than 260 characters, and the directory name must be less than 248 characters."
>
> A presigned URL runs roughly **440 characters** against Windows' **260-character** MAX_PATH limit. The request fails on length *before* `Path.GetFileName` ever encounters the query string. Both faults stem from the same cause — sending a presigned URL — but only one produces an error message, and it is the length one.
>
> **Why this matters:** anyone searching the logs for filename, illegal-character, or `FileStream` errors finds nothing and concludes the defect never fired. **Search for `too long`.**
>
> A full-log sweep found MAX_PATH errors to be the only hits; no illegal-character or `FileStream` failures exist anywhere in the record.
>
> Defect A is corrected in place below. Everything else in this document stands as written.

---

## How the pipeline works (so the breaks make sense)

```
Caller POSTs AddDocuments {OrderNumber, DocumentName, Id, FileList:[{FolderName, FileURL}]}
  → adapter downloads each FileURL to  %TEMP%\PCT\{OrderNumber}\{FolderName}\{filename}
  → calls UploadFiles(OrderNumber, ...)
      → opens the order ReadWrite
      → picks target: "Title & Escrow" orders → "1 - Title Documents\3 - Production Documents"
                      everything else        → root-level "3 - Production Documents"
      → attaches EVERY file found under %TEMP%\PCT\{OrderNumber}\ 
      → DELETES %TEMP%\PCT\{OrderNumber}\ entirely
      → ApplyChanges → 200 "Success"
```

Note what's shared: **the temp folder is keyed by order number only** — every concurrent call for the same order reads and deletes the same folder.

---

## THE BREAK — a race between sibling document calls, ending in a silent-success

Three documents at order-open means (if the hub posts them as separate calls) three near-simultaneous `AddDocuments` requests for the same order. Then:

1. Call A (LV) finishes its download, enters `UploadFiles`, attaches whatever is in `%TEMP%\PCT\{order}\` at that instant, and **deletes the whole order folder** (line 1902).
2. Call B (Grant Deed), mid-download into that same folder, has its file deleted under it — or its `FileStream` write fails.
3. Call B then reaches `UploadFiles`, and here is the killer: `if (Directory.Exists(tempFolder))` (line 1804) — the folder is gone, so **the entire attach block is silently skipped**, execution falls through to line 1906, and the response is **`200 "Success"`, `FileUploadedStatus = true`, with nothing attached.**

Documents lost; every call reports success. It's the same false-200 disease found four times before, now at the document layer — and this instance *eats files*.

**Why it "came back" after being overcome:** the hurdle previously fixed was almost certainly the order-lock error (the code carries special handling for "locked for editing by user" — that's scar tissue from that battle). The lock fix works. This is a *different* mechanism that only fires when **multiple documents are posted for one order at the same moment** — which is precisely the at-order-open pattern (LV + Grant Deed + Taxes together). Legacy likely posted documents one at a time from a serial PHP flow; the new flow fires them in parallel. Nothing in the adapter changed — the *calling pattern* did, and it awakened a race that was always there.

## Accomplice defects (each verified in source)

**A. Presigned URLs exceed MAX_PATH (line 2253).** `Path.GetFileName(files.FileURL)` is fed the whole URL. A presigned URL — S3 `?X-Amz-Signature=…`, Supabase `?token=…` — runs roughly **440 characters**, and the resulting fully-qualified temp path exceeds Windows' 260-character limit. SoftPro returns:

> `Status: 400`, `FileUploadedStatus: false` — "The specified path, file name, or both are too long. The fully qualified file name must be less than 260 characters, and the directory name must be less than 248 characters."

The secondary fault — that the filename would also contain `?` and `&`, illegal on Windows — is real but **never gets a chance to fire**; the length check rejects the request first. There are no illegal-character or `FileStream` errors anywhere in the log. **When hunting this defect, search for `too long`.**

If TD Hub's document storage issues presigned URLs, **every** upload on that path fails loudly with the MAX_PATH error. Legacy S3 public links (bare `.pdf` paths, well under the limit) never hit this.

**B. `FileUploadedStatus = true` on failure (line 1915).** The catch block *defaults* the flag to true and only flips it to false for lock errors. Any retry logic keyed on that flag is blind to most failures.

**C. Skip-if-exists cache (line 2255).** A file that already exists in temp is never re-downloaded — combined with the shared folder, a stale or partial file from an earlier attempt can be attached instead of the fresh one.

**D. Location depends on order type (lines 1812–1849).** Only orders whose Type is exactly "Title & Escrow" get documents under `1 - Title Documents\3 - Production Documents`. **Everything else — including every Title-only order — gets a root-level "3 - Production Documents" folder.** If the team looks in the Title Documents tree, correctly-attached docs on Title-only orders *look* missing. Check this before anything else — it's the five-minute explanation.

**E. The evidence trail is half-dead.** `AddDocuments` DOES persist its log with the **full request payload** (line 2306, `FileName = 'DownloadFile API finally block'`) — a goldmine. But `UploadFiles` constructs its log entry (lines 1946–1956) and **never calls `AddLogs`** — the inner attach step is invisible in the log table.

---

## Diagnosis — 30 minutes, in this order

1. **Open one affected order in Select and look at the ROOT of Attachments** for a "3 - Production Documents" folder (defect D). If the docs are there, this is a folder-location/expectation issue, not an upload failure — fix is one decision about where Title-only docs belong.
2. **Query the adapter's local SQL:**
   `SELECT TOP 100 CreationDateTime, Message, Request, ResponseObject FROM LogFiles WHERE FileName = 'DownloadFile API finally block' ORDER BY CreationDateTime DESC`
   For an affected order: Is there a row at order-open time at all? (No row → the hub never called → the break is hub-side, in the produce-then-upload trigger.) What does `Request` show for `FileURL` — is it a presigned URL over ~260 characters (defect A)? What did `ResponseObject` claim?
3. **Look in `%TEMP%\PCT\` on the server** (under the account the adapter runs as): leftover `{OrderNumber}` folders are corpses of interrupted flows — their timestamps map to the race.
4. **Ask TD Hub two questions:** are LV/Grant Deed/Taxes posted as ONE AddDocuments call (single FileList) or separate calls? And what does a sample FileURL look like — and how long is it?

## Fixes — Aashima (ranked)

1. **Kill the silent-skip:** in `UploadFiles`, `if (!Directory.Exists(tempFolder))` → return **400 "No staged files found for this order"**. One line; converts lost documents into visible failures immediately.
2. **Isolate per request:** stage downloads under `%TEMP%\PCT\{OrderNumber}\{Guid}\` and pass that exact path into `UploadFiles` (new parameter or overload). Eliminates the race AND the stale-cache problem in one move. Delete only the GUID folder afterward.
3. **Parse filenames from the URI path:** `Path.GetFileName(new Uri(files.FileURL).LocalPath)` — takes the filename from the path segment only, so the query string never reaches the temp path and the MAX_PATH ceiling is never approached.
4. **Honest status:** default `FileUploadedStatus = false` in the catch; add an `AttachedCount` to the success response so callers can verify count-sent == count-attached instead of trusting "Success".
5. **Persist the UploadFiles log** — the object is already built; it's one missing `AddLogs` call (the method is sync — either make it async like its callers or block on the task; caller `AddDocuments` is already async).
6. Optional hardening: retry once on "locked for editing" after a short delay — order-open races with the creation flow make early locks likely.

## Immediate mitigation — TD Hub, no adapter change needed

Two changes on the calling side that likely restore uploads **today**:
- **Batch all documents for an order into ONE `AddDocuments` call** (one FileList with LV + Grant Deed + Taxes). One call → one temp lifecycle → no race.
- **Never send a presigned URL.** Use public or proxied clean URLs ending in the filename, well under 260 characters. (If signed URLs are required, wait for fix #3.)
- Until fix #4 ships, treat any response where attach evidence matters as unverified: follow with `GetAttachedDocuments` on the order and compare names — that endpoint exists and closes the loop. **Note (2026-09-03):** `GetAttachedDocuments` is blind to Production Documents subfolders — it returns `data: []` after a successful write. Open with Aashima. For prelims specifically, `GetAttachedDocumentsPrelim` does return results and should be used instead.

## The pattern, for the record

This is the **fifth** confirmed instance of success-reported-for-work-not-done in this API (updateOrder party sections, narrowed silent-ignore, email-only skip, CreateOrders address warnings, now document attach). The standing recommendation graduates to a rule: **every write path returns evidence (counts, names, or messages), and every skip is loud.** Worth making that the acceptance criterion on all future adapter work.
