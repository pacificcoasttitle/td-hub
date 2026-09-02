# Legal & Vesting, Grant Deed and Taxes never reach the hub

**Status: measured, NOT fixed.** The fix is not ours — see Owner.
Opened: 2026-08-26
Found: measuring what the hub detail pane could actually display.

## The ask, and why it needed measuring first

The open-order team asked for these three in the hub because **they are
produced at order-open**. They exist. The question was only whether the hub
can show them.

It cannot, today.

## What is on file, all 8,036 orders

| document | orders with one | % | who makes it |
|---|---:|---:|---|
| Preliminary report | 5,634 | 70.1% | SoftPro → our S3, via `fetch_prelims` + prelim webhook |
| Legal & vesting | 7 | 0.09% | produced at order-open, **has never arrived** |
| Grant deed | 7 | 0.09% | same |
| Taxes | 7 | 0.09% | same |
| CPL | 2 | 0.02% | ours to generate (FNF) |
| Proposed insured | **0** | 0% | ours to generate |

## The 7 are one test batch, not production traffic

Legal & vesting, grant deed and taxes are present on the **identical** seven
orders:

```
51, 4773, 4774, 6429, 6430, 7308, 7309
```

Byte-for-byte the same set for all three categories. Consecutive pairs.
`created_by` is `system:pre_init` (4 each) and `system:auto` (2 each), with one
human upload. Earliest 2026-03-30.

That is a March test batch. **In five months of production these three
document types have arrived for zero real orders.**

Order 51 also holds one of the two CPLs, which confirms it as the test order.

## Why the labels matter

A chip reading "None on file" would be **true and misleading**: it invites the
reader to conclude the document does not exist, when in fact it exists in
SoftPro and has simply never been transmitted.

Wording shipped on the detail pane, by source:

| document | chip reads | because |
|---|---|---|
| Legal & vesting | **Not received** | produced upstream, not transmitted |
| Grant deed | **Not received** | same |
| Taxes | **Not received** | same |
| CPL | **Not generated** | ours to make; nobody has |
| Proposed insured | **Not generated** | ours to make; nobody ever has |
| Property profile | **Not generated** | ours to make — the only tile of the three |

Note this refines the earlier rule of thumb ("None on file" for anything
SoftPro sources, "Not generated" only for the property profile). Measurement
moved two documents across the line: **CPL and proposed insured are not
SoftPro-sourced at all** — `generateProposedInsured` and the FNF CPL path are
both ours. "None on file" would have implied an upstream system failed to send
something it was never asked for.

## Owner: the AddDocuments path (landed as `fix/softpro-adddocuments-batch`)

The earlier assumption — "they exist in SoftPro and have never been
transmitted here" — was wrong on the seven test files. We sent them. ~~SoftPro
attached nothing. We marked `is_synced`. GetAttachedDocuments on 2026-08-28
found **zero** of those 13 "synced" documents.~~ **Void — 2026-08-31.** Empty
GetAttachedDocuments is not "attached nothing." That GET does not list
Production Documents / LV / Grant Deed / Taxes. See `TITLE_DOCS_FALSE_SYNC.md`.

The write path now batches LV / grant deed / tax into one AddDocuments call,
sends clean FileURLs, uses legacy folder strings, and ~~**does not mark synced
until GetAttachedDocuments confirms the names.**~~ **Void as a hard rule —
2026-08-31.** Write-accepted (AddDocuments 200 or already-exists) marks
`is_synced_to_softpro` and leaves `softpro_listing_confirmed` false when the
listing is empty. Do not retry an accept. Cleanup of the seven is a
separate ticket. SoftPro orders that AddDocuments will refuse are
`SOFTPRO_ADDDOCUMENTS_REQUIRED_FIELDS.md`.

## The batching fix is NOT done when the documents arrive

There is a second half, and it is invisible from the SoftPro side.

The API that feeds the hub returns these three categories as a **bare `exists`
boolean with no document id**:

```ts
export interface DocCatFull { exists: boolean; count: number; latestId: number | null; latestCreatedAt: string | null }
interface DocCatBool { exists: boolean }

export interface OrderDocuments {
  cpl: DocCatFull; prelim: DocCatFull; proposedInsured: DocCatFull;
  legalVesting: DocCatBool; tax: DocCatBool; grantDeed: DocCatBool;   // ← no id
}
```

`cpl`, `prelim` and `proposedInsured` carry `latestId`, so their chips become
working "view" links the moment a document appears. **`legalVesting`, `tax` and
`grantDeed` cannot.** With no id there is no `/api/documents/{id}/view` to
open.

So if only the transmission half lands, those three chips flip from
"not received" to "on file" — and still go nowhere. The operator learns the
document exists and gains no way to read it, which is arguably worse than the
current state: today the chip is honest about having nothing.

The hub renders "on file" without a link rather than a link that 404s, so the
failure is at least not silent. But **the fix is not complete until those three
categories return `latestId`** (and ideally `count` and `latestCreatedAt`, so
they can be promoted to tiles that show a date like the prelim does).

**Acceptance for the batching work should therefore be: open the document from
the hub.** Not "the document arrives" — arriving is necessary and not
sufficient.

## Revisit when it lands

Promote legal & vesting, grant deed and taxes from chips to full tiles once
coverage is non-trivial **and they carry an id** — the section above is the
blocker, not the coverage number.

On the hub side promotion is small: move the entry out of the `CHIPS` array in
`documents-panel.tsx` and render a tile. No new fetch path and no new state.
But it cannot happen while the category is a `DocCatBool`, because a tile's
whole purpose is the View and Download buttons, and there is nothing to point
them at.

**Re-measure before promoting.** The threshold that matters is what fraction
of orders opened AFTER the fix carry one, not the all-time number, which the
March test batch will keep depressing for a long time.

## Prelim: a related correction, already acted on

The standing belief was that prelims come back empty from
`GetAttachedDocuments` — "410 of 418 Title & Escrow orders". That is true, and
it is not the whole picture:

| order_type | orders | with prelim | |
|---|---:|---:|---:|
| Title only | 6,805 | 5,618 | **82.6%** |
| Title & Escrow | 798 | 16 | 2.0% |
| Trustee Sale Guarantee | 159 | 0 | 0% |
| Escrow only | 26 | 0 | 0% |

T&E is 98% empty as reported — but it is 10% of the book. Title only is 85% of
all orders and 83% of those have a prelim on file. The prelim is therefore a
full tile, not a chip, and it reads from our own S3 (`prelim-upload-doc/`), so
it does not depend on `GetAttachedDocuments` succeeding at view time.

T&E emptiness is a **fetch-endpoint** problem, not a missing document:
`GetAttachedDocuments` is empty on T&E files that `GetAttachedDocumentsPrelim`
returns. That ingest is a one-shot (`backfillTePrelimsWithoutDelivery`), not
the live cron. Title-only / `softpro.fetch_prelims` stays on
`GetAttachedDocuments`.

Landing those historical prelims on normally-synced orders (import lag ~0)
is **document fetch lag**. The Aug 27 `isBackfilledOrder` gate does not cover
it — 371 of 548 T&E-without-prelim would still send. See
`PRELIM_GATE_MISSES_DOCUMENT_FETCH_LAG.md`. Do not add a suppression to the
live delivery path to fix a backfill.


---

## CORRECTION — 2026-09-02, Claude — split on source

**Appended, not rewritten.** The analysis above stands on its own terms; this
adds the one dimension it does not have. Nothing in the original has been
edited.

**Legacy is running concurrently and is handling PCT's business.** The hub is
being built alongside it, and the team cuts over when it is ready. So a gap on
an order the hub did not create is not evidence of anything — legacy sent that
confirmation, delivered that prelim, attached those documents.

Every measurement has to split on source:

```
softpro_sync (legacy's order, mirrored here)   8,185
manual_entry (hub-created, ours end to end)       40
                                               ─────
                                               8,225      hub = 0.49%
```

**Any figure counted across the whole table is 99.5% legacy's orders by
construction.** For this ticket that means at most 40 of the population
described above could possibly be ours to have failed.

**One refinement, because the rule is easy to over-apply:** source tells you
whose ORDER it is, not whose ACTION. We push CPLs and prelims onto legacy's
synced orders, and a failure in one of OUR calls is ours to own wherever the
order came from. The rule applies to ABSENCE — nothing sent, nothing delivered
— where legacy plausibly did it.

The re-measurement is not a restatement of this ticket's query, which was not
reproduced. It is a separate count and the two should not be conflated.

**Independently counted here** — Title & Escrow orders with no prelim
document: **3 of 3 hub-created, 315 of 804 synced.** The three are ours and
worth looking at; the rest are legacy's book.
