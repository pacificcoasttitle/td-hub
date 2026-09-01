# A partly-accepted Westcor order strands the file, and every retry is refused

**Status: ROOT CAUSE FIXED. Rescue of the three existing files still to be
chosen — see "Rescuing 48, 49 and 6142".**
Opened: 2026-09-01
Found: diagnosing the order 6142 CPL failure.

## What happens

Westcor's Order/Update can **partly succeed**. It answers **HTTP 200 with both
`tvid` and `messages.error` in the same body** — the order was created, and
then something inside it was rejected.

We parsed that body, saw the error array, threw, and **discarded `data.tvid`
sitting in the same object** (`payloads.ts`, Step A). Nothing on our side
recorded the order Westcor had just made.

Order 6142 / `20020090-GLT`, all three attempts, 2026-09-01:

```
03:58  generate_cpl  FAILED  Seller #2: Not Added. Please provide at least a
                             Company Name and/or First and Last Name…
04:05  generate_cpl  FAILED  HTTP 500 — Agent Number - Order Number Must be Unique.
04:16  generate_cpl  FAILED  HTTP 500 — Agent Number - Order Number Must be Unique.
```

The first attempt is the trust-seller regression, fixed in `cc43e05`. The
second and third are this ticket: the file number was already taken by the
order made at 03:58.

`vendor_api_logs` for order 6142 holds **three rows, all `generate_cpl`, all
failed**. No `create_order` row exists, so `lookupExistingTvid` returned null,
so Step A issued a CREATE, so Westcor refused it. Every future attempt took the
same path.

## The root cause is fixed

Two changes, together:

1. **`createOrUpdateOrder` attaches the tvid to the error it throws** when a
   200 carries `messages.error`. The order Westcor just created is no longer
   thrown away with the exception.
2. **The catch persists it before rethrowing**, as a `create_order` row with
   `success: false`, `errorCategory: 'PARTIAL_CREATE'` and
   `responseMeta.tvid`.
3. **`lookupExistingTvid` no longer filters on `success = true`.** A tvid from
   a partial create is just as real as one from a clean create — Westcor
   assigned the order either way. The tvid's presence is the validity test.

Covered by `partial-create.test.ts`, which drives the exact 6142 response
shape.

**This prevents new strandings. It does not rescue the three that already
exist**, because their tvids were never written anywhere.

## Rescuing 48, 49 and 6142

### Blast radius

- **2 orders** have a failed `generate_cpl` and no recorded tvid.
- **3 orders** have already hit `Must be Unique`: **48, 49, 6142**. 48 and 49
  are early test files; 6142 is live.

### A correction to this ticket's first draft

It originally said every rescue option "mutates a vendor record we do not own".
**That is wrong for option 2.** Westcor publishes a read-only lookup that
answers exactly the question we need, and it changes nothing:

> **§7.1 File Check — `GET VendorApi/Order/FileCheck/{partnerCode}`**
> "Validates if the order exists, return back limited information using one of
> the following request combinations. … agentnumber and agent_file_number"
>
> Response: `{"tvid": 357051, "agent_file_number": "…", "vendor_transaction_id":
> null, "completed": false, "canceled": false}`

We do not call it anywhere today.

### Option 1 — store the tvid on partial create *(done, above)*

- **Does:** keeps the tvid Westcor already returned.
- **Changes at Westcor:** nothing. Purely our side.
- **If wrong:** we store a tvid that is not the order's. The next attempt sends
  an update against a stranger's tvid — bounded by Westcor's own agent-number
  scoping, but it would be a write to the wrong file.
- **Reversible:** yes. Delete the row.
- **Rescues existing files:** **no.**

### Option 2 — look the order up by file number before creating

- **Does:** calls FileCheck with `agentnumber` + `agent_file_number`. If a tvid
  comes back, Step A takes the UPDATE path instead of CREATE.
- **Changes at Westcor:** **nothing on the lookup.** It is a GET that validates
  and returns. The subsequent update writes to the order that already exists —
  which is the order we intended to write to in the first place.
- **If wrong:** the failure mode is a false positive — FileCheck returns a tvid
  for a file number that is not ours, and we update someone else's order.
  Guarded by `agentnumber`: the lookup is scoped to our agent, so a collision
  requires a duplicate file number *within Pacific Coast Title*. Worth
  confirming that scoping on the first live call rather than assuming it.
- **Reversible:** the lookup, entirely. The update that follows is a normal CPL
  update and is as reversible as any other — which is to say the letter can be
  regenerated, but an issued letter is an issued letter.
- **Rescues existing files:** **yes — all three, with no invented state.**
- **Cost:** one extra round trip per CPL. Can be limited to the retry path
  rather than every generation.

### Option 3 — treat `Must be Unique` as a signal to switch to update

- **Does:** catches the duplicate error and retries as an update.
- **Changes at Westcor:** one extra rejected create per recovery, then a normal
  update.
- **If wrong:** we match a message string. Westcor rewords it and the recovery
  silently stops working — and the failure looks identical to the bug we just
  fixed. It also cannot tell "duplicate because we made it" from "duplicate
  because someone else did".
- **Reversible:** yes, it is our code path only.
- **Rescues existing files:** yes, but by provoking a known-bad call first.

### Recommendation

**Option 2, scoped to the retry path**, on top of the option 1 fix already
shipped. It is a read, it invents nothing, and it is the only one that recovers
6142. Option 3 is the fallback if FileCheck turns out not to be enabled for our
partner code.

**What still needs deciding:** whether to run it against 6142, which is a live
file, or prove it first on 48 or 49, which are test files. Doing 48 first costs
one round trip and removes the guesswork.

## Related

- `docs/tickets/CPL_WHAT_WE_DO.md` — the four-hop flow this sits inside.
- The same change that found this added the built buyer and seller names to the
  `generate_cpl` failure log. Without it this diagnosis needed the builder
  re-run against live data, because a positional rejection ("Seller #2") is
  unreadable without the array it counts into. That is the general lesson: we
  stored `{ error }` and nothing else on the one call shape whose errors are
  positional.
