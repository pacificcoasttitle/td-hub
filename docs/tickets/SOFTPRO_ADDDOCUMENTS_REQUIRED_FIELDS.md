# SoftPro required fields — three problems, not one number

**Status 2026-08-28:** Group 1 done. Group 2 closed (in-house copies).
Group 3 is the Aashima report. Do not quote 170.

## 1. Zip we already had on SoftPro — done

35 open / in-process rows had an address and no zip. Last fetched before
`ef9d3d3` (2026-07-28), which is when we started persisting `Zip`.

Re-enrich ran 2026-08-28. Surgical: `order_properties.zip` only.

| Result | n |
|---|---:|
| Filled from GetOrderDetails | **30** |
| SoftPro row, Zip empty (20019101-GLT, vacant land) | 1 |
| GetOrderDetails returned no row | 4 |

The four unresolved: 20017949-OCT, 20018116-OCT, 20018506-OCT, 20019329-OCT.
Same empty-date and opened-day windows. Left as-is.

## 2. SoftPro shells — closed, no vendor fix

Gerard confirmed 2026-08-28: this is in-house SoftPro activity. Staff copy
files. The copy is a shell — no property, no officers, no parties, no
documents — and that is a permanent condition, not an anomaly. Select
matches the API. No SoftPro fix.

The hub renders a shell honestly: title **No property on file**,
banner *there's nothing on this order yet*, documents and CPL
unavailable because SoftPro has no property on the file. No Find,
no Create, no Resync-as-the-fix. It never reads as a screen that
failed to load.

These copies are also part of the 1,093 orders with no prelim recipient.
Re-measured 2026-08-28 against the no-path bucket (no escrow officer and
no `escrow_company` party — 1,084 today): **263 are shells** (no street
and no city), **821 have an address**. Of the live slice: 104 shells,
596 with an address. **Split shell vs real before anyone acts on
1,093.** See `NULL_PRELIM_RECIPIENT.md`.

The 54 that started this thread (open / in-process, last 60 days, all
five AddDocuments fields empty) are that copy population. Fingerprint:
thin GetOrderDetails, ReceivedDate and ModifiedDate 1–2 seconds apart.
Aug 12 sitting 20020959–20020968.

## 3. Aashima report — the only live create bug

Two March hub creates sent a valid examiner and a full address. SoftPro
returned 200. SoftPro holds the officer and not the property. That is
the vendor false-success. The four later files that sent `TitleOffice=GLT`
are our examiner bug, already fixed, and are listed only so they are
not mixed into this report.

Eight successful hub creates exist in `vendor_api_logs`. GetOrderDetails
on all eight, 2026-08-28:

| File | Sent `TitleOffice` | SoftPro address today | SoftPro examiner today |
|---|---|---|---|
| 20018616-GLT | **GLT** (invalid) | empty | none |
| 20018618-GLT | **GLT** | empty | none |
| 20020403-GLT | **GLT** | empty | none |
| 20020404-GLT | **GLT** | empty | none |
| 20015757-GLT | `PCT\rbarcena` (valid) | **empty** | Rachel Barcena |
| 20015761-GLT | `PCT\elasmarias` (valid) | **empty** | Eddie LasMarias |
| 20021376-OCT | `PCT\cvirata` (valid) | 8641 Universe Avenue, Westminster 92683 | Clive Virata |
| 20021378-GLT | `PCT\rdickerson` (valid) | 31195 Emery Court, Redlands 92373 | Richard Dickerson |

Invalid examiner → 4/4 empty, and SoftPro did not even store the
officer. That part is ours, and it is fixed.

Valid examiner → **not** 0/4 empty. March 25 kept the officer and
dropped the property. August 24 kept both. The GLT bug is not the
whole cause.

All six empties used the test property `1358 5TH ST`. SoftPro will
store that address: 20016846-OCT and 20020776-OCT (opened in SoftPro,
not by us) read back `1358 5th St, La Verne 91750` today. So it is
not "this APN is illegal." It is hub-create of that property returning
200 and writing no property, including when the examiner was valid.

**The two files for Aashima:**

| | 20015757-GLT | 20015761-GLT |
|---|---|---|
| Created | 2026-03-25 19:23 | 2026-03-25 20:39 |
| Sent `TitleOffice` | `PCT\rbarcena` | `PCT\elasmarias` |
| Sent `propertyDetails` | 1358 5TH ST, LA VERNE CA 91750, APN 8381-021-001 | same |
| SoftPro response | 200 Order created successfully | 200 |
| SoftPro today | officer Rachel Barcena; Address/City/State/Zip empty | officer Eddie LasMarias; Address/City/State/Zip empty |

We have the logged payload, the 200, and the empty GetOrderDetails. SoftPro
stores this same address on files it opened itself (20016846-OCT,
20020776-OCT). August 24 hub creates with a valid examiner
(20021376-OCT, 20021378-GLT) kept the address. The GLT-as-examiner
creates (20018616 / 618 / 20403 / 20404) are a separate, already-fixed
bug and are not this report.

Until SoftPro holds the address these two also present in the hub as
no-property orders (same empty pane). That is correct: there is
nothing on the file. Do not re-post documents until SoftPro holds
the address.
