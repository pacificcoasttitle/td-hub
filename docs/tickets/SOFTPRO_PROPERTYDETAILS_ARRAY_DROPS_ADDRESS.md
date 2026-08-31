# SoftPro createOrder drops propertyDetails when it is an array

**To:** Aashima  
**Date:** 2026-08-31  
**Status:** proven on staging. Hub fix is to send an object. This report is the vendor side.

## What we sent

Identical createOrder bodies, staging `:8081`, minutes apart. Only the JSON type of `propertyDetails` changed.

**Array** → `TEST-20002223-OCT`  
**Object** → `TEST-20002224-OCT`

Same Address1 `2614 Canto Rompeolas`, City `San Clemente`, State `CA`, Zip `92673`, Country `Orange`. Same examiner `PCT\cvirata`.

## What SoftPro did

| | Array | Object |
|---|---|---|
| HTTP / Status | 200 / Order created successfully | 200 / Order created successfully |
| TitleOfficer | Clive Virata | Clive Virata |
| Address / City / State / Zip / Country | all `""` | stored exactly as sent |

The array is accepted. The rest of the order is saved. The property is thrown away. There is no error.

## Production

We have sent `propertyDetails` as an array on every hub create since March (15 logged payloads, 0 objects). Production used to store some of those addresses (20021376-OCT and 20021378-GLT on 2026-08-24: `8641 Universe Avenue`, `31195 Emery Court`). Today’s two live creates (20021638-OCT, 20021639-OCT) got the same 200 and empty property — documents then 400 because SoftPro requires address/city/state/zip.

Every successful hub create that sent `propertyDetails` used an **array**. SoftPro stored the address on some and not others. Read back 2026-08-31:

| Created | File | Sent Address1 | SoftPro Address now |
|---|---|---|---|
| 2026-03-25 | 20015757-GLT | 1358 5TH ST | empty (officer kept) |
| 2026-03-25 | 20015761-GLT | 1358 5TH ST | empty (officer kept) |
| 2026-06-08 | 20018616-GLT | 1358 5TH ST | empty (no officer — our GLT-as-examiner bug, already fixed) |
| 2026-06-08 | 20018618-GLT | 1358 5TH ST | empty (same) |
| 2026-07-28 | 20020403-GLT | 1358 5TH ST | empty (same) |
| 2026-07-28 | 20020404-GLT | 1358 5TH ST | empty (same) |
| 2026-08-24 | 20021376-OCT | 8641 UNIVERSE AVE | **8641 Universe Avenue** |
| 2026-08-24 | 20021378-GLT | 31195 EMERY CT | **31195 Emery Court** |
| 2026-08-31 17:09 | 20021638-OCT | 919 N Siesta St | empty at 17:20; **919 N Siesta Street** at 17:34 |
| 2026-08-31 17:12 | 20021639-OCT | 2614 Canto Rompeolas | empty both reads |

Not a date cutover. The same array shape binds on some requests and not others. 20021638 flipped from empty to stored in a 14-minute window on the same file. That is what two adapter instances behind one IP, on different builds, would look like.

## What we need

1. What changed, and when, so an array that used to bind now does not.
2. Whether other integrations sending an array are losing addresses right now and getting a success message for it.
3. Confirmation that the documented Staging and Production shape is an **object**, matching your Postman examples (the Development example is the array).
