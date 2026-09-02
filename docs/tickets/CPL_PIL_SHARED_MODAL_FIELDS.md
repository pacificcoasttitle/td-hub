# CPL and Proposed Insured — the field overlap

**Status: MAPPING, for approval. Nothing built.**
Opened: 2026-09-03

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

## One open question for you

**Should the shared store be keyed under a new non-underwriter `system` value,
or should the existing `cpl_*` refs be read directly by Proposed Insured?**

- **New shared key** (e.g. `system: 'hub'`, `ref_type: 'shared_lender_address'`)
  is cleaner and survives an underwriter switch, but leaves the seven existing
  `cpl_*` refs as a second, older copy that will drift.
- **Read the existing `cpl_*` refs** is smaller and works today, but inherits the
  underwriter-scoped `system` — so a CPL issued on Westcor prefills a PIL, and
  the same order re-issued on FNF does not.

I would take the new shared key and have the CPL modal write **both** during a
transition, but it is a schema-shaped decision and the migration convention says
flag it before applying anything.

`order_external_refs` needs no migration either way — it is already
`(order_id, system, ref_type, ref_value)` with the right unique constraint.
Only the `system` enum would need a new value, and **that is an `ALTER TYPE`**,
which is exactly the kind of change this project applies by hand ahead of the
code.
