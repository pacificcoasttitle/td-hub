# Writing from the shape of the problem instead of the source

Twice in one evening, an hour apart, I produced a confident, well-argued,
wrong claim by reasoning from what the problem *looked like* rather than from
the document that settled it. Both times the source was available. Neither time
had I read it.

## The two instances

### 1. `Trust` satisfies Westcor's identity requirement

I moved trust names out of `First` (where they rendered as a person with the
surname `-`) into the `Trust` field, and emptied `CompanyName`, `First` and
`Last`.

The reasoning felt airtight: a field named `Trust` exists, a trust name is not
a person's name, therefore a trust name belongs there and the person fields
should be empty. Coherent, tidy, and it fixed the visible defect.

Spec §2.3.3.3, which I had not read closely, says:

> `CompanyName` — CONDITIONAL: Required if first name and last name are not provided
> `Trust` — If the name has been determined to be a trust, then it goes into this field.

`Trust` says where a name **goes**. It says nothing about **identity**. Reading
the four rows together, only `CompanyName` or `First`+`Last` satisfies the
requirement. I had answered a placement question and assumed it answered an
identity question too.

Cost: every CPL for a trust seller failed in production. 373 orders were
positioned to hit it. Gerard hit it.

### 2. "Each rescue option mutates a Westcor record on a live file"

Three hours later, listing the ways to recover the stranded orders, I wrote
that every option mutates a vendor record we do not own — and used that to
justify not choosing one.

Same move. The problem *looked* like it needed a write, because the fix ends in
a write. So I described the lookup as a write without checking whether a read
existed.

Spec §7.1:

> **File Check — `GET VendorApi/Order/FileCheck/{partnerCode}`**
> Validates if the order exists, return back limited information … agentnumber
> and agent_file_number

A read. Returns the tvid. Exactly the missing piece. Gerard proposed it as his
own prior and asked whether the call existed — a question I should have
answered before writing the summary that said it didn't.

## The tell

Both claims were **arguments about a payload rather than observations of one.**
They read as reasoning: "a field named X, therefore Y." Nothing in either
sentence pointed at a line of source, and neither carried a quote.

Compare the claims from the same evening that survived: they had file:line
references, or a measured count, or a quoted spec row. The wrong ones had a
chain of inference and a confident tone.

**A claim about a vendor contract that contains no quotation from the vendor
contract is a hypothesis wearing a conclusion's clothes.**

## The rule

Before asserting what a vendor requires, accepts, or offers, **quote the row**.
If the quote cannot be produced, the claim is not ready to ship, and it is
certainly not ready to justify a decision not to look.

This is cheap. Both spec sections were a `grep` away in a file already
extracted. §7.1 was found in under a minute once I actually looked — after
writing three paragraphs asserting it did not exist.

## The aggravating factor

Instance 2 happened **in the same session** in which I had written up instance
1, including a note that the guide's prose had been wrong three times and
should not be trusted over measurement. I drew the lesson "do not trust the
prose" and missed the larger one: **do not skip the prose either.** The failure
was never about the document's reliability. It was about substituting my model
of the problem for the document altogether.

## Related

- `endorsement-is-not-corroboration.md` — the companion failure, where a claim
  survived because it was agreed with rather than because it was checked. Same
  root: something other than evidence carried the weight.
- `reading-source-in-a-test.md` — on tests that assert about source text rather
  than behaviour.
- `docs/tickets/FNF_LEGAL_NAME_INDICATOR.md` — the counter-example done right:
  two readings, the evidence for each, and a deliberate refusal to flip a flag
  on prose alone.
