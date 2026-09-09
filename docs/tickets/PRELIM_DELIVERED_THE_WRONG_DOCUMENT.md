# Ten prelim deliveries carried a document that was not a prelim

**Status:** investigated, nothing repaired, no notification sent
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

## Why the wrong document was picked at all

Not investigated yet. The selector chooses a document from the order and every
one of these orders had a real prelim available under a normal name — 1,073 of
the 1,083 deliveries picked one correctly. The question is what makes it pick
`dnu_140209.pdf` over `Preliminary Title Report_NNNNNN.pdf` on the same order.
Likely most-recent-first with no type filter, but that is a guess and should be
read out of the code before anyone acts on it.

Note also that all twelve policy and supplement documents in the corpus are
stored with `category = 'prelim'`, so category is not currently a filter that
would have helped.

## Recurrence

17 `dnu_` documents exist, plus an unknown number of `Revised N` and
`Recording Package` files. The most recent mis-delivery was 2026-09-02, eight
days ago. Nothing has changed in the selector or the content check since, so
this can happen again on the next order whose prelim is not the newest
attachment.

## What has NOT been done

- **Nobody has been told.** Two escrow officers hold an internal Order Summary
  they believe is a title report. Whether to tell them is Gerard's call, not a
  developer's.
- **Nothing repaired.** No corrected prelim re-sent, no document withdrawn.
- **`dnu_` remains unexplained.** Somebody at PCT names files this way; ask
  them what it means before designing around it.

## Related

- `prelim-content-check.ts` — the check that passed all ten
- The final-policy-delivery build, which was about to inherit exactly this
  weakness by classifying legal documents on filename substrings
