# SoftPro accepts fields it cannot resolve, returns success, and drops them

**To:** Aashima
**Date:** 2026-09-03
**Status:** every instance below is proven on staging `:8081` with a named
order number, or read back from production. Nothing here is inferred.

## The pattern, and why it is one report rather than five

Individually each of these looks like a mapping mistake on our side. Together
they are one behaviour: **the API accepts a value it cannot resolve, returns
`200` with a success message, and silently discards or substitutes the field.**

That is the part we are asking about. A rejection costs us one failed request
and we fix the payload in an hour. An acceptance-and-drop costs us months,
because there is nothing to alert on — the order exists, the response said
success, and the missing field is only discovered when a human opens the file
or a downstream call fails for an unrelated-looking reason.

**The count is the argument.** Five distinct fields, five different endpoints
or field groups, same shape.

## The instances

### 1. `propertyDetails` as an array — the whole property is discarded

Matched pair, staging, minutes apart, only the JSON type changed:

| | Array → `TEST-20002223-OCT` | Object → `TEST-20002224-OCT` |
|---|---|---|
| HTTP / Status | 200 / Order created successfully | 200 / Order created successfully |
| TitleOfficer | Clive Virata | Clive Virata |
| Address / City / State / Zip / Country | all `""` | stored exactly as sent |

Full detail in `SOFTPRO_PROPERTYDETAILS_ARRAY_DROPS_ADDRESS.md`. In production
the same array shape bound on some requests and not others, and
`20021638-OCT` flipped from empty to stored inside a 14-minute window.

### 2. Escrow officer, address-book code in the user namespace — field vanishes

`LookUpCodeEscrowOfficer` is matched against SoftPro's internal user directory
(the `PCT\user` namespace), not the address book. Sending an address-book code
is **not rejected**:

- `TEST-20002217-OCT` — sent `AnnBalPaci`. Order created, success returned,
  `EscrowCompanies` null and **no `EscrowOfficer` key at all**.

So every Title & Escrow order created that way lost its escrow officer without
saying so. This is the newest instance, found 2026-09-03 while building the
"Request Updated Prelim" staging probe.

### 3. Escrow officer code with an empty name — reassigned to your service account

**This is silent substitution, not silent omission, and it is the hardest of
the five to explain as validation.**

- `TEST-20002219-OCT` — sent no officer code with an empty
  `EscrowOfficerName`. Came back **assigned to the API service account
  `PCT\rsupport`**.

The field did not fail to resolve and get left empty. It was *filled in with a
different value* — your own integration account — and success was returned. So
there is nothing for us to detect: the order has an escrow officer, the
response said success, and the officer is a robot. Every other instance in this
report leaves a hole, which at least a human can spot on the file. This one
leaves a plausible-looking wrong answer.

Read instances 3 and 4 together. Same field, same request, differing only in
`''` versus `null`, producing two *different* wrong outcomes and no error
either time.

### 4. Escrow officer null name — no officer at all

- `TEST-20002220-OCT` — identical to the above but with a null name. Came back
  with **no escrow officer**.

Instances 3 and 4 differ only in `''` versus `null` on one field and produce
two different wrong outcomes, neither of them an error.

### 5. `AddDocuments` into a missing folder — attach skipped, success returned

If the staging folder does not exist the adapter skips the entire attach block
and still returns `Success` with `FileUploadedStatus = true`. Nothing is
attached and nothing says so. This is why we now follow every upload with a
listing read instead of trusting the write response.

### Adjacent, and deliberately not counted as a sixth

`GetAttachedDocuments` returns `[]` for Production Documents subfolders while
the files are genuinely on the file — `20021642-OCT` confirmed on screen. That
is read-side blindness rather than an accepted-and-dropped write, so we are
keeping it separate rather than padding the count. Detail in
`SOFTPRO_GETATTACHED_MISSES_PRODUCTION_FOLDERS.md`.

### Open, not yet proven

`AddNotes` has no documented `Subject` field, and the legacy PCT integration
had it commented out. We do not know whether sending it is rejected, accepted
and honoured, or accepted and dropped. A staging probe is written and will
answer it (`scripts/audit/update-prelim-staging-order-probe.ts --send-subject`).
**If it turns out to be accepted and dropped, that is instance six**, and we
will send the order number.

## What we need

1. For each of the five: is the drop intentional validation behaviour, or a
   binding failure that should have been an error?
2. Whether the API can be made to **reject** an unresolvable value rather than
   accept it. One 400 is worth more to us than a hundred successes that are
   missing a field.
3. Whether other integrations are losing these same fields right now and
   getting a success message for it. We only found ours by reading orders back
   one at a time.

## What we have changed on our side

Not waiting on any of the above.

- `propertyDetails` is sent as an object.
- `resolveEscrowOfficerLookup` returns null unless the code is in the
  `PCT\` user namespace, so a wrong-namespace code is never sent. An order
  missing a field is fixable; one silently filed under a wrong code is not.
- Every document write is followed by a listing read, and "write-accepted" and
  "listing-confirmed" are stored as two different states rather than one.
