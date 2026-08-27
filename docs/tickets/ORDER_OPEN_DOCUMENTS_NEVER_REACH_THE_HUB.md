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

## Owner: the AddDocuments batching fix (Cursor)

These fill in once that lands. Two things it changes:

1. **All documents for an order in ONE call**, rather than a call per document.
2. **No query strings in `FileURL`s.**

Until then the hub has nothing to display for these three, and no amount of
work on the hub side changes that — the documents are not arriving.

## Revisit when it lands

Promote legal & vesting, grant deed and taxes from chips to full tiles once
coverage is non-trivial. The detail pane is built so this is a small change:
they already flow through the same `DocState` shape as the prelim tile, and
promoting them is moving entries between two arrays in
`documents-panel.tsx` — no new fetch path, no new state.

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
