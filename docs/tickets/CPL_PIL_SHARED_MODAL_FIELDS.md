# CPL and Proposed Insured — the field overlap

**Status: BUILT. Read-only prefill, no migration.**
Opened: 2026-09-03 · Built: 2026-09-08

`src/lib/domain/documents/cpl-ref-prefill.ts` reads the shared values;
`proposed-insured-prefill.ts` layers them over what it already derives. The
open question at the bottom of this document is answered — see *The decision*.

The team generates a CPL, opens Proposed Insured, and retypes the same lender,
borrower, property and loan details. This is the mapping that decides what
prefills.

---

## The store already exists — extend it, do not build one

`order_external_refs`, keyed `(order_id, system, ref_type)`, upserted on
conflict. `cpl/service.ts:392-411` already writes seven values after a
successful CPL:

```
cpl_lender_address     cpl_lender_city      cpl_lender_state
cpl_lender_zip         cpl_assignment_clause
cpl_loan_number        cpl_lender_contact   cpl_branch_id
```

and `cpl-modal.tsx:268-287` reads them back, so a CPL already survives a reload.

**Two problems with reusing it as-is, both worth deciding before any code:**

1. **`system` is the underwriter** (`westcor` / `fnf`). A value saved while the
   order was on Westcor is invisible if the operator later picks FNF, and
   invisible to Proposed Insured, which has no underwriter.

   Both scopes are already populated — `westcor` 412 rows across 52 orders,
   `fnf` 16 rows across 2 — so this is not hypothetical: the two sets cannot see
   each other, and an order re-issued under the other underwriter starts from
   blank fields.

   Shared fields need a system that is not underwriter-specific.
2. **Proposed Insured writes nothing at all.** Its prefill
   (`proposed-insured-prefill.ts`) reads `companies` and `order_parties` and
   **never touches `order_external_refs`** — so the operator's CPL edits are
   already invisible to it today. That is the whole bug.

---

## The mapping

### IDENTICAL — same meaning, same shape, same label (13 fields)

These are the genuine overlap and the only ones that should prefill.

| Field | CPL | Proposed Insured |
|---|---|---|
| Lender company | `lenderCompany` | `lenderCompany` |
| Assignment clause | `assignmentClause` | `assignmentClause` |
| Lender address | `lenderAddr` | `lenderAddr` |
| Lender city | `lenderCity` | `lenderCity` |
| Lender state | `lenderState` | `lenderState` |
| Lender ZIP | `lenderZip` | `lenderZip` |
| Property street | `propStreet` | `propStreet` |
| Property city | `propCity` | `propCity` |
| Property state | `propState` | `propState` |
| Property ZIP | `propZip` | `propZip` |
| Loan number | `loanNumber` | `loanNumber` |
| Loan amount | `loanAmount` | `loanAmount` |
| Borrower / vesting | `borrower` | `borrower` |

**Borrower is genuinely identical** — both render `label="Primary Borrower /
Vesting"`, and both are a single free-text line, not a parsed name. Verified in
source rather than inferred from the variable name.

`lenderType` (`existing` / `new`) is a **UI mode**, not data. It should be
derived from whether a company name arrived, exactly as Proposed Insured already
does (`setLenderType(data.lender?.companyId ? 'existing' : 'new')`), not carried
across.

### THE TRAP — same name, different meaning (1 field)

**`branchId` must NOT be shared.**

```
CPL   /api/cpl-branches?underwriter=westcor   -> underwriter branch codes
                                                  e.g. CA1038, CA1038.01, PCT-CW-OR
PI    /api/branches                            -> PCT internal branches
                                                  e.g. OCT, GLT
```

Two different tables, two different id spaces, one field name. Sharing it would
put a Westcor branch id into a PCT branch selector — silently, because both are
integers and both populate a dropdown.

This is the same shape as the `ADMIN_ROLES` defect from yesterday: one name,
two meanings, and nothing to catch the confusion. It is called out here so the
build does not "helpfully" include it.

### SIMILAR BUT NOT INTERCHANGEABLE (2 fields)

| Field | Why not shared |
|---|---|
| CPL `lenderContact` | The **person** at the lender ("Attention"). Proposed Insured has no equivalent input, so there is nothing to prefill into. It stays a CPL-only value. |
| PI `lenderCompanyId` + `lenderLookupCode` | Proposed Insured tracks the lender's **company identity**; CPL tracks only the typed name and address. Sharing the text without the id would leave PI holding a name it cannot resolve. If anything moves here it should be the id **to** PI, never the reverse — and only once someone decides what a CPL-typed "new lender" means to PI. |

### UNIQUE — never prefills (11 fields)

| CPL only | Proposed Insured only |
|---|---|
| `underwriter` (westcor / fnf) | `titleOfficerId` |
| `salesAmount` | `supplementalDate` |
| `seller` | `prelimDate` |
| `txType` (derived from the order) | `lenderCompanyId` |
| `existingCpls` (display) | `lenderLookupCode` |
| `sellerOfRecord` (display) | `existingDocs` (display) |
| `borrowerFrom` / `sellerFrom` (provenance) | |

`salesAmount` and `seller` are CPL-only because a Proposed Insured letter names
neither. `supplementalDate` / `prelimDate` are report dates with no CPL meaning.

---

## The rules, applied

- **Prefilled values are editable and the operator's change wins.** Same
  treatment as the CPL modal's SiteX prefill today — the stored value decides
  what the field *starts* as, nothing more.
- **A change on the second letter does not retroactively alter the first.** The
  store holds the operator's *latest* input per field; an already-issued PDF is
  a rendered artifact and is never revisited. Worth stating because the shared
  store makes the opposite look plausible.
- **Nothing prefills from a value we invented.** Every field above comes from
  what a human typed or what a vendor returned. Note that `borrower` on a CPL
  can be seeded by `resolveBorrowers` from the SiteX record owner — that is
  vendor data, not invention, and it is already visibly attributed in the UI via
  `borrowerFrom`.

---

## The decision (2026-09-08)

The question was posed as two options. The answer is a third one, and it costs
nothing:

**Read the existing `cpl_*` refs, and do not filter by `system` at all.**

The objection to reading the existing refs was that they inherit the
underwriter-scoped `system`. They only inherit it *if you filter on it*.
Proposed Insured has no underwriter, so it has no business narrowing by one —
it asks for every `cpl_*` ref on the order and takes the most recent. A CPL
issued on Westcor prefills a PI, and so does the same order re-issued on FNF.

That closes the FNF/Westcor gap without the new `system` value, which means
**no `ALTER TYPE`, no migration, and no transitional double-write** that would
have left two copies to drift.

### What actually carries — six fields, not thirteen

Worth stating plainly, because the mapping table above lists thirteen and
that reads like thirteen new values arriving:

| From `cpl_*` refs (new) | Already derived by PI (unchanged) |
|---|---|
| lender address, city, state, ZIP | property street / city / state / ZIP |
| assignment clause | borrower / vesting |
| loan number | loan amount |
| | lender company |

The other seven were never the bug. PI already reads them from
`order_properties`, `order_parties`, `orders` and `companies`. The bug was the
six above: PI took the lender address and assignment clause from the *company
record* — a default — while ignoring what the operator typed on the CPL for
this specific file, and `loanNumber` was hard-coded `''` with no source at all.

So the rule is precedence, not population: **a stored CPL value beats a derived
one, and an absent one never blanks it.**

#### Loan number has three levels, and the order must not be reversed

```
cpl_loan_number        what the operator typed on the CPL for this file
orders.loan_number     what the SoftPro sync holds for the order
''                     only when we hold neither
```

PI previously showed a blank box even when the order carried a loan number,
which is the same defect as not carrying the CPL across — a value we already
hold, retyped. The CPL value wins because it is deliberate; the sync value is
the better default than nothing. Recorded here because the two look
interchangeable and someone will otherwise flip them.

### Measured before building, 2026-09-08

```
cpl_* refs                        1,172 rows across 148 orders
cpl_lender_address/city/state/zip   146 orders   (since 2026-07-22)
cpl_loan_number                     145 orders   (since 2026-08-31)
cpl_assignment_clause               142 orders   (since 2026-08-31)
cpl_lender_contact                  145 orders   — excluded, no PI field
cpl_branch_id                       148 orders   — excluded, THE TRAP
```

**Orders holding the same `ref_type` under two underwriters: 1 of 148** —
`20021472-GLT`, generated on Westcor at 22:28 and FNF at 22:34 the same
evening. Every value this prefill reads is *identical* across the two. The only
field that differs is `cpl_branch_id`: **2** under Westcor, **20** under FNF —
the trap field, and the one we exclude. Which is the mapping's argument arriving
as data rather than as reasoning.

### Ordering: "most recent first" is a proxy, and here is why

`order_external_refs` has `created_at` and **no `updated_at`**, and the upsert
in `cpl/service.ts` sets only `ref_value` on conflict. So `created_at` is when
a row was *first written*, not when its value was last edited. A Westcor ref
created in July and edited today still sorts behind an FNF ref first created
last week.

Ordering is `created_at DESC, id DESC`, which is the best the table can
currently answer. It only decides anything on an order with refs under two
underwriters — one order, on which every carried value agrees. Adding
`updated_at` would be a migration bought for no observable difference today.
**If that count grows, or the two underwriters start disagreeing on a shared
field, `updated_at` is the fix.**

### Known limitation, recorded rather than designed around

`cpl/service.ts` writes these refs **only after a successful CPL**. A CPL that
failed at the vendor stores nothing, so Proposed Insured opens with the derived
values and none of the operator's typing. Nothing here is malfunctioning —
there is genuinely nothing stored to read. The note is repeated in
`proposed-insured-prefill.ts` at the call site, which is where someone
debugging an empty modal will actually land.

### Adjacent finding, measured but deliberately not fixed here

While confirming where the lender fields come from: `proposed-insured-prefill.ts`
resolves the lender company by **exact string match** on
`companies.name = order_parties.external_company`. Measured 2026-09-08:

```
orders with a named lender party      4,728
  exact companies.name match          3,623   (77%)
  no match                            1,105   (23%)
```

On those 1,105 the modal takes the `else` branch: `companyId` null,
`lookupCode` empty, and every lender address field blank. It looks identical to
"this order has no lender on file", so nobody reports it — the operator just
retypes, which is the same complaint that produced this ticket.

**The CPL prefill does not rescue them.** Of the 1,105, only **5** have a
`cpl_lender_address` to fall back on, because `cpl_*` refs exist on 148 orders
in total and only since July. So this is a separate defect of its own size, and
fixing it means matching on `lookup_code` or a normalised name rather than raw
equality. Not attempted in this change — it would put a fuzzy company match
inside a prefill, which is exactly the kind of quiet wrongness `branchId` is
excluded for. Recorded so it is not rediscovered as "the PIL prefill doesn't
work".

### Guarded in code, not just in prose

`SHARED_CPL_REF_TYPES` is an **allowlist of six**, deliberately not
`ref_type LIKE 'cpl_%'`. A prefix match would carry `cpl_branch_id` and
`cpl_lender_contact` today and anything added to `cpl/service.ts` tomorrow,
silently. Tests assert the branch id is absent from the list, is dropped even
if a row for it is returned, and that no `system` predicate is applied.

`order_external_refs` needed no migration, as anticipated above.
