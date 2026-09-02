# The CPL printed a placeholder hyphen after every person's name

**Fixed in #93.** Six months of issued letters carry it.

## What it looked like

The CPL form prints `First` then `Last`. We put the whole name in `First` and a
literal `'-'` in `Last` for every person, so the letter face read:

```
#3     2026-03-26   GERARDO HERNANDEZ -
#6401  2026-09-02   Stephen Davis -
```

**65 of the 69** Westcor letters issued between 2026-03-26 and 2026-09-03.

It survived because it is invisible in the data. `First` holds the whole name
and reads correctly in every query, every log line and every test fixture. The
defect exists only in the rendered PDF.

## What Westcor actually requires

Measured against production `Order/Update` before changing anything — one buyer,
four shapes, on `20015761-GLT`:

| `Last` sent | Result |
|---|---|
| `"-"` | 200, accepted |
| `""` | 200, **rejected** — "Buyer #1: Not Added. Please provide at least a Company Name and/or First and Last Name of the individual." |
| `" "` | same rejection; Westcor trims it and stores `""` |
| `"HERNANDEZ"` | 200, accepted, `First` `"GERARDO J"` |

The field cannot be blanked or spaced. Splitting at the last space is the only
shape that passes validation and prints correctly. One-word names keep the
placeholder — there is no last name to give, and rejecting the CPL is worse.

## Entities do not take this path — checked, closed

The concern raised in review was that splitting at the last space would tell
Westcor an entity's surname is `LLC`. It does not: `nameFields` routes trusts and
companies to `CompanyName` with `First` and `Last` both empty, and only the
person branch splits.

```
RADIANT SUNSHINE INVESTMENT GROUP LLC   First=""  Last=""  Company="RADIANT SUNSHINE INVESTMENT GROUP LLC"
LORNA CURTIS LIVING TRUST               First=""  Last=""  Company="LORNA CURTIS LIVING TRUST"
Deus Gratia, a California Corporation    First=""  Last=""  Company="Deus Gratia, a California Corporation"
GERARDO J HERNANDEZ                     First="GERARDO J"  Last="HERNANDEZ"  Company=""
```

Confirmed against the corpus as well as the classifier: across 70 issued letters,
**no** entity-marked name carried a trailing hyphen, which is what a name taking
the person path looks like on the page. Every one took the `CompanyName` route.

There is also no last-name-first field to worry about. A Westcor name object is
`NameID, Last, First, NameType, JoiningPhrase, tvid, Sequence, generation,
Middle, CompanyName, Trust, Country, City, State, Zip, Address, Additional_Id,
vendorInternalID` — no display name, no sort name.

**The residual**, which belongs to the classifier ticket and not here: an entity
the classifier *misses* now gets a fabricated surname instead of `'-'`. Neither
shows on the letter face. Nothing in the current corpus hits it.

## We wrote to a production Westcor record to learn this

There is no Westcor staging environment — `WESTCOR_URL` has one value and it is
`services.ewestcor.com`. The only way to learn what `Last` accepts was to ask
Westcor, so **order 51 / `20015761-GLT` had its Westcor state written today**,
twice: the four-shape probe (Step A only, `update_buyers` alone, no letter), and
then one full letter run, `documentId 6603`.

`20015761-GLT` is Gerard's March manual test file and also Aashima's reference
file. Its Westcor record changed on 2026-09-03. That is the cost of the
measurement and it should be visible to anyone who looks at that file later.

**Read back afterwards rather than assumed** — `GET VendorApi/Order/3719941`:

```
buyers: 2
  {"NameID":8476174,"Last":"MENDOZA","First":"YESSICA S","Sequence":1,...}
  {"NameID":8476175,"Last":"HERNANDEZ","First":"GERARDO J","Sequence":2,...}
sellers: 0
```

Both buyers present, both correctly split. The first draft of this said the
letter run "put both buyers back from our DB, so it's whole" — that was an
inference from what was sent, not a read. It happened to be right, which is not
the same as having checked.

`sellers: 0` is **not** new. Every `create_order` on this file since March sent
`sellers=1` (`TBD TBD`) and the March letters show the same empty Seller block,
so Westcor has never stored a seller here. Recorded because it was seen, not
because it is being chased.

## Related

- `docs/tickets/SOFTPRO_ORGANIZATION_FLAG_DROPS_THE_NAME.md` — the classifier
  half, held pending the Select check.
- `docs/claude-skills/claude-skills/watch-outs/writing-from-the-shape-of-the-problem.md`
  — the rule this came out of: a claim about what a letter says has to come from
  reading one.
