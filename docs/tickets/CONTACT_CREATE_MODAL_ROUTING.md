# Which modal Add New opens is decided by a string match nobody was watching

Aileen reported she could not add an escrow officer: the Add Contact form has a
free-text **Company** box with no search, she typed "Escrow O" expecting it to
find Escrow Options, and nothing populated.

## The near miss

`ContactListPage` chooses between two different modals on one line:

```ts
const WIZARD_TYPES = new Set(['escrow','lender','mortgage_broker','realtor','agent','real_estate_agent']);

{!readOnly && editContact                              && <ContactFormModal contact={editContact} />}
{!readOnly && !editContact &&  WIZARD_TYPES.has(typeFilter) && <CreatePartyWizard ... />}
{!readOnly && !editContact && !WIZARD_TYPES.has(typeFilter) && <ContactFormModal contact={null} />}
```

The escrow officers page passes `typeFilter="escrow_officer"`. The set contains
`escrow`. **Six characters, and the page silently falls through to the older
flat form.**

Which page gets which:

```
lender-contacts            lender             in set     -> wizard
mortgage-broker-contacts   mortgage_broker    in set     -> wizard
real-estate-agents         real_estate_agent  in set     -> wizard
escrow-officers            escrow_officer     NOT in set -> flat form
external-escrow-officers   escrow_officer     NOT in set -> flat form
title-officers             title_officer      NOT in set -> flat form
```

Same shape as `ZIP` vs `Zip` in the SiteX Location object and `HasMore` read at
the top level instead of inside `Pagination`: a name that is almost right, no
error anywhere, and behaviour that looks deliberate.

**"Add New comes free on ContactListPage" was stated twice during the lender
page design and is wrong.** What comes free is *a* modal. Which one depends on
whether the page's type string happens to be in that set.

## Why the flat form cannot work

`ContactFormModal` posts its form verbatim: `companyName` as typed text, and no
`companyLookupCode` at all. `createContactInSoftPro` then does

```ts
.where(eq(companies.lookupCode, companyLookupCode))   // ''
if (!company?.lookupCode) return { ok: false, code: 'COMPANY_NOT_FOUND' };
```

The code even says so: *"SoftPro CompanyLookupCode. Required. A typed company
name is not a substitute."* The form was built without it.

## DO NOT FIX THIS BY ADDING TWO STRINGS TO THE SET

`toPersonType` falls through to `realtor` for anything it does not recognise:

```ts
function toPersonType(typeFilter: string): CreatePersonUserType {
  if (typeFilter === 'escrow') return 'escrow';
  if (typeFilter === 'lender') return 'lender';
  if (typeFilter === 'mortgage_broker') return 'mortgage_broker';
  return 'realtor';                      // <- everything else
}
```

Adding `escrow_officer` and `title_officer` to `WIZARD_TYPES` without extending
this would route them to the wizard and then **create them in SoftPro as
realtors** — silently, and looking correct. The mapping must be explicit for
every member of the set before the set grows.

`title_officer` has no `CreatePersonUserType` at all, so that one is a product
question rather than a mapping: `CREATE_PERSON_USER_TYPES` is
`escrow | lender | mortgage_broker | realtor`.

## The edit branch is unguarded

The first of the three lines has no `WIZARD_TYPES` check, so **editing** a
contact opens the flat form on every page, including the two shipped on
2026-09-09. It is safer than the create path — edits PUT to
`/api/contacts/[id]`, which pushes `updateUser` using the row's existing
`softproLookupCode` — but the operator sees a free-text Company box that behaves
nothing like the searchable one in the wizard, on the same records.

Noted, not fixed.

## Scale: this is a footnote, not the story

It orphans a contact every time it is used, and that is worth fixing. It is
**not** the source of the orphaned-contact population:

```
month     created  orphaned
2026-03     19220      2051
2026-04       135         1
2026-05        91         1
2026-06        62         0
2026-07        68         1
2026-08        46         0
2026-09        19         2
```

**2,051 of 2,056 orphans are from the 2026-03-12 import.** This form has
produced about five in six months. An earlier draft of this finding was
sharpened into "we have found the live source of the bad data", which the
numbers do not support — five records in six months does not explain two
thousand. Recorded because the inflation happened twice in one evening, in both
directions, before anyone counted.

## Known live record

`#23063 Joseph Gomez, joseph.gomez@escrowoptions.com`, created 2026-09-09 with
no company name, no `flookup_code` and no `softpro_lookup_code`. Two
`create_user` calls returned `"User added"` in the same window, so SoftPro may
hold him under a code we never stored.

## Related

- `docs/tickets/NAMELESS_CONTACTS_ARE_COMPANIES.md` — the March population
- `docs/tickets/DUPLICATE_CONTACTS.md` — same import
