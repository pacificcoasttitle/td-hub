# One person, two contact rows, and a resolver that picks the wrong one

**Status:** open, not implemented. Measurement only. Raised out of the parties
typeahead work (`feat/hub-parties-display-only`, PR #49) and deliberately kept
out of it.

**Why it is separate:** PR #49 needed to know which fields distinguish two
same-named contacts in a dropdown, and got that answer. Merging the rows is a
different act — irreversible, and on an escrow officer it is the Anna
Ballesteros defect with a bigger blast radius. Nothing here should be
implemented without the ownership decisions at the end.

All figures below are read-only queries against production, snapshot
**2026-08-27 18:43 UTC**. Every query is given so the numbers can be re-derived;
the contacts table gains rows continuously (27 in the last 7 days), so counts
will drift by single digits.

## Why this is the Ballesteros defect, not untidiness

SoftPro holds a PCT escrow officer in two places: an address book, keyed by a
lookup code like `AnnBalPaci`, and an internal user directory, keyed
`PCT\aballesteros`. Both arrive on separate feeds, and the hub stores each as its
own `contacts` row. `LookUpCodeEscrowOfficer` must carry the user code. Sending
the address-book code is not rejected — staging accepted `AnnBalPaci`, created
TEST-20002217-OCT, and returned an order with **no escrow officer at all**. Fixed
for the outbound payload in `fix/softpro-te-branch-code`.

The duplicate rows that caused it are still there, and so is the mechanism that
picks the wrong one. For four of the six PCT escrow officers, **every order
reference sits on the wrong row**:

| Officer | Office row | Refs | Address-book row | Refs |
| --- | --- | --- | --- | --- |
| Anna Ballesteros | 12 — office `PRV` | **0** | 17165 — `AnnBalPaci`, no office | 75 orders, 58 parties |
| Joseph Gomez | 14 — office `GLT` | **0** | 10999 — `JosGomPaci`, no office | 86 orders, 6 parties |
| Karla Casco | 15 — office `ONT` | **0** | 10642 — `KarCasPaci`, no office | 84 orders, 5 parties |
| Lupe Vidaca | 16 — office `OCT` | **0** | 8996 — `LupVidPaci`, no office | 117 orders, 54 parties |
| Analleli Ayala | 11 — office `OCT` | 1 order | 17626 — `AnaAyaPaci`, no office | 0 |
| Christine Quintanar | 13 — office `OCT` | 387 orders | 15523 — `ChrQuiStew`, no office | 0 |

362 orders point at a row with no office code, for officers whose office code is
sitting on a row nothing points at. Ayala and Quintanar are the control: same
two-row shape, references on the correct row, and they work.

The deciding field is `contacts.is_escrow_officer`, and it is on the wrong row in
exactly those four cases.

## The damage, measured

**Population.** Active contacts with a usable name — `is_active = true` and a
non-blank `full_name`, or `first_name`/`last_name` to fall back on, whitespace
collapsed and lowercased:

```sql
lower(btrim(regexp_replace(
  coalesce(nullif(btrim(full_name),''),
           nullif(btrim(concat_ws(' ', first_name, last_name)),'')),
  '\s+', ' ', 'g')))
```

| Population | Rows |
| --- | --- |
| `contacts` total | 21,710 |
| `is_active = true` | 21,704 |
| ...carrying a name (the population below) | 17,627 |
| ...active but nameless (companies, stubs) | 4,077 |

**Collisions.** Grouping that normalised name and keeping groups of 2 or more:

| Measure | Value | Share of named |
| --- | --- | --- |
| Name-collision groups | 3,179 | — |
| Contacts inside them | 7,167 | **40.7%** |

**Kind of duplicate.** Three buckets, on `company_name`, `email`, `phone`
(digits only) and `city`. A field *contradicts* only when the group holds two
different **non-blank** values; blank versus filled is missing data, not
disagreement.

| Kind | Definition | Groups | Contacts |
| --- | --- | --- | --- |
| Exact | all four byte-identical across the group, blanks included | 1,010 | 2,087 |
| Complementary | nothing contradicts, but one row carries data the other lacks | 913 | 1,860 |
| Distinct people | at least one field holds two different non-blank values | 1,256 | 3,220 |

Exact plus complementary is **1,923 groups (60.5%)** where no field in the picker
tells the two rows apart. Those are the same person entered twice.

A note on the earlier figures, because they do not reproduce. PR #49 reported
57% identical on all four and 1,364 distinct-people groups, with company
separating 83.5%. Under the definition above, company separates only 25.9% —
because most of company's apparent separating power was blank-versus-filled, not
two real companies. The population figures (17,627 named, 3,179 groups, 40.7%)
reproduce to within two rows. **Use the definition stated here, not the earlier
percentages.** PR #49's field-ordering decision is unaffected: for showing a
human which row is which, blank-versus-filled genuinely does help.

**Harm.** Counting `orders` references — `escrow_officer_id`, `title_officer_id`,
`sales_rep_id`, `client_contact_id`, `lender_id`, `listing_agent_id` — plus
`order_parties.contact_id`, per row:

| Group shape | Groups | Share |
| --- | --- | --- |
| Nothing references any row — costs nothing today | 2,419 | 76.1% |
| Exactly one row referenced, the twin orphaned | 627 | 19.7% |
| **References split across two or more rows** | **133** | 4.2% |

The 133 split groups carry 1,787 order references and 1,718 `order_parties` rows
between them. Those are the ones where one relationship is stored as two, so any
per-contact view — order history, CRM metrics, notification recipients — shows
half of it.

**The Ballesteros shape specifically.** Groups whose rows disagree on a field the
vendor resolution depends on: `office_lookup_code`, the `softpro_lookup_code`
namespace, `is_title_officer` or `is_escrow_officer`.

| Shape | Groups |
| --- | --- |
| A `PCT\` user row paired with an address-book row | 7 |
| Both rows `PCT\`, one with an office code and one without | 1 (Ballesteros) |
| `office_lookup_code` present on one row, absent on its twin | 8 |
| `is_escrow_officer` disagrees across the group | 364 |
| `is_title_officer` disagrees across the group | 2 |
| **Same `source_system` + `source_id`, two rows** | **4** |

Those last four are Ballesteros, Gomez, Casco and Vidaca — the same four in the
table above. Both rows carry `source_id = 'PCT\<user>'`. They are not two people
who happen to share a name; they are the same vendor record stored twice, and
there is no constraint saying they cannot be.

The 364 `is_escrow_officer` disagreements are mostly benign — one row flagged, a
different person with the same name not flagged. They matter because that flag is
the resolver's only filter, which the next section covers.

**Can an order still silently lose its escrow officer?** Not through this path,
today. Zero orders point at a non-`PCT\` escrow officer row while a `PCT\` twin
of the same name exists, because the address-book rows for those four officers
were backfilled with `PCT\` codes — so `resolveEscrowOfficerLookup` now returns a
user code even from the wrong row. The value is right by accident: the row is
still wrong, `office_lookup_code` is still NULL on it, and the next resolver to
read a different column off that row gets the wrong answer.

Separately, 2,957 orders have `escrow_officer_id` pointing at a contact with no
`PCT\` code at all (663 distinct contacts). Those are outside escrow officers on
orders that originated in SoftPro, so nothing was sent and nothing was dropped.
They would become a silent drop if the hub ever builds an outbound payload for an
existing order. Out of scope here; noted so the number is not rediscovered.

## Why it happens

Four causes. The first is why duplicates exist, the second is why they are never
cleaned up, the third is why the wrong one wins, the fourth is why it is
self-reinforcing.

**1. The sync feeds match on disjoint keys, so neither can see the other's row.**
Every writer in `sync-contacts.ts` does its own select-then-insert, on its own
column:

| Writer | Match key |
| --- | --- |
| `syncOpenContacts` | `lookup_code` |
| `syncSalesRepRows` | `lookup_code` |
| `syncTitleOfficers` | `closer_examiner` **or** `softpro_lookup_code` |
| `syncEscrowOfficers` | `closer_examiner` **or** `softpro_lookup_code` |
| `syncCompanyType` (contacts half) | `flookup_code` |
| `enrich-orders.resolveContact` | `lookup_code`, `softpro_lookup_code` or `source_id` |
| `POST /api/contacts` | **nothing — unconditional insert** |

A person on the officer feed as `PCT\aballesteros` and on the contact feed as
`AnnBalPaci` is a miss for both keys, so both insert. No writer matches on name
or email. `POST /api/contacts` does not look before inserting at all.

**2. There is no uniqueness constraint that would have stopped it.** The only
unique indexes on `contacts` are `contacts_pkey` and a partial unique on
`closer_examiner`. Nothing on `(source_system, source_id)`, `lookup_code`,
`softpro_lookup_code` or `email` — which is how four rows came to share a
`source_id` with another row.

**3. `loadEscrowOfficers` filters to the flag, and the flag is on the wrong
row.** The escrow officer resolver is name-only:

```
loadEscrowOfficers() -> select ... from contacts where is_escrow_officer = true
resolveEscrowOfficerId(name, officers) -> first officer whose name matches
```

This is not a near miss between two candidates. For Ballesteros, Gomez, Casco and
Vidaca the office-bearing row has `is_escrow_officer = false`, so it is **not in
the candidate list at all** and the name match cannot reach it. The result is
deterministic and always the wrong row. `loadEscrowOfficers` returns 725 rows, of
which 719 are address-book rows with no office code and 6 are `PCT\` rows.

`resolveTitleOfficerId` has the same name-only shape but `is_title_officer` sits
on the correct row, which is why Clive Virata (2,025 orders) and Jim Jean (1,445)
resolve correctly. The resolver is not more careful; the flag happens to be right.

**4. The flag is derived from the assignments it produces.**
`reconcileEscrowOfficerFlagsFromOrders` sets `is_escrow_officer` on every contact
ever assigned as an escrow officer on an order. Those assignments came from
`resolveEscrowOfficerId`, which reads the flag. A row that was wrongly assigned
once is flagged, stays in the candidate list, and keeps being assigned.

## Is the tap still running?

Yes, slowly. Counting rows in a collision group created after the first row in
that group:

| Window | New duplicate rows |
| --- | --- |
| Last 7 days | 5 |
| Last 30 days | 7 |
| Last 90 days | 55 |
| All time | 3,988 |

Most recent: 2026-08-27 05:59 UTC, the morning this was written. 27 contacts were
created in the last 7 days, so roughly one in five new contacts lands on an
existing name. This is a backlog **and** a leak; cleaning without closing it
means doing it again.

One mitigation is already in place and worth knowing about before anything is
changed. `syncEscrowOfficers` skips a `PCT\` feed row when a contact with the same
email and a non-`PCT\` `source_id` exists, to avoid recreating officer
duplicates. It does not fire for the four pairs above, because both their rows
have a `PCT\` `source_id`. It also means that when it does fire, the officer row
stops being refreshed from the feed.

There is a live hazard in the same function. Its match is
`closer_examiner = examiner OR softpro_lookup_code = examiner`, `limit 1`, with no
`ORDER BY`. Both rows of each pair now satisfy the second half. If the plan
returns the address-book row, the update sets `closer_examiner` to a value the
officer row already holds, the partial unique index rejects it, and the error is
swallowed into the result's `errors` array — so the officer silently stops being
synced. Worth confirming against a sync run before touching anything else.

## Proposed approach

Not implemented. In order, because each step makes the next safe.

**Step 1 — fix the flag, not the rows.** Point `loadEscrowOfficers` at
`internalOfficerFilter('escrow_officer')` — the filter `/api/form-options`
already uses, which requires a `PCT\` code and a non-empty `office_lookup_code`.
This makes the resolver reach the right row for all six officers and touches no
data. Do this first: it stops new orders joining the 362, and it is a one-line
change with an existing, tested filter behind it. Note it will make
`resolveEscrowOfficerId` return NULL where it previously returned a wrong row, so
check what reads `escrow_officer_id` and prefers a wrong answer to none.

**Step 2 — stop the officer feed creating pairs.** Add a unique index on
`(source_system, source_id)` where both are non-null. Four rows violate it today
and must be resolved first, which is Step 3. Until then, make each sync writer's
match key explicit, and give `POST /api/contacts` a match-before-insert on
`(source_system, source_id)`.

**Step 3 — merge only the four officer pairs, by hand.** Not the 1,923. These four
are provably one vendor record (identical `source_id`), they are the only ones
that touch vendor resolution, and the winner is unambiguous: the row with the
office code. Move `escrow_officer_id`, `client_contact_id` and
`order_parties.contact_id` from the address-book row to the officer row, then
deactivate the loser rather than deleting it. 362 orders, 123 `order_parties`
rows, 42 `client_contact_id` references. Write the reverse mapping to a table
before running it, because there is no other way back.

**Step 4 — the 1,923-group backlog is a separate decision, and mostly not worth
making.** 2,419 of 3,179 groups are referenced by nothing at all; merging them
changes no behaviour and risks a mistake for no gain. Deactivating an unreferenced
duplicate is enough. The 133 split groups are the only ones with a real cost, and
they need a human to confirm each. There is no safe bulk merge here.

## What is risky, stated plainly

- **Merging is not reversible.** Repointing a foreign key loses which row the
  order originally named. If Step 3 picks the wrong winner on an escrow officer,
  the result is the Ballesteros defect on 362 existing orders instead of a
  staging test order.
- **Two rows can be the same vendor record and still not be the same person.**
  Gomez, Casco and Vidaca each have a *third* row at a different company
  (`JosGomBoul`, `KarCasLega`, `LupVidMiCa`). Any name-based merge that swept
  those in would combine two different people. This is why Step 3 is keyed on
  `source_id` and not on name.
- **Step 1 changes what NULL means.** An order that previously showed a wrong
  escrow officer will show none. That is more honest and it is also a visible
  regression to whoever reads that field. Say so before shipping it.
- **The flag reconciliation must be retired in the same change as Step 1**, or it
  will re-flag the address-book rows from the 362 existing assignments and put
  them back in the candidate list.

## Open questions that are not ours to answer

- **Should SoftPro hold one record or two?** The hub is faithfully mirroring a
  split that exists in the vendor. If SoftPro can be asked to reconcile its own
  address book against its user directory, that is a better fix than anything in
  this repo, and it is a conversation, not a build.
- **Is a deactivated duplicate acceptable, or must rows be deleted?** Everything
  proposed above prefers `is_active = false` to a delete, because a delete throws
  away the evidence. If retention or an audit requires actual removal, Step 3
  needs a different design.

---

## 2026-09-03, Claude — measured at 1,420, and how it was found

**The number.** 16,858 person rows with a first and last name resolve to 15,438
distinct identities on `(first, last, company, email)`. **1,420 surplus rows.**

```
x9  Aashi Narang      x8  Siyu Guo          x7  Victor Wen
x7  Title Report      x6  Silvia Lee        x6  Will Quintanilla
x6  Tom Deluca        x5  Yessenia Garcia
```

`Title Report` appears seven times as a *person*.

### How it surfaced, because the method is the point

Nobody was looking for duplicates. The task was to find a better lookup-code
formula, so I measured collision rates for several arrangements of name letters
inside ten characters:

```
current 3+3+4    14200 distinct   4723 colliding (28.0%)
4+4+2            14552 distinct   4189 (24.8%)
3+5+2            14491 distinct   4279 (25.4%)
2+6+2            14215 distinct   4668 (27.7%)
1+7+2            13416 distinct   5630 (33.4%)
```

No arrangement helped much, so I tried replacing letters with a hash of the
contact's identity, expecting collisions to fall to nearly zero:

```
3+3 + 4-char hash    15438 distinct   2712 (16.1%)
4+3 + 3-char hash    15438 distinct   2712 (16.1%)
3+5 + 2-char hash    15436 distinct   2714 (16.1%)
```

**All three landed on the same floor — 15,438 distinct, 16.1%.** A hash does not
collide by accident, and it certainly does not collide identically across three
different shapes. The only thing that produces that plateau is inputs that are
byte-for-byte the same. The "collisions" the hash could not remove were not
collisions at all: they were the same person entered repeatedly.

That plateau *is* the duplicate count. 15,438 is the number of distinct people;
everything above it is surplus rows.

The general form, worth keeping: **a result that refuses to move when the method
changes is telling you about the data, not the method.**

### What it means for the lookup codes

Of the 28% collision rate on the current formula, roughly 16 points are
duplicate records and only about 12 points are the formula genuinely colliding
on different people. Bucket sizes confirm there is no crisis in the formula:

```
worst bucket 13    buckets > 9: 1    buckets > 99: 0
```

A ten-character code leaves 9 one-digit suffix slots and 90 two-digit ones, so
the fixed uniquifier (#902df82) has ample room and the formula does not need
replacing. **The duplicates are the bigger lever, and they are this ticket.**
