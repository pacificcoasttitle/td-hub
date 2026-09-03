# SoftPro — two defects in contact creation and order creation

**For: Aashima. Fourth report.**
**Date: 2026-09-03. Environment: production, `100.29.181.61:3000`.**

Two separate defects, found together. The first is the one blocking us. The
second is the one we would ask you to look at harder, because it has no
workaround on our side.

---

## Defect 1 — the contact endpoint accepts a lookup code the order endpoint refuses

`CreateUser` accepts an 11-character `ClientLookupCode` and creates the record.
Order creation then rejects that same string. The result is a contact held in
SoftPro under a code SoftPro's own order creation will not take.

**The record**

```
Name          Juan Lestre
Company       Keller Williams Studio City
UserType      ListingAgentBroker
LookupCode    JuaLesKell1        (11 characters)
```

**Accepted by `CreateUser`**

```
2026-09-03 00:27:24   POST .../CreateUser
  ClientLookupCode  : "JuaLesKell1"
  CompanyLookupCode : "Kelle4061"
  → HTTP 200  {"Status":200,"Message":"User added"}
```

**Refused by order creation, twice, with the same value**

```
2026-09-03 00:34:07   POST /api/ordercreation/create
2026-09-03 02:21:19   POST /api/ordercreation/create
  payload.personalDetails.ClientLookupCode = "JuaLesKell1"
  → HTTP 400
    {"Status":400,
     "Message":"Value must be no longer than 10 characters.\r\n\n
                Value must be no longer than 10 characters.\r\n"}
```

`ClientLookupCode` is the only value in that payload longer than ten
characters. Every other field over ten — `City`, `Email`, `Address`,
`CompanyName`, the legal description, the APN — is accepted routinely.

**What we would like**

Either endpoint may be the correct one; we only need them to agree.

1. Should `CreateUser` enforce the same ten-character limit?
2. For contacts already stored with an over-length code — we hold **154** —
   what is the supported way to make them usable in an order? Is there a way to
   change a contact's lookup code through the API, or does it require your side?

**Two notes on the message itself.** It names no field, which is why our
operators spent the morning looking at a different section of the form. And it
appears twice in one response for a single offending value.

---

## Defect 2 — a failed `CreateUser` still allocates the lookup code

This is the one that produced the bad code in the first place, and we cannot
work around it.

```
00:24:45   CreateUser  ClientLookupCode "JuaLesKell"
           → 400  {"Message":"Phone is required"}

00:27:03   CreateUser  ClientLookupCode "JuaLesKell"
           → 400  {"Message":"Phone is required"}

00:27:20   CreateUser  ClientLookupCode "JuaLesKell"
           → 400  {"Message":"Cannot insert duplicate key row in object
                   'dbo.lkup_36A3EB6B_E666_DC11_918A_00300529E9E8' with unique
                   index 'IX_lkup_36A3EB6B_E666_DC11_918A_00300529E9E8_KEY'.
                   The duplicate key value is (JuaLesKell)."}

00:27:24   CreateUser  ClientLookupCode "JuaLesKell1"
           → 200  "User added"
```

The first two calls **failed validation** — `Phone is required` — and returned
400. The third call, with the same code, was rejected because `JuaLesKell` was
**already present in the lookup table**.

No contact existed under `JuaLesKell` at that time. It appeared on our side at
07:15, seven hours later, through a routine sync. The most consistent reading
of the sequence is that a `CreateUser` returning 400 for a missing phone had
already inserted the lookup row.

If that is right, then **every validation failure on `CreateUser` burns the
lookup code it was called with.** The caller cannot reuse it, and the only
escape is a different code — which is how a correct 10-character code became an
11-character one that order creation then refused.

**What we would like**

1. Does a 400 from `CreateUser` roll back the lookup-table insert?
2. If not, is there a way to release an allocated code, or to detect that a code
   is allocated but has no contact behind it?

---

## Why this reached an operator

One order, 2026-09-03. Both create attempts returned 400 before any record was
written, so **the file exists in neither system** — not partially created,
absent. It has to be re-entered by hand.

It can be opened immediately by entering it without the listing agent and
adding Juan Lestre afterwards, since the payload then carries no
`ClientLookupCode` to reject. A straight re-entry hits the identical wall.

## What we have changed on our side

Our generator now keeps the collision digit inside ten characters rather than
appending past the limit, so we will not mint another one. That does nothing
for the 154 already stored, or for Defect 2, which is why we are asking.

## Scope, measured

```
create_order failures carrying this message   2   (both this order)
distinct contacts implicated                  1
last 30 days                                  105 creates, 20 failed,
                                              2 of those on this rule
contacts holding an over-length lookup code   154
```

This is not yet widespread. It becomes widespread the first time an order names
any of the other 153.
