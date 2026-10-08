# `fix/sitex-entity-owner-names` is unmerged and holds the only measurement we have

**Raised** 2026-10-08. **Branch last touched** 2026-08-26 — six weeks ago.
**Why now:** the Concierge vesting box needed to know whether SiteX tells us an
owner is a company. The answer already existed, on this branch, and was found
only because somebody remembered it was there.

## The thing worth not losing

`src/lib/integrations/sitex/owner-kind.ts` is a measurement, not a guess:

- **`PropertyProfile` carries no entity flag.** It has exactly two owner
  fields, `PrimaryOwnerName` and `OwnerPhoneNum`, and neither has a type.
  Checked against the feed schema and two real production payloads.
- **`TransferHistory` does carry the signal, and we were discarding it.** Every
  deed party is `{ LastOrCorporateName, FirstAndMiddleName, EntityCode,
  EntityCodeDesc }`, and `FirstAndMiddleName` is **absent — the key, not an
  empty string** — for an organization and present for a person. Measured
  across all 74 party objects in an entity-owned payload: **74 agree, 0
  disagree.**
- **`EntityCode` is NOT the discriminator**, despite the name. Its domain mixes
  entity types (`LC`, `CO`) with marital and survivorship status (`HW`, `SM`,
  `SW`, `ID`, `TS`), and `AK` — "a/k/a" — appears on both an entity and a
  person in the same payload. One party carried no `EntityCode` at all.
  `FirstAndMiddleName` was right in all three of those cases and `EntityCode`
  was not.

A 74/0 split on real production data is the most decisive owner-kind evidence
in the repo, and it is reachable only by someone who knows the branch name.

## Why this is a ticket and not a merge

The branch is five commits and 17 files, and it is not just the measurement:

| | |
|---|---|
| `src/lib/integrations/sitex/owner-kind.ts` + tests | the measurement and the derivation |
| `src/lib/domain/orders/names/entity-markers.ts` | a 137-line marker list |
| `src/lib/domain/orders/names/sitex-owner-names.ts` | name-splitting behaviour change |
| `src/components/shared/property-confirm-modal.tsx` | the order form asks SiteX instead of the suffix list |
| `src/lib/integrations/sitex/parsers.ts`, `types.ts`, `client.ts` | parsing the new section |

That last one changes **what an operator sees when opening an order**, six
weeks behind `main`. It needs its own review on its own terms, and nobody
should merge it to rescue a comment.

## What would close this

Any one of these, in preference order:

1. **Merge it** after the review it never got — the measurement and the order
   form change together, as one decision.
2. **Split it:** land `owner-kind.ts` and its tests (inert until something
   calls it), ticket the order-form change separately.
3. **Extract the measurement into `docs/`** and delete the branch. Weakest
   option — a document describing a measurement is not the measurement, and
   that confusion has cost us twice already (see below).

## The pattern this is an instance of

`feat/update-prelim` sat four weeks behind `main` with two conflicts and
unproven staging, and the only reason anyone knows what is in it is that it was
pushed and PR'd (#209) explicitly as not ready. `td-hub-wt-parity` is off
limits entirely. A branch holding the only copy of something true is how a
measurement becomes folklore.

Related, and the reason this one surfaced: the Concierge vesting box printed a
company name reordered as a person for weeks, and the reason it was defensible
to keep reading order on the page 3 owner rows — "'Recorded as' sits underneath
it" — turned out to describe the **v3 design document**, not the code. The line
did not exist until 2026-10-08. Same shape as the `SOURCE_OF_TRUTH` doc
describing a gate that was never built: **a document saying a thing is there is
not evidence that it is there.**
