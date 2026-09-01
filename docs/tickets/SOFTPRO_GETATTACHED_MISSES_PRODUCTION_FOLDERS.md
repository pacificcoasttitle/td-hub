# GetAttachedDocuments returns [] for Production Documents subfolders

**To:** Aashima  
**Date:** 2026-08-31  
**Status:** ask sent as this ticket (same path as `SOFTPRO_PROPERTYDETAILS_ARRAY_DROPS_ADDRESS.md`). No SoftPro API email is on file in this repo; contacts only have Aashima Narang at yopmail test addresses, which we will not mail.

## What we see

`AddDocuments` into Production Documents subfolders (`legal-vesting`, `grant-deed`, `tax`) returns HTTP 200 / Success. A later `AddDocuments` of the same names returns 400 `An item already exists by that name.` CS can see the files on the SoftPro file (20021642-OCT confirmed today).

`GET ordercreation/GetAttachedDocuments?orderNumber=20021642-OCT` returns `data: []`.

Same empty list on 20021638-OCT and 20021639-OCT after a later-in-the-day AddDocuments 200.

## What we need

Does GetAttachedDocuments take a folder / cabinet / document-type parameter that includes Production Documents and those three subfolders?

Or is there another GET that returns the full attached-document tree (not just the prelim/policy slices — we already have GetAttachedDocumentsPrelim and GetAttachedDocumentsPolicy)?

Example file: **20021642-OCT**.

## Follow-up — 22 title docs accepted, not listing-confirmed

Measured 2026-08-31: 22 active Production Documents rows are write-accepted but not listing-confirmed (`is_synced_to_softpro = true`, `softpro_listing_confirmed = false`): 6 legal_vesting, 9 grant_deed, 7 tax.

They stay in that state because GetAttachedDocuments does not see Production Documents subfolders, so we cannot promote on a listing match. When SoftPro gives a listing that includes those folders (a folder/cabinet parameter, or a different GET), re-check these 22 and set `softpro_listing_confirmed = true` where the name is on the file. Do not leave them in limbo, and do not re-POST them.
