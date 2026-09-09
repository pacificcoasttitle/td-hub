# Editing a contact erases the address SoftPro holds

**Blocked at the route on 2026-09-09 before any damage. Nothing was destroyed —
there is no `update_user` call in the log, all time.**

## What happens

`PUT /api/contacts/[id]` built its SoftPro payload from the **request body**:

```ts
Address1: data.address ?? '',
City:     data.city    ?? '',
State:    data.state   ?? '',
Zip:      data.zip     ?? '',
```

And the edit form's record type has no address and no zip **at all**:

```ts
interface ContactRecord {
  id, firstName, lastName, email, phone, cell,
  companyName, city, state, licenseNo, contactType, isActive
}
```

Not empty — absent. So `data.address` is `undefined` on every request, `?? ''`
turns it into an empty string, and `UpdateUser` overwrites whatever SoftPro
holds with nothing.

This is not limited to contacts whose local address is missing. **The form
cannot send an address even when we hold one.**

## Evidenced, not predicted

Contact #12058, read from SoftPro's own lookup table:

```
Address1 "3700 Campus Drive #107"   City "Newport Beach"   State "CA"   Zip "92660"
```

Our row for the same person holds none of it. The payload built from our row
sent four empty strings. It was only refused because the local environment
lacks `SOFTPRO_USER_ID`, so the call failed closed.

## Size

```
contacts an edit would push to SoftPro : 16297
   Address1 sent as ""  — ALL 16297
   Zip      sent as ""  — ALL 16297
   City  also blanked where our row is empty :  137
   State also blanked where our row is empty :  133
```

## Why it became urgent today

The edit control was `opacity-0 group-hover:opacity-100` — a pencil that
appeared only on hover. It was made visible on 2026-09-09 so operators could
find it, which was right on its own terms and **turned a latent
data-destruction path into a one-click one**. Making something discoverable
changes its blast radius, and that was not checked before exposing it.

## What is blocked, and what still works

An edit that would push to SoftPro returns **503** with a message naming this
ticket. Internal types — `title_officer`, `escrow_officer`, `sales_rep` — never
pushed, so those edits are untouched and still work.

## The fix

**Read-modify-write.** Fetch SoftPro's current record for the contact's
`ClientLookupCode`, merge the changed fields into it, send everything else back
byte-for-byte. Never construct an update from our row alone — our row is a
partial copy and always has been.

One open problem to solve first: locating a record costs **~67s per page** over
up to 16 pages, so a read-modify-write on the request path could take minutes.
Options are a per-record SoftPro endpoint if one exists, or a cached snapshot
refreshed by the sync. Not decided.

## The general form

Our copy of a vendor record is a **subset**, not a mirror. Any write built from
it deletes whatever we never stored. The rule this belongs to: **ask what the
mechanism reads, not what the change looks like.** The change looked like
"update a phone number"; the mechanism reads the whole record and writes the
whole record back.

---

## Fixed 2026-09-10: merge with the stored row

**Legacy's design, confirmed by asking them:** full payload every time, gaps
filled from their own stored row, never a diff and never a vendor read.

```ts
Address1: data.address ?? existing.address1 ?? '',
City:     data.city    ?? existing.city     ?? '',
State:    data.state   ?? existing.state    ?? '',
Zip:      data.zip     ?? existing.zip      ?? '',
```

`existing` is already fetched a few lines above for the existence check, so the
merge costs nothing. **The defect was treating a partial form as a complete
record**; SoftPro's `UpdateUser` replaces the whole contact, so anything the
form cannot send has to come from the row we hold.

**And the form now has the fields it was missing.** `address` and `zip` were
absent from `ContactRecord` entirely, and `city`/`state` were optional.
All four are now present, **required**, and prefilled from the stored row —
which is exactly why legacy never hit this: their edit screen required them, so
no contact could be saved without them.

`Contact` in the list page also gained `address1` and `zip`. The API had been
returning whole contact rows all along; they were simply never declared, which
is why there was no address to prefill.

## Closed by avoidance, not answered: does omitting a field preserve it?

Whether SoftPro's `UpdateUser` preserves a field that is omitted, or blanks it,
is **unknown and will stay unknown**. Legacy cannot answer it — they always sent
every field — and the vendor has not been asked.

It no longer matters. With the stored-row merge, the required form fields, and
the backfill of the remaining contacts, **an empty address is never sent**.

Recorded so nobody reopens this hunting for a vendor reply that is not coming.
The question is not answered; it is unreachable.

## Remaining: contacts where we hold nothing either

```
contacts an edit would push : 16297
   we hold address1         : 15620
   we hold zip              : 15952
   NEITHER                  :   120
```

120 rows, 0.7%. Being backfilled from SoftPro's own data as a one-time write —
see the dry run in that work. Until it lands they fall to `?? ''`, which is why
the backfill is part of closing this and not a separate nicety.
