# Which modal Add New opens is decided by a string match nobody was watching

---

## Resolved 2026-09-09

`WIZARD_TYPES` and `toPersonType` are gone, replaced by one function,
`wizardPersonType(typeFilter, scope)`, with every case written out and a
**default that throws**.

```
lender / mortgage_broker / escrow / realtor+agent+real_estate_agent  -> mapped
escrow_officer, scope external  -> 'escrow'      (Aileen's page)
escrow_officer, scope internal  -> null          (no Add New)
title_officer, sales_rep        -> null          (no Add New)
anything else                   -> throws
```

**Add New now renders only when the page can actually create.** Internal escrow
officers and title officers lose the button.

### Removing those buttons takes nothing away

They already failed on every attempt. `escrow_officer` and `title_officer` are
not `CreatePersonUserType`s, so `POST /api/contacts` returned
**400 "Contact type cannot be created through SoftPro"** every time. The button
was a false affordance.

Both rosters are **maintained in SoftPro and synced down** — 728 of 730 escrow
officers and all 8 title officers carry `source_system = 'softpro'`, and the
internal ones are branch units rather than people (`aayala@pct.com` with the
lookup code `OCT`, mostly without names). **The Sync from SoftPro button already
on those pages is the real path**, and it stays.

### The correction that got us here

An earlier draft of this ticket said the flat form "succeeds at the vendor and
loses the identity that comes home", using contact #23063 (Joseph Gomez) as the
case. **That was wrong, and it survived two rounds of confirming evidence.**

What actually settled it was a field that had been sitting on the row the whole
time:

```
source_system  "manual"           createContactInSoftPro writes 'softpro'
full_name      "Gomez, Joseph"    the `${last}, ${first}` shape built by the PUT route
create_user calls in the window   Tseng, Rodriguez, Contreras, Chen — no Gomez
```

He was an existing local row that was **edited**, not created. The form could
never have created him: it 400s for that type. He had been in SoftPro all along
under `JosGomEscr`, on page 8 of a table our sync has never read past page 4.

So there is no orphaning path through this form, and the fix built here is the
simpler true one: **Aileen could not add an external escrow officer at all.**

The Company box on the flat form is still free text with no lookup code, which
matters only for the pages that keep that form — edit-only now. Noted, smaller,
separate.
