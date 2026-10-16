# Placeholders that reach the CPL letter face

Opened after the placeholder hyphen (#93). That defect existed because Westcor
requires `Last` and we filled it with `'-'`. This is the sweep for the *class*
rather than the instance: **every value we send to satisfy a required field, and
whether it can print.**

## The printable surface is small

A Westcor ALTA CPL prints only these, so this is the whole attack surface:

```
Addressee            lender name, then address / city, state zip
Date
Issuing Agent        our own branch block — constant, correct
Buyer / Seller       party names
Property Address
Loan Number
File Number
```

Anything not in that list cannot reach a reader no matter what we put in it.

## Constants in the payload builder — swept, only one ever printed

| Field | Value we send | Prints? |
|---|---|---|
| `Last` (person, no surname) | `'-'` | **YES — fixed in #93.** 65 of 69 letters. |
| `JoiningPhrase` | `'single'`, every party | No |
| `PropertyType` | `'R'`, every order | No |
| `email_requestor` | `'cpl@pct.com'` | No |

`JoiningPhrase` looked like a hit — a case-insensitive scan matched `single` on
70 of 70 letters — but that is the form's own title, *"Closing Protection
Letter–Single Transaction"*. Reading the name block on three letters shows only
names. Ruled out by reading, not by grepping.

So of the constants we control, exactly one ever reached a reader, and it is now
fixed.

## The real finding: nothing stops a placeholder in the DATA

The class is wider than payload constants, and the preflight does not cover it.
It blocks *empty* — it has no opinion about a value that is present and
meaningless. Both of these are on issued letters:

```
#6327   20021658-GLT   Buyer/Seller block:   TBD TBD -
#6294   20021648-GLT   Loan Number: TBD
```

`#6327` matters most, because it corrects an assumption made earlier in this
thread — that the `TBD TBD` seller "doesn't render, so it's harmless". **It
renders.** It printed as a party on an indemnity letter.

Neither value comes from the payload builder. `TBD TBD` is a seller row in
`order_parties` on a `manual_entry` order; the `TBD` loan number was typed into
the CPL modal. Our code passes both through without comment.

### How much of this is loaded and waiting

Party rows whose name is or contains `TBD`:

```
seller           46 orders
buyer            42 orders
lender           22 orders
lender_contact    3 orders
buyer_agent       1 order
listing_agent     1 order
```

The **lender** row is the one to look at. `preflightValidate` blocks a lender
with an empty name and accepts any non-empty string, so a lender named `TBD`
passes and prints as the addressee of an indemnity letter. It has not happened
yet — only two letters in the corpus contain `TBD` at all — but nothing is
stopping it.

## What is NOT proposed here

No repair of any historical order, and specifically not `8141` / `20021658-GLT`,
which is on the do-not-touch list. This is a count and a description.

The obvious fix — treat `TBD` as empty in the preflight — is not obviously
right: an operator who types `TBD` may mean "not known yet, issue anyway". That
is a product decision, not a code one, and it should be made deliberately rather
than inside this ticket.

## The generalisable part

The hyphen was invisible for six months because it lived only in the render. So
does everything on this page. **The check that finds this class is reading the
document, not inspecting the payload** — the payload looked correct in every
case here, including the one that printed `TBD TBD`.

For the E2E harness: an assertion about what a document says has to come from
the document. See
`docs/claude-skills/claude-skills/watch-outs/writing-from-the-shape-of-the-problem.md`.

## Related

- #93 — the placeholder hyphen, fixed and merged.
- `docs/tickets/CPL_PERSON_NAME_PLACEHOLDER_HYPHEN.md`
