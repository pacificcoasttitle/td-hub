# What the Update Prelim button is gated on

**Decided 2026-09-03 by Gerard. Settled — do not re-litigate without reading
the asymmetry below.**

## The gate

`updatePrelimEnabled` only. **Not** `hasPrelim`.

The button renders on every order the rep can already see, in both the
`hasPrelim` and the "Not Ready" branch of `order-actions.tsx`.

## Why not hasPrelim

Legacy gates on `prelim_summary_id != 0` — *a prelim exists in SoftPro* —
and shows the button whether or not the PDF was fetched.

**We have no equivalent of that field.** `orders` carries only
`last_prelim_fetch_at`, which records when we last *attempted* a fetch, not
what SoftPro holds. The one local predicate available is `hasPrelim`, which is
a Hub document row:

```sql
category = 'prelim' AND status = 'active'
```

That is the opposite end of legacy's condition. It means "we hold the PDF",
so gating on it hides the button in the case that matters most: **SoftPro has
a prelim, or a newer one, that we have not fetched.** That is exactly when a
rep wants to ask for an update, and the hiding is silent — no message, no
explanation, the button simply is not there.

## The asymmetry that decided it

- A **false hide** blocks the rep and fails silently. They go back to phoning
  production, which is the behaviour this button exists to replace.
- A **false show** sends a request about a prelim that does not exist. The
  person receiving it reads the note, sees there is no prelim, and says so.
  It fails visibly and recovers itself.

A false hide costs more. So: no gate.

## What softens the false show

Neither of these blocks the send.

1. **In the modal**, when the Hub holds no prelim for the order:
   *"We don't currently have a prelim on this file — your request will still
   be sent."*
2. **In the SoftPro note**, the same fact, so the recipient knows before they
   open it and does not hunt for a document the Hub never had. Sourced from
   `supersededCount` — the number of active prelims the upload retired — so
   it reflects our rows at the moment of writing, not what the client claimed
   on submit.

## Measured, 2026-09-03

Of 8,303 orders: 6,288 hold an active prelim, 1,252 attempted a fetch and hold
none, 763 never attempted.

Of the 473 orders where `GetAttachedDocumentsPrelim` returned at least one
document, the Hub holds an active prelim for **all 473** — zero divergence.
**Do not read that as reassurance.** That population is selected for
agreeing: the listing was called as part of a fetch, and the fetch then stored
the document. It shows we have no evidence of divergence, not that the two
cannot diverge.

## The eventual gate

A stored SoftPro-side prelim signal, from the parked
`GetAttachedDocumentsPrelim`/`ModifiedAt` change-detection work. That is the
real equivalent of `prelim_summary_id != 0` and it is the right long-term
answer. It is **not** a blocker for this button and must not hold the staging
probe. When it lands, gate on it — not on `hasPrelim`.
