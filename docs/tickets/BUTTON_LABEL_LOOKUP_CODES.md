# Six contacts whose SoftPro ID is a button label

**Status:** source identified as outside our code; edits blocked; the six not repaired
**Raised:** 2026-09-10

## What

Six live contacts carry a UI button's text in `softpro_lookup_code`:

| id | code | name | email | orders |
|---|---|---|---|---|
| 22423 | `New` | Judith Beserra | judy@89investments.com | **125** |
| 22426 | `upd` | Gabriel Arambula | gabe@kasere.com | 2 |
| 22651 | `NEW` | Christian Ramos | Cramos.notify@gmail.com | 6 |
| 22653 | `new` | Sean Waller | sean@easystreetcap.com | 3 |
| 22655 | `UPD` | Jose Perez | jperez.nuevare@gmail.com | 1 |
| 22656 | `Add` | Angela Del Valle | Angeladelvalle@thedelvallegroup.info | 4 |

Real people, real emails, and **Judith Beserra is a party on 125 orders** — this
is not a set of stray rows.

## What wrote them — not us

Three independent facts put the write outside our code:

1. **`source_system = 'softpro'` and `source_id` equals the same word** on all
   six. That is the read sync's signature: it copies SoftPro's `LookupCode`
   verbatim into `softpro_lookup_code`, `lookup_code` and `source_id`.
2. **Our first `create_user` call was 2026-09-01.** The six were created
   2026-06-13 to 2026-07-12. We had no contact-create path against SoftPro
   during the window.
3. **No SoftPro write operation of any kind ran in June or July** other than
   `upload_document`, `add_notes` and `create_order`. `enrich_order_contacts` is
   a read.

So somebody typed a button's label into SoftPro Select's own Lookup Code field,
six times, and our sync faithfully copied it. The defect is in SoftPro's data
entry, not in the hub.

## Is it still happening — no

Short lookup codes on person contacts, by month of creation:

```
2026-06   15 created,  4 short
2026-07   48 created,  4 short
2026-08   45 created,  0 short
2026-09   18 created,  0 short
```

The last one was **2026-07-12**. Every person contact created since carries a
normal generated code (`MicCheCent1`, `LuzConSafe`, `EloRodRidg`). The window
opened on 13 June and closed on 12 July; it has been shut for two months.

Two of the four "short" codes in each month are initials rather than button
words — `AU` (Amit Urban), `HN` (Hien Nguyen) — which look like human
shorthand and are a separate, milder thing.

**This is why the six were not repaired first.** The instruction was right: a
fix that leaves the source running just makes more. The source is a person in
another system and it stopped on its own.

## Why they are not safe to edit

None of the six codes exist in SoftPro today — an 18,705-row scan across all
three person feeds has no match for `New`, `NEW`, `new`, `Add`, `UPD` or `upd`.
An `UpdateUser` keyed on one of them would at best fail, and at worst act on
whatever record has since taken that name.

Two of the six have a *proper* SoftPro record for the same person, found by
email:

- Jose Perez → `JosPerEXPR`, `JosPerNuev`
- Gabriel Arambula → `GabAraBrok`

So for at least those two, our row is a stale duplicate pointing at a code
SoftPro no longer has, while the real record sits under a correct one.

**Blocked in the meantime.** `PUT /api/contacts/[id]` refuses with 409 and an
explanation when the stored code is a button word. Cheap, reversible, and the
operator gets a reason instead of a silent 502.

## What repair would need

Not started, and it needs a decision rather than a script:

1. For each of the six, find the real SoftPro record — by email first, then by
   name and company. Two are already identified above.
2. Decide **merge or re-point**. Judith Beserra's row is on 125 orders, so
   deleting it is not an option; the code has to be corrected in place, or the
   orders re-pointed at the correct contact. That is the same question the
   duplicate work raised, on a much smaller population.
3. For any of the six with no SoftPro record at all, decide whether they should
   be created there or marked local-only.

None of this should run before somebody confirms the six correct codes by hand.
Six rows is small enough to do by eye and too consequential to guess.

## Related

- `NAMELESS_CONTACTS_ARE_COMPANIES.md`
- `CONTACT_EDIT_BLANKS_SOFTPRO_ADDRESS.md` — the edit path this guard sits in
