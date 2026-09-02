# `IsOrganization: true` makes SoftPro drop the party's name

**To:** Aashima
**Date:** 2026-09-03
**Status:** flag turned OFF in the hub pending an answer. Same channel as
`SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS.md` and
`SOFTPRO_PROPERTYDETAILS_ARRAY_DROPS_ADDRESS.md`.

---

## The framing, first — this is not new and it is not the auto-tick

`classifySiteXOwners` shipped 2026-09-01 09:39 and began setting the flag
automatically from SiteX owner names. It is tempting to read this as two days
of damage from that change. **It is not.**

Of the ten production orders that sent `IsOrganization: true` since 31 August,
**eight pre-date that commit.** They are operators ticking the checkbox by hand,
and their names went out still split by the person parser:

```
PRE-fix   Huisje | Nevada Llc | Leuk           buyer[ORG]
PRE-fix   Marchese | Living Trust | Lawrence   buyer[ORG]
PRE-fix   Properties | Llc | Ahava             seller[ORG]
PRE-fix   Innermind | Llc | Deepest            buyer[ORG]
PRE-fix   Antonio | S (co-Tr) | Godoy          seller[ORG]
```

**The flag has been losing names for as long as anyone has used it.** The
auto-tick made it frequent and fed it cleaner input; it did not cause it.

---

## What we see

### Staging, four creates, same entity name, one variable at a time

`PACIFIC HOLDINGS LLC`, `TEST-20002226-OCT` through `TEST-20002229-OCT`, read
back with `GetOrderContacts`:

| # | `PrimaryOwnerFirst/Middle/Last` sent | `IsOrganization` | `Sellers.PrimarySeller` read back |
|---|---|---|---|
| A | `PACIFIC` / `HOLDINGS` / `LLC` | `"true"` | `""` |
| B | `PACIFIC HOLDINGS LLC` / `` / `-` | `"true"` | `""` |
| D | `PACIFIC HOLDINGS LLC` / `` / `-` | `true` (boolean) | `""` |
| **C** | **`PACIFIC HOLDINGS LLC` / `` / `-`** | **`"false"`** | **`"PACIFIC HOLDINGS LLC -"`** |

A and B differ only in name layout and behave identically. D isolates
string-versus-boolean and behaves identically. **C is byte-identical to B except
for the flag, and it is the only one that stored a name.**

### Production, same call, and in two cases the same order

```
20021656-GLT   seller[ORG] "Properties Llc Ahava"          READ  ""
20021674-GLT   seller[ORG] "Antonio S (co-Tr) Godoy"       READ  ""
20021756-GLT   seller[ORG] "Ramon And Judith Trs Resendiz" READ  ""

20021757-GLT   seller NOT org "Walter E Dancsecs"          READ  "Walter E Dancsecs"
20021656-GLT   buyer  NOT org "Jorge O. Espinoza"          READ  "Jorge  O. Espinoza"
```

Person parties come back. Organization parties do not.

### An organization BUYER is worse

The entire contacts block returns `null`, not an empty string:

```
20021650-OCT  buyer[ORG] "Huisje Nevada Llc Leuk"     ->  Sellers null, buyer null
20021670-OCT  buyer[ORG] "Realty Crown"               ->  Sellers null, buyer null
20021672-GLT  buyer[ORG] "Innermind Llc Deepest"      ->  Sellers null, buyer null
20021682-OCT  buyer[ORG] "Marchese Living Trust …"    ->  Sellers null, buyer null
```

---

## What we could NOT determine, and why we are asking

**Whether the name is stored somewhere and simply not returned.**

`GetOrderContacts` gives `Sellers` as two bare strings with no company node,
while `buyer` has both `Person` and `Company` — so an organization seller may
well live in a record this endpoint does not expose.

We retried `GetOrderDetails` on all four staging orders once its indexing lag
cleared. All four return `rows=1`, and **it carries no party fields at all** —
18 keys, every one order-level metadata:

```
OrderNumber, OrderStatus, MarketingSource, OrderType, TransactionType,
MarketingRep, Address, Zip, City, State, Country, TitleOfficer, SalesPrice,
ProductType, ReceivedDate, CompletedDate, ModifiedDate, LoanNumber
```

So it is not the alternative read. **With the endpoints available to us, an
organization party is invisible**, and we cannot tell "stored but not returned"
from "dropped".

We also see no `BuyerSellerType`, no `OrganizationType` and no officer list
returned anywhere — the model the Select DB guide describes (`pfm.Contact.Name`,
`pfm.Principal.BuyerSellerType`) is not reachable through these two endpoints.

---

## The questions

1. **When `IsOrganization` is set on `ordercreation/create`, how are
   `PrimaryOwnerFirstName` / `MiddleName` / `LastName` mapped onto
   `pfm.Contact.Name`?** Should the whole entity name go in one part, and if so
   which?
2. **Which endpoint returns an organization party?** `GetOrderContacts` returns
   an empty seller and a null buyer block for them; `GetOrderDetails` has no
   party fields.
3. **Is the name stored at all**, or discarded at create time?
4. Does an organization create **spurious officer/person records** from the name
   parts? The DB guide notes the first officer added becomes the main contact,
   so a bad mapping could populate the officer list with fragments of a company
   name — we cannot see the officer list to check.

---

## What we changed meanwhile

**The hub no longer sets the flag.** `classify-owners.ts` keeps the
classification (`kind`, `orgType`) and keeps the **unsplit entity name**, which
is the part that genuinely helps — the person parser produced
`Huisje | Nevada Llc | Leuk` from `LEUK HUISJE NEVADA LLC`. Only
`isOrg` is forced false, behind a named constant
(`SET_SOFTPRO_ORGANIZATION_FLAG`) with the evidence beside it.

A visible seller with a slightly wrong name beats an invisible one.

The last name is `'-'` rather than empty, because the payload builder
substitutes `TBD` for an empty last name on a non-organization party and SoftPro
concatenates the parts — measured: `'-'` stores as `"PACIFIC HOLDINGS LLC -"`,
empty would store as `"… TBD"`.

---

## The gap this exposed, recorded deliberately

**We shipped an automatic change to a vendor payload flag with no read-back test
on what the vendor did with it.** The unit tests around `classifyPartyName` were
thorough and all passed — what they could not see is that the field they set
causes SoftPro to drop the name.

That is exactly the class the end-to-end harness exists to catch, and it is why
the harness goes before the pipeline rebuild. See
`docs/tickets/E2E_PIPELINE_TEST_SCOPE.md` §2, "assert outcomes, not absence of
errors" — the assertion that would have caught this is "read the order back from
SoftPro and confirm the seller name is stored".

## Known gap in the classifier, not to be fixed while the flag is off

`TRS` does not match the trust marker (`\bTRUST\b|\bLIVING TR\b|\bFAMILY TR\b`),
so `RESENDIZ RAMON AND JUDITH TRS` classified as a person, was split, and the
operator ticked the box by hand — order `20021756-GLT`. Worth adding to the
marker list **when the flag comes back**, not before: while the flag is off, a
wider marker list only changes which names arrive unsplit, and adding markers
without the read-back test is the same move that produced this ticket.

## Related

- `docs/tickets/SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS.md` — same channel,
  same shape of question.
- `docs/tickets/SOFTPRO_PROPERTYDETAILS_ARRAY_DROPS_ADDRESS.md` — the precedent
  for this kind of ask.

---

## 2026-09-02, Claude — this is now on an issued document, not just in a column

Everything above measures the gap in **stored data**. As of today it is also
measurable on **paper a lender receives**.

Order `7999` / `20019876-OCT`, CPL `documentId 6571`, issued 2026-09-03 01:06 UTC
and attached to the file. The buyer block on the letter face reads, verbatim from
`pdftotext -layout`:

```
"Real Estate Transaction":
Seller:
Buyer:
Giahuy H Tr G H Nguyen -
Living Tr Nguyen
```

The owner of record is a living trust. The person parser split it into first and
last name fragments, and the `'-'` last-name placeholder — the one documented
above as the deliberate substitute for an empty last name — printed on the
letter as a literal hyphen between two halves of the trust's name.

**What changes because of this**

Nothing about the diagnosis, and nothing about the hold. The fix still waits on
Gerard's Select check, and the reasoning in this ticket is unchanged: we do not
touch the flag again without a read-back.

What changes is the **cost of waiting**. Until today the argument for holding was
that the flag's blast radius was bad data in fields PCT reads through the SoftPro
UI, where a human sees the whole name and works around it. That is still true of
SoftPro. It is not true of the CPL — the letter is generated from the same
classified names, rendered without a human in the loop, and sent outside the
company. A wrong name on a closing protection letter is a defect in an
indemnity document, and the addressee is the lender.

So the flag question and the classifier question, which this ticket deliberately
kept together, now have different urgencies:

- **The `IsOrganization` flag** — still held, still correctly held. It only
  affects what SoftPro stores.
- **The classifier splitting an entity into person fragments** — this is what
  reaches the letter, and it does so whether or not the flag is ever set again.
  It does not depend on the Select check to be worth fixing.

That second half is the part to reach for first when the hold lifts, and it is
the reason the `TRS` marker gap recorded above is worth more than it looked.

**Not yet measured:** how many issued CPLs already carry a mangled entity name.
`documentId 6571` was found by reading one letter during a spot-check, not by a
sweep. The population is every CPL whose buyer or seller is a trust or company,
and nobody has counted it.
