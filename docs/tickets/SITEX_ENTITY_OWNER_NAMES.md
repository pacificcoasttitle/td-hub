# SiteX entity owner names are parsed as people

**Status:** open, not implemented. Raised out of the owner-name parity work
(`fix/softpro-create-parity`) and deliberately kept out of it.

**Why it is separate:** the comma rule in `sitex-owner-names.ts` fixes how a
surname is read. This is a different question — whether the string is a person at
all — and the honest fix needs a classifier and an answer from SoftPro. Folding a
guess into the name rule would have made both harder to review.

## The damage

Trusts, LLCs and corporations are routine vesting on a title order, not an edge
case. Measured against all 5,384 stored `order_properties.primary_owner` values:

| Population | Rows | Share |
| --- | --- | --- |
| Owner strings total | 5,384 | 100% |
| Match a corporate/trust suffix | 965 | 17.9% |
| ...of those, contain `&` or `;` and are split into **two** fabricated people | 47 | 0.9% |
| ...of those, become **one** fabricated person | 918 | 17.1% |
| Truncated by SiteX at 40 chars (trailing comma) | 661 | 12.3% |

The suffix list used for the count is deliberately tight (`INC LLC LLP LTD CORP
CORPORATION TRUST REVOCABLE PROPERTIES HOLDINGS INVESTMENTS PARTNERSHIP
FOUNDATION CHURCH ENTERPRISES VENTURES`). A looser list that also counts bare
`TR` and `CO` returns 1,205 rows, but `TR` is usually a trustee on a person's
name, so 965 is the defensible floor rather than the ceiling.

## What the parser produces today

Real strings from production, run through `parseSiteXOwners` as it stands after
the comma rule (first / middle / last):

| Raw SiteX value | Primary | Secondary |
| --- | --- | --- |
| `GUTIERREZ FAMILY TRUST,` | Family / Trust / Gutierrez | — |
| `FIGURE LENDING LLC,` | Lending / Llc / Figure | — |
| `6607 DE LONGPRE LLC` | De / Longpre Llc / 6607 | — |
| `THE BADGLEY SECRET STASH TRUST,` | Badgley / Secret Stash Trust / The | — |
| `WCH 2560 MAIDEN LN LLC,` | 2560 / Maiden Ln Llc / Wch | — |
| `B & A GROUP INC,` | (none) / — / B | Group / Inc / A |
| `FIDELITY MANAGEMENT & CONSTRUCTION INC,` | Management / — / Fidelity | Inc / — / Construction |
| `DAMON & YU LLC,` | (none) / — / Damon | Llc / — / Yu |
| `E&T TRUST,` | (none) / — / E | Trust / — / T |

These reach SoftPro as `PrimaryBorrower*` / `PrimaryOwner*` person names. A
person whose surname is `6607`, and a second owner named `Group Inc` who does not
exist, are both written to the order and neither is flagged.

## Why it happens

Three independent causes, all in the SiteX owner path:

1. `splitOwners` splits on the first `&` unconditionally. In an entity name the
   ampersand is part of the name, not a separator between owners.
2. The positional flip then applies to each half, so the last word of a company
   name becomes a given name and the first word becomes a surname.
3. `isOrganization` / `organizationType` exist on the create input and are sent
   to SoftPro as `IsOrganization` / `OrganizationType`, but `fillOwners` never
   sets them — they come only from a checkbox the operator ticks. So a SiteX
   entity lands in person fields with `IsOrganization: false` unless the operator
   notices and intervenes.

The plumbing to SoftPro therefore already exists. What is missing is detection,
and a decision about which field carries the entity's name.

## Proposed approach

**Step 1 — ask the data before writing a classifier.** SiteX raw responses are
logged (`vendor_api_logs` where `vendor = 'sitex'` and
`operation = 'property_lookup'`). Check whether the raw profile carries an
owner-type, vesting or entity indicator. A vendor flag beats any suffix list we
write, and this is an hour of reading, not a build. Do this first.

**Step 2 — stop the fabrication without claiming to classify.** If there is no
vendor flag, match a corporate/trust suffix and then *stop transforming*: no `&`
split, no flip, no comma inference. Put the cleaned string in `lastName`, leave
first and middle empty, and raise a warning so the operator sees it and can tick
the Organization box themselves. This needs no answer from SoftPro, invents no
people, and moves the decision to the human instead of the parser. It is the
recommended shipping fix.

**Step 3 — route to the organization fields properly.** Only once someone has
confirmed, against a real create, which SoftPro field carries an organization
name when `IsOrganization` is true. That contract is not documented anywhere in
this repo today, and guessing it would produce another accepted-and-discarded
write. Blocked until confirmed.

## Open questions that are not ours to answer

- **Truncation.** 661 owner strings are cut at 40 characters, so the legal entity
  name we hold is frequently incomplete (`WCH 2560 MAIDEN LN LLC,`). Whether a
  truncated entity name is acceptable on a title order is a business decision. If
  it is not, the fix is a second SiteX call for the full vesting, not string work.
- **Trustees.** `SMITH JOHN TR` is a person acting as trustee. Any suffix list has
  to leave those as people, which is why bare `TR` is excluded from the count
  above. Confirm with title staff before extending the list.

## Guardrail already in place

`production-regressions.test.ts` pins the current entity behaviour
(`B & A GROUP INC,` → two people) so that whoever takes this ticket has to change
a test on purpose, and so the comma rule cannot quietly start reading a
truncation comma as a surname delimiter.
