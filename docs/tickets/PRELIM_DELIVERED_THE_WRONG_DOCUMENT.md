# Ten prelim deliveries carried a document that was not a prelim

**Status:** CLOSED for repair by Gerard on 2026-09-10 — no notification, no
repair, fix forward. Kept as the evidence for why the content check changed.
**Window:** 2026-08-01 to 2026-09-02
**Scale:** 10 of 1,083 auto-deliveries (0.9%)

## Correction to the first report

My first pass said *"six outside firms received a file marked do-not-use as
their title report."* **That was wrong**, and it was wrong the way a filename is
always wrong — I read the name and inferred the content.

Reading the actual PDFs: of the six `dnu_` files delivered, **four are genuine
CLTA Preliminary Reports** and two are internal Order Summaries. `dnu_` is an
operator naming habit applied to several different kinds of document, not a
content marker. What "dnu" means to whoever typed it is still unknown and needs
a person at PCT to answer — but what the files *are* is now established, and it
is not what the prefix suggests.

The real exposure is **two documents, not six.**

## What actually went out

Every one of the ten was for the **correct order and the correct property** —
each PDF contains its own file number and its own street address. Nothing went
to the wrong order, and nothing went to a stranger. Verified by extracting the
text of all ten and matching against `order_properties`.

| # | File | Document sent | Content | To | Harm |
|---|---|---|---|---|---|
| 1 | 20020435-OCT | `Junior%20Loan%20Policy_210050.pdf` | **Loan policy** | cquintanar@pct.com | none — internal only |
| 2 | 20020526-GLT | `dnu_083121.pdf` | CLTA Preliminary Report | ana@anescrow.com | none — correct document |
| 3 | 20020828-GLT | `DNU_073112.pdf` | CLTA Preliminary Report | janeth@novaescrow.com | none — correct document |
| 4 | **20020875-GLT** | `dnu_140209.pdf` | **Order Summary (internal)** | **achacon@premescrow.com** | **internal data sent externally** |
| 5 | **20020913-GLT** | `dnu_064652.pdf` | **Order Summary (internal)** | **rose@powerhouseescrow.com** | **internal data sent externally** |
| 6 | 20021248-GLT | `dnu_151720.pdf` | CLTA Preliminary Report | etucker@coastcitiesescrow.com | none — correct document |
| 7 | 20021363-GLT | `dnu_170216.pdf` | CLTA Preliminary Report | gpadilla@premieroneescrow.com | none — correct document |
| 8 | 20021319-GLT | `Revised 1_044604.pdf` | CLTA Preliminary Report | var@lcdcapitalescrow.com | none — correct document |
| 9 | 20016710-GLT | `Revised 1_181531.pdf` | CLTA Preliminary Report | teambudd@blvdescrow.com | none — correct document |
| 10 | 20021491-GLT | `Recording Package_013155.pdf` | CLTA Preliminary Report | jonathan@805title.com | none — correct document |

Each was sent with the subject line `Preliminary Title Report — <address>`, and
CC'd a PCT address where one was resolved.

### The two that matter

**20020875-GLT → achacon@premescrow.com** and **20020913-GLT →
rose@powerhouseescrow.com**, both on 2026-08-11/12.

Both received an **Order Summary** — an internal document carrying the order
type, transaction type, settlement and disbursement dates, **marketing source**
and **marketing rep**. Neither escrow officer received the prelim they were
told they were getting, and both received PCT's internal referral-source data
for their own file.

Not a privacy breach involving a third party. But it is internal commercial
information sent outside the company, twice, and neither recipient knows the
attachment was not what the subject line said.

## Why the content check did not stop it

`prelim-content-check.ts` requires one strong marker (`preliminary title
report`, `clta preliminary`) **or** three of seven supporting markers. The
supporting list is `schedule b`, `exceptions`, `vesting`, `legal description`,
`effective date`, `policy of title insurance`, `title to said estate`.

`MIN_SUPPORTING_MARKERS = 3` was raised from 2 after deeds and judgments got
through. It is still counting **shared vocabulary**, and every document type in
this pipeline shares it:

- a **title insurance policy** contains Schedule B, exceptions, effective date,
  and the literal phrase "policy of title insurance" — four supporting markers
  unaided;
- an **Order Summary** contains settlement and disbursement language that
  overlaps enough to reach three.

The check answers "does this look like title paperwork?" — which everything in
an escrow file does. It does not answer "which kind of title paperwork is
this?", and that is the question it is being asked.

**Whatever replaces it must identify a document type positively**, on evidence
only that type carries, rather than counting words several types share. A CLTA
prelim announces itself in its first line — `CLTA Preliminary Report Form -
Modified (11/17/06)`. An ALTA loan policy announces itself in its ALTA
copyright block and Schedule A. An Order Summary opens `Order Summary Document
generated:`. These are not ambiguous documents; they are only ambiguous to a
check that counts nouns.


## Why the wrong document was picked — and it was not the selector

**Second correction.** The paragraph that used to sit here said "every one of
these orders had a real prelim available under a normal name". That was wrong,
and it was asserted rather than checked.

Reading the document table for all ten orders: **every one of them held exactly
ONE document, and it was the one that went out.**

```
20020435-OCT  2 docs   prelim: Junior Loan Policy    (+1 CPL, added a month later)
20020526-GLT  1 doc    prelim: dnu_083121.pdf
20020828-GLT  1 doc    prelim: DNU_073112.pdf
20020875-GLT  1 doc    prelim: dnu_140209.pdf
20020913-GLT  1 doc    prelim: dnu_064652.pdf
20021248-GLT  1 doc    prelim: dnu_151720.pdf
20021363-GLT  2 docs   prelim: dnu_170216.pdf        (+1 PPI, added a week later)
20021319-GLT  1 doc    prelim: Revised 1_044604.pdf
20016710-GLT  1 doc    prelim: Revised 1_181531.pdf
20021491-GLT  1 doc    prelim: Recording Package_013155.pdf
```

Not one of them held a correctly-named prelim. The selector — newest first over
`category = 'prelim' AND status = 'active'`, take the first PDF — had a single
candidate every time. Given one option it cannot choose badly.

**The cause is ingest.** `fetchPrelimsForOrder` calls `getAttachedDocuments`,
the GENERAL attachments endpoint, not `GetAttachedDocumentsPrelim`. SoftPro
returns a bare array of URL strings with no document type and no metadata of any
kind — confirmed against real logged responses:

```json
{"status":200,"attached":{"keys":[],"dataType":"array","itemTypes":["string"],
 "sample":["\"http://…/assets/Preliminary%20Title%20Report_220224.pdf\""]}}
```

`extractUrls` then takes every URL, and each is ingested with
`category: 'prelim'` unconditionally. Whatever is attached to the order becomes
"the prelim". If the only attachment is an Order Summary, that is what the
order's prelim is.

So the chain is: SoftPro exposes no type, we assume prelim, the selector has one
candidate, and the content check counts shared vocabulary and passes it.

**The ingest labelling is NOT fixed by this work** and needs its own decision.
Re-categorising at ingest changes which orders `fetch-prelims` considers to be
without a prelim — `NOT IN (SELECT order_id FROM documents WHERE category =
'prelim')` — so a naive change would trigger a large re-fetch. Flagged, not
touched.

### The likely fix, when we come to it

`GetAttachedDocumentsPrelim` exists and returns prelims specifically. Cursor
used it for the Update Prelim work because **the general endpoint is blind to
Production Documents subfolders** — and the prelim ingest path is calling the
general one.

Measured 2026-09-10, both endpoints on the same 12 closed orders opened more
than 90 days ago:

```
general endpoint total attachments : 5
prelim  endpoint total attachments : 11
```

On **7 of the 12** the general endpoint returned nothing at all while the
prelim endpoint returned the prelim. On one it was the reverse. On several they
returned different filenames for the same order — e.g. 20018782-GLT gives
`Revised 1_010710.pdf` from the general endpoint and
`Preliminary Title Report- Update_010710.pdf` from the prelim one, same
timestamp suffix.

So the general endpoint is not merely mislabelling what it finds; it is missing
more than half of what exists. Switching `fetchPrelimsForOrder` to
`GetAttachedDocumentsPrelim` is probably the answer, and it would narrow what
gets labelled `prelim` at the same time.

Not done here: it changes what the job fetches for every order, so it wants its
own change and its own re-fetch decision.

## Recurrence

17 `dnu_` documents exist, plus an unknown number of `Revised N` and
`Recording Package` files. The most recent mis-delivery was 2026-09-02.

The delivery gate now refuses anything that is not positively identified as a
preliminary title report, so the same document reaching the same point is
blocked and routed to a human. Ingest still mislabels, so the underlying
condition recurs; it just no longer reaches a recipient.

## Gerard's decision, 2026-09-10

- **No notification.** The two escrow officers will not be told.
- **No repair.** No corrected prelim re-sent, no document withdrawn.
- **Fix forward.** The two mis-deliveries are closed.

This document stays as the evidence for why the content check was replaced. It
is no longer a repair list.

Still open, deliberately:

- **`dnu_` remains unexplained.** Reading the files establishes what they ARE —
  four of the six delivered were genuine prelims — but not what the prefix means
  to whoever types it. Worth asking; nothing depends on the answer now that
  identification reads content.
- **Ingest still labels every attachment `category = 'prelim'`.** See above.

## What changed as a result

`prelim-content-check.ts` is **deleted**. It counted seven shared
title-paperwork phrases and passed anything with three; an ALTA policy carries
four unaided.

`src/lib/domain/documents/document-identity.ts` replaces it. Each type is
identified positively, by a phrase only that type carries, inside the opening
window where that type names itself. Delivery refuses anything that is not
positively a `clta_preliminary_report`, including a PDF whose text cannot be
extracted.

Validated against **92 real PDFs** pulled from S3: 40 of 40 named prelims
identified; the seven `dnu_` / `Revised` / `Recording Package` files that really
are prelims identified as prelims; both Order Summaries identified as Order
Summaries; the loan policy as a loan policy; 15 image-only TitlePoint scans
refused as unreadable. Zero surprises.

An earlier version searched the whole document and refused **31 of 40 genuine
prelims**, because a preliminary report names the ALTA policy forms that will be
issued from it. Unit tests on excerpts passed that version; only running it over
real files caught it. That is why signatures are anchored to an opening window,
and why there is a regression test for a prelim that mentions a policy.

The owner's-policy pattern is marked UNVALIDATED in the source: every policy in
the corpus is a loan policy, so that branch has never matched a real document.

## Related

- `document-identity.ts` — what replaced the check that passed all ten
