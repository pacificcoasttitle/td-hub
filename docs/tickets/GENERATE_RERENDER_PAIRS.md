# Two paths, one document: every place they could diverge

**Status:** surveyed 2026-09-23. Two pairs closed, two facts recorded, one
decision outstanding.
**Raised by:** a re-rendered Concierge profile printing "Comparable 1" where
its first render printed "1481 BONITA AVE".

## The class

A report is built twice, from two different sources:

| | first render | re-render |
| --- | --- | --- |
| Concierge | payload → `normalizeComps` → candidates | stored comp rows → candidates |
| Farming | parsed CSV → computed figures | the **stored figures**, rendered again |

Nothing made the two agree. A field present in one path and absent from the
other diverges in silence, and the re-render is the path a reader is most
likely to be holding, because "Comparables" and "Try again" both re-render.

**The failure has no symptom.** The document is internally consistent and
wrong: the comparables change while page 8 still prints the criteria that were
supposed to produce them.

## Closed

**1 · Concierge comparables** (`comp-row.ts`). The write stored 22 fields, the
read rebuilt 13. `address` was the only one that showed, because it is the only
one the v2 layout prints; `apn`, `documentNumber`, `documentType`, `latitude`
and `longitude` were also being dropped. One mapping both directions now, with
a round-trip test over `COMP_DOCUMENT_FIELDS`.

**2 · Concierge subject facts** (`subject-facts.ts`). The four fields that
decide **which comparables appear** — building area, beds, baths, use
description — came from the normalised payload on one path and the stored
`subject_*` columns on the other. They agreed; they were never held together.
Same treatment.

## Surveyed and safe, with the reason

**3 · The farming reports do not recompute.** `rerenderFarming` renders the
FIGURES stored on the row — metrics, months, routes, standouts, cities,
totals — so there is no second computation to disagree with the first. That is
a structural immunity, not luck, and it is why the farming reports needed no
equivalent of the two modules above.

Two fields are nonetheless *reconstructed* rather than read, and both are now
pinned in `rerender-parity.test.ts`:

- `totalRoutes: row.datasetUsed`, where the first render used
  `computeCarrierRoute(rows).totalRoutes` — equal only because every parsed row
  becomes a route.
- `windowEndKey: String(row.windowEnd).slice(0, 7)` — correct only while
  drizzle's `date()` returns a string. Checked against production: it returns
  `"2025-08-01"`.

**4 · Comp coordinates and APN are read by nothing today.** The re-render does
not redraw the comp map; it loads the stored image by `compMapStorageKey`, so
no re-rendered map was ever drawn from null coordinates. `claim.ts` keys on the
SUBJECT's APN, not a comparable's. Both are carried through now, so they are
there when something does key on them.

## Outstanding: the farming template-version skew

`rerenderFarming` casts the stored figures with `as never` and does **not**
check `templateVersion`. A report created under one template and retried after
a layout change renders old figures through a new document — and a missing
field arrives as `undefined`, not as an error.

Exposure is narrow today: only a `failed` row can be tried again, and that
usually happens minutes later. It is listed because the narrowness is a
circumstance, not a guarantee.

## Decision made: `concierge_profile_transfers` stays

The table is written on every generation and read by nothing — the document
re-normalises transfers from the raw payload. The question was whether it is
redundant or an audit record, and that turns on one fact:

> **Do we keep the raw vendor payload indefinitely?**

Checked 2026-09-23, both halves:

- **No code prunes it.** Nothing under `src/lib` deletes, expires or ages out a
  stored payload.
- **The bucket has no lifecycle configuration at all.**
  `GetBucketLifecycleConfiguration` returns `NoSuchLifecycleConfiguration`.

So payloads are kept indefinitely **today**, which makes the table redundant
**today**. That is a state, not a policy, and the asymmetry decides it:

- Drop the table, add a lifecycle rule later for storage cost, and the only
  record of what SiteX said about transfers on the day we charged for the
  profile is gone — with no warning, because nothing reads the table and
  nothing would fail.
- Keep it, and the cost is a few kilobytes per profile.

**It stays, and it is an audit record rather than a cache.** If indefinite
payload retention is ever written down as policy, this can be revisited — and
if a lifecycle rule is ever added to that bucket, this table is the reason it
is safe to do so.
