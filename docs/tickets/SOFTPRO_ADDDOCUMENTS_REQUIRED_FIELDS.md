# SoftPro orders that can never receive a document

**Status: local lower bound measured 2026-08-28. Vendor-side count is the
job of the next thread.**

Four of the seven title-doc orders (20018616-GLT, 20018618-GLT, 20020403-GLT,
20020404-GLT) were refused by AddDocuments with:

> The order has unresolved errors. … Property Address is required.; City is
> required.; State is required.; Zip is required.; Title officer/Examiner is
> required.

Those four are test-looking files. The hub screenshot the same day showed
APN and County reading "Not set" and two live orders with no address at all.
If that is a real population, those orders can never receive a document and
nobody is told.

## What we already know (our tables, not SoftPro)

Open or in-process orders, 2026-08-28:

| | n |
|---|---:|
| Open / in process | 4,163 |
| No address | 115 |
| No city | 110 |
| No state | 110 |
| No zip | 146 |
| No title officer | 128 |
| Missing **any** of the five AddDocuments requires | **170** |
| Missing **all five** | 107 |

That is already a real population on our copy. SoftPro is the one that
refuses the upload, and SoftPro's required fields can disagree with ours
(`CREATE_ORDER_DROPPED_FIELDS.md` — we drop fields the vendor keeps, and the
reverse also happens). **Do not treat 170 as the vendor number.**

## What tomorrow's thread measures

For every open / in-process order we hold, ask SoftPro GetOrderDetails (or
the cheapest read that returns address + officers) and count how many are
missing address, city, state, zip, or title officer **on the vendor order**.

Split:

1. Missing on SoftPro and missing here — we never had it.
2. Missing on SoftPro, present here — we had it and did not send it, or
   SoftPro rejected the write.
3. Present on SoftPro, missing here — we dropped it on ingest.

If (1) or (2) is non-trivial, AddDocuments is structurally closed for those
files and the attach retry will burn eight attempts in silence. That is the
same shape as marking synced off a 200: a failure nobody can see.

## Do not do

- Do not re-post the four 400s until the vendor order is complete.
- Do not "fix" APN / County display as a substitute for this count. Display
  is how Gerard noticed; the question is how many orders SoftPro will refuse.
