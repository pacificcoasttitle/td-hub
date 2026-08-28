# Title docs marked synced, SoftPro holds none of them

**Status: do not re-post yet.** Measured 2026-08-28. The write path is
fixed on `fix/softpro-adddocuments-batch`; this ticket is the seven-order
cleanup only.

GetAttachedDocuments on every file that holds a local LV / grant deed / tax
row: **13 documents said `is_synced_to_softpro = true` and zero of them exist
on SoftPro.** Four more orders never claimed success.

Do not flip flags. Do not re-post. Verdicts below.

## The seven orders

| File | Local rows | SoftPro today | How they failed | Re-post? |
|---|---|---|---|---|
| 20015761-GLT | 7 marked synced (1 LV, 2 tax, **4 grant deeds**), Mar 31 | empty | Signed S3 URLs with query strings. `Path.GetFileName` saw `?X-Amz-…`. AddDocuments 200. Nothing landed. | **Not yet.** A human must pick which of the four grant deeds is the real one. A naive re-post would add all four. |
| 20021376-OCT | 3 marked synced, Aug 24 | one prelim only | HMAC fetch URL ended in the signature, not a filename. Marked synced off the 200. | Safe as an **add** once `is_synced` is cleared. Will not touch the prelim. |
| 20021378-GLT | 3 marked synced, Aug 24 | one prelim only | Same as 376. | Same as 376. |
| 20018616-GLT | 3, 8 failed attempts | empty | SoftPro `400`: no address / city / state / zip / title officer. | **No.** The vendor order is unfinished. Re-posting documents will 400 again. |
| 20018618-GLT | 3, 8 failed attempts | empty | Same 400. | **No.** |
| 20020403-GLT | 3, 8 failed attempts | empty | Same 400. | **No.** |
| 20020404-GLT | 3, 8 failed attempts | empty | Same 400. | **No.** |

Folder string was never stored on those posts, and GetAttachedDocuments for
these files returns bare URL strings, so a `Title Docs` folder cannot be
confirmed from the vendor response. The files are simply not there under any
name.

## Why this ticket exists

The path that produced the lie is fixed: we no longer mark synced from
AddDocuments' 200. This ticket is only "what to do with the seven." The four
incomplete SoftPro orders belong to a larger population — see
`SOFTPRO_ADDDOCUMENTS_REQUIRED_FIELDS.md`.

## Acceptance

- 20015761: one grant deed chosen, the other three left unsynced or deleted
  locally, then one batched re-post, then GetAttachedDocuments names match.
- 376 and 378: `is_synced` cleared, one batched re-post, names match, prelim
  still the only pre-existing attachment.
- The four 400s: not re-posted until the vendor order has address, city,
  state, zip, and a title officer.
