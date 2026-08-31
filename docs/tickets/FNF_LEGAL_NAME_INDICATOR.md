# `LegalNameIndicator: true` is hardcoded on every FNF CPL — open question

**Status: OPEN QUESTION, deliberately not changed.**
Opened: 2026-08-31
Found: reading the FNF CPL Integration Guide against our SOAP envelope.

## What we send

`src/lib/integrations/cpl/fnf/soap.ts`, in the GenerateCPL envelope:

```xml
<a:DBAsIndicator>false</a:DBAsIndicator>
<a:LegalNameIndicator>true</a:LegalNameIndicator>
```

Both literals, on every letter. We send no `ApprovedAttorneyCLUP`.

## The two readings

### (a) `true` is correct — leave it

- **Legacy sends `true`, in production, for years, without complaint.** This is
  a faithful port of a system that issues these letters daily.
- **It pairs coherently with `DBAsIndicator: false`.** Read together the two
  say "no DBA, use the legal name", which is exactly our situation: Pacific
  Coast Title Company trading under its own name.
- **`GetCPLMetadata` did not flag it.** The live metadata for
  `Standard CPL_CA` returns 36 FormFields and says nothing about this
  envelope-level flag being wrong.

### (b) `false` is correct — it should be a decision, not a literal

- The guide, form-specific data item 6: *"LegalNameIndicator – true or false
  depending on the user's choice of Agent. If ApprovedAttorneyCLUP is NOT NULL,
  set this value to true, regardless of the user's choice."*
- We send no `ApprovedAttorneyCLUP`, so the clause that forces `true` never
  applies, leaving "the user's choice" — which we never ask for and never
  establish.
- It is the third hardcoded flag found in one session standing in for a
  decision, alongside Westcor's `ClosingAgentNumber` and `[Agent/Company Name]`.

## Why this is not being changed

**Reading (b) rests entirely on the guide's prose, and this same round caught
that prose wrong three times:**

1. It lists `[Doing Business As]` among elements that "are required". The live
   `GetCPLMetadata` returns it as `required=false`.
2. It documents the namespace `http://cpl.fnf.com/services/cplmanagement/`.
   The v3 endpoint rejects that outright and demands
   `http://cpl.fnf.com/services/v3/cplmanagement/`.
3. Its sample GetCPLMetadata request omits the `ClientID` header. Without it
   the service returns *"Bad Request: The client id header is null or empty."*

A document with that error rate is not sufficient grounds to flip a flag on a
legal instrument, against a production system that has sent the opposite value
for years without complaint.

**`GetCPLMetadata` does not settle this.** It describes FormFields — the
`NameValue` array — not the envelope-level indicators. There is no read
available that answers the question.

## What would settle it

Ask FNF directly. One question:

> On a single-agent CPL with no ApprovedAttorneyCLUP and `DBAsIndicator: false`,
> what should `LegalNameIndicator` be, and what does it change on the issued
> letter?

Until then the value stays as legacy sends it. If the first FNF letter shows
something unexpected in the agent name block, this is the first place to look.

## Related

- `docs/tickets/CPL_CLOSING_AGENT_NUMBER_IS_HARDCODED.md` — same shape on the
  Westcor side, and there the token turned out to confirm the hardcoded value
  was right. Worth remembering before assuming a literal is a defect.
- `[Agent/Company Name]` is hardcoded to `'Pacific Coast Title Company'` and
  `[Agent/Company State]` to `'CA'` in the same builder, where the guide says
  to source them from the agent response. Same class, not yet raised
  separately — both are currently correct for us.
